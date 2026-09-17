import {
  MafiaGameProjectionSchema,
  MafiaGameSessionSnapshotSchema,
  type MafiaGameSessionSnapshot,
} from '@repo/mafia';
import type { MafiaGameProjection, MafiaOutputLanguage } from '@repo/mafia';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { Redis } from 'ioredis';
import { ResultAsync, err, ok, type Result } from 'neverthrow';
import { filter, map } from 'remeda';
import { match } from 'ts-pattern';
import * as v from 'valibot';

import type { AgentMind } from '../agents/agent-mind.js';
import type { GameSessionStatus } from '../application/game-session-status.js';
import { gameSessionsConfig } from '../application/game-sessions.config.js';
import type {
  ScheduledAgentFinalDefence,
  ScheduledAgentMafiaChatReply,
  ScheduledAgentPublicSpeech,
} from '../application/stored-game-session.entity.js';
import { runRedisLuaCommand } from './redis-lua-command-runner.js';

dayjs.extend(utc);

export type DurableSessionSnapshot = {
  sessionId: string;
  holderId: string;
  humanParticipantId: string;
  outputLanguage?: MafiaOutputLanguage;
  gameSession: MafiaGameSessionSnapshot;
  agentMinds?: Record<string, AgentMind>;
  nextEventId: number;
  phaseDeadline: string;
  lastActivityAt: string;
  status: GameSessionStatus;
  reconnectGraceDeadline: string | undefined;
  reconnectLeaseDeadline?: string;
  cooldowns?: {
    publicSpeech: string | undefined;
    finalDefence: string | undefined;
    discussionTimeAdjustment: string | undefined;
  };
  idempotency?: Record<string, [string, { fingerprint: string; result: MafiaGameProjection }][]>;
  scheduledAgentPublicSpeeches?: ScheduledAgentPublicSpeech[];
  scheduledAgentFinalDefence?: ScheduledAgentFinalDefence;
  scheduledAgentMafiaChatReplies?: ScheduledAgentMafiaChatReply[];
  scheduledMafiaTargetFallbackAt?: string;
  autonomousPublicSpeechTurns?: number;
  lastAutonomousPublicSpeechSnapshotKey?: string;
  autonomousPublicSpeechLimitReachedDiscussionKey?: string;
  agentActionsPending?: boolean;
};

export type DurablePublicEvent = {
  eventId: number;
  projection: MafiaGameProjection;
};

export type DurableCreationIdempotencyRecord = {
  fingerprint: string;
  sessionId: string;
};

export type DurableCreationResult =
  | { type: 'created' }
  | { type: 'replayed'; record: DurableCreationIdempotencyRecord }
  | { type: 'active-session'; sessionId: string }
  | { type: 'unavailable-session'; sessionId: string }
  | { type: 'conflict' }
  | { type: 'allowance-exhausted' };

export type DurableSessionError =
  | { type: 'authority-unavailable'; cause: unknown }
  | { type: 'invalid-authority-data'; key: string };

const GameSessionStatusSchema = v.picklist(['in-progress', 'completed', 'abandoned'] as const);
const IdempotencyRecordSchema = v.object({
  fingerprint: v.string(),
  result: MafiaGameProjectionSchema,
});
const ScheduledAgentPublicSpeechSchema = v.object({
  participantId: v.string(),
  content: v.string(),
  dueAt: v.string(),
});
const ScheduledAgentMafiaChatReplySchema = v.object({
  id: v.string(),
  participantId: v.string(),
  content: v.string(),
  dueAt: v.string(),
  phaseKey: v.optional(v.string()),
});
const AgentMemorySchema = v.object({
  revision: v.number(),
  allegianceEstimates: v.optional(
    v.array(
      v.object({
        participantId: v.string(),
        mafiaProbability: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
        roleProbabilities: v.optional(
          v.object({
            policeProbability: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
            doctorProbability: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
          }),
        ),
        basis: v.string(),
      }),
    ),
    [],
  ),
  strategy: v.optional(
    v.string(),
    'Use current evidence and allegiance estimates to make the next legal move.',
  ),
  lastSnapshotKey: v.optional(v.string()),
});
const AgentMindSchema = v.object({ persona: v.string(), memory: AgentMemorySchema });
const DurableSessionSnapshotSchema: v.GenericSchema<unknown, DurableSessionSnapshot> = v.pipe(
  v.object({
    sessionId: v.string(),
    holderId: v.string(),
    humanParticipantId: v.string(),
    outputLanguage: v.optional(v.picklist(['ko', 'en'])),
    gameSession: MafiaGameSessionSnapshotSchema,
    agentMinds: v.optional(v.record(v.string(), AgentMindSchema)),
    nextEventId: v.number(),
    phaseDeadline: v.string(),
    lastActivityAt: v.string(),
    status: GameSessionStatusSchema,
    reconnectGraceDeadline: v.optional(v.string()),
    reconnectLeaseDeadline: v.optional(v.string()),
    cooldowns: v.optional(
      v.object({
        publicSpeech: v.optional(v.string()),
        finalDefence: v.optional(v.string()),
        discussionTimeAdjustment: v.optional(v.string()),
      }),
    ),
    idempotency: v.optional(
      v.record(v.string(), v.array(v.tuple([v.string(), IdempotencyRecordSchema]))),
    ),
    scheduledAgentPublicSpeeches: v.optional(v.array(ScheduledAgentPublicSpeechSchema)),
    scheduledAgentFinalDefence: v.optional(ScheduledAgentPublicSpeechSchema),
    scheduledAgentMafiaChatReplies: v.optional(v.array(ScheduledAgentMafiaChatReplySchema)),
    scheduledMafiaTargetFallbackAt: v.optional(v.string()),
    autonomousPublicSpeechTurns: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    lastAutonomousPublicSpeechSnapshotKey: v.optional(v.string()),
    autonomousPublicSpeechLimitReachedDiscussionKey: v.optional(v.string()),
    agentActionsPending: v.optional(v.boolean()),
  }),
  v.transform((snapshot): DurableSessionSnapshot => ({
    ...snapshot,
    reconnectGraceDeadline: snapshot.reconnectGraceDeadline,
    cooldowns: snapshot.cooldowns && {
      publicSpeech: snapshot.cooldowns.publicSpeech,
      finalDefence: snapshot.cooldowns.finalDefence,
      discussionTimeAdjustment: snapshot.cooldowns.discussionTimeAdjustment,
    },
  })),
);
const DurablePublicEventSchema: v.GenericSchema<unknown, DurablePublicEvent> = v.object({
  eventId: v.number(),
  projection: MafiaGameProjectionSchema,
});
const DurableCreationIdempotencyRecordSchema: v.GenericSchema<
  unknown,
  DurableCreationIdempotencyRecord
> = v.object({ fingerprint: v.string(), sessionId: v.string() });

type RedisCommands = Pick<
  Redis,
  'defineCommand' | 'get' | 'set' | 'zadd' | 'zrange' | 'zrangebyscore' | 'zrem' | 'del' | 'quit'
>;

const millisecondsPerMinute = 60 * 1000;
const sessionTtlMs = gameSessionsConfig.sessionIdleTtlHours * 60 * millisecondsPerMinute;
const replayEventTtlMs = sessionTtlMs;
const reconnectGraceMs = gameSessionsConfig.reconnectGraceMs;
const phaseDeadlineClaimLeaseMs = gameSessionsConfig.phaseDeadlineClaimLeaseMs;
const abandonedSessionTtlMs = gameSessionsConfig.abandonedSessionTtlMinutes * millisecondsPerMinute;
const inProgressIdleTtlMs = gameSessionsConfig.inProgressIdleTtlMinutes * millisecondsPerMinute;

export class RedisGameSessionAuthority {
  constructor(
    private readonly redis: RedisCommands,
    private readonly keyPrefix = 'withai:game-sessions',
    private readonly now: () => Date = () => new Date(),
  ) {}

  static fromEnvironment() {
    const redisUrl = process.env.REDIS_URL;
    return redisUrl
      ? new RedisGameSessionAuthority(
          new Redis(redisUrl, { lazyConnect: true }),
          process.env.NODE_ENV === 'production'
            ? 'withai:game-sessions'
            : 'withai-dev:game-sessions',
        )
      : undefined;
  }

  activeSessionIdForHolder(holderId: string): ResultAsync<string | undefined, DurableSessionError> {
    return ResultAsync.fromPromise(
      this.redis.get(this.holderActiveSessionKey(holderId)),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((sessionId) => sessionId ?? undefined);
  }

  guestAllowanceUsage(holderId: string, utcDay: string): ResultAsync<number, DurableSessionError> {
    const key = this.allowanceKey(holderId, utcDay);
    return ResultAsync.fromPromise(this.redis.get(key), (cause): DurableSessionError => ({
      type: 'authority-unavailable',
      cause,
    })).andThen((value) => {
      if (value === null) return ok(0);
      const usage = Number(value);
      return Number.isSafeInteger(usage) && usage >= 0
        ? ok(usage)
        : err<number, DurableSessionError>({ type: 'invalid-authority-data', key });
    });
  }

  clearActiveSessionForHolder(
    holderId: string,
    sessionId: string,
  ): ResultAsync<void, DurableSessionError> {
    const key = this.holderActiveSessionKey(holderId);
    return ResultAsync.fromPromise(
      this.redis.get(key).then(async (current) => {
        if (current === sessionId) await this.redis.del(key);
        return undefined;
      }),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    );
  }

  save(
    snapshot: DurableSessionSnapshot,
    event: DurablePublicEvent,
  ): ResultAsync<boolean, DurableSessionError> {
    const now = this.now().valueOf();
    const ttlMs = snapshot.status === 'abandoned' ? abandonedSessionTtlMs : sessionTtlMs;
    const snapshotKey = this.snapshotKey(snapshot.sessionId);
    const eventsKey = this.eventsKey(snapshot.sessionId);
    return ResultAsync.fromPromise(
      runRedisLuaCommand<number>(
        this.redis,
        `local previousVersion = redis.call('GET', KEYS[4])
         local expectedVersion = tonumber(ARGV[8])
         if expectedVersion == 0 then
           if previousVersion then return 0 end
         elseif not previousVersion or tonumber(previousVersion) ~= expectedVersion then
           return 0
         end
         local lifecycle = redis.call('GET', KEYS[5])
         if lifecycle == 'abandoned' then return 0 end
         local deadline = tonumber(string.match(lifecycle or '', '^[^:]+:(%d+)|'))
         if deadline and deadline <= tonumber(ARGV[12]) then
           redis.call('DEL', KEYS[10])
           redis.call('SET', KEYS[5], 'abandoned', 'PX', ARGV[13])
           redis.call('SET', KEYS[8], 'abandoned', 'PX', ARGV[13])
           redis.call('PEXPIRE', KEYS[1], ARGV[13])
           redis.call('PEXPIRE', KEYS[2], ARGV[13])
           redis.call('PEXPIRE', KEYS[4], ARGV[13])
           redis.call('PEXPIRE', KEYS[6], ARGV[13])
           redis.call('PEXPIRE', KEYS[7], ARGV[13])
           redis.call('ZREM', KEYS[3], ARGV[7])
           if redis.call('GET', KEYS[9]) == ARGV[7] then redis.call('DEL', KEYS[9]) end
           return 0
         end
         redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
         redis.call('SET', KEYS[4], ARGV[3], 'PX', ARGV[2])
         local previousActivity = redis.call('GET', KEYS[6])
         if not previousActivity or previousActivity < ARGV[9] then
           redis.call('SET', KEYS[6], ARGV[9], 'PX', ARGV[2])
         end
         redis.call('SET', KEYS[7], ARGV[10], 'PX', ARGV[2])
         redis.call('SET', KEYS[8], ARGV[11], 'PX', ARGV[2])
         if ARGV[11] == 'in-progress' then
           redis.call('SET', KEYS[9], ARGV[7], 'PX', ARGV[2])
         elseif redis.call('GET', KEYS[9]) == ARGV[7] then
           redis.call('DEL', KEYS[9])
         end
         redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
         redis.call('PEXPIRE', KEYS[2], ARGV[5])
         if ARGV[11] == 'in-progress' then
           redis.call('ZADD', KEYS[3], ARGV[6], ARGV[7])
         else
           redis.call('ZREM', KEYS[3], ARGV[7])
         end
         return 1`,
        10,
        snapshotKey,
        eventsKey,
        this.activeSessionsKey(),
        this.snapshotVersionKey(snapshot.sessionId),
        this.lifecycleKey(snapshot.sessionId),
        this.lastActivityKey(snapshot.sessionId),
        this.phaseDeadlineKey(snapshot.sessionId),
        this.statusKey(snapshot.sessionId),
        this.holderActiveSessionKey(snapshot.holderId),
        this.reconnectLeasesKey(snapshot.sessionId),
        JSON.stringify(snapshot),
        ttlMs,
        event.eventId,
        JSON.stringify(event),
        replayEventTtlMs,
        now,
        snapshot.sessionId,
        event.eventId - 1,
        snapshot.lastActivityAt,
        snapshot.phaseDeadline,
        snapshot.status,
        now,
        abandonedSessionTtlMs,
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((saved) => saved === 1);
  }

  saveSnapshot(snapshot: DurableSessionSnapshot): ResultAsync<boolean, DurableSessionError> {
    const ttlMs = snapshot.status === 'abandoned' ? abandonedSessionTtlMs : sessionTtlMs;
    return ResultAsync.fromPromise(
      runRedisLuaCommand<number>(
        this.redis,
        `if not redis.call('GET', KEYS[1]) then return 0 end
         local lifecycle = redis.call('GET', KEYS[9])
         if lifecycle == 'abandoned' then return 0 end
         local deadline = tonumber(string.match(lifecycle or '', '^[^:]+:(%d+)|'))
         if deadline and deadline <= tonumber(ARGV[7]) then
           redis.call('DEL', KEYS[10])
           redis.call('SET', KEYS[9], 'abandoned', 'PX', ARGV[9])
           redis.call('SET', KEYS[4], 'abandoned', 'PX', ARGV[9])
           redis.call('PEXPIRE', KEYS[1], ARGV[9])
           redis.call('PEXPIRE', KEYS[3], ARGV[9])
           redis.call('PEXPIRE', KEYS[5], ARGV[9])
           redis.call('PEXPIRE', KEYS[6], ARGV[9])
           redis.call('PEXPIRE', KEYS[8], ARGV[9])
           redis.call('ZREM', KEYS[2], ARGV[6])
           if redis.call('GET', KEYS[7]) == ARGV[6] then redis.call('DEL', KEYS[7]) end
           return 0
         end
         local currentVersion = redis.call('GET', KEYS[8])
         if not currentVersion or tonumber(currentVersion) ~= tonumber(ARGV[8]) then return 0 end
         redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
         local previousActivity = redis.call('GET', KEYS[5])
         if not previousActivity or previousActivity < ARGV[3] then
           redis.call('SET', KEYS[5], ARGV[3], 'PX', ARGV[2])
         end
         redis.call('SET', KEYS[6], ARGV[4], 'PX', ARGV[2])
         redis.call('SET', KEYS[4], ARGV[5], 'PX', ARGV[2])
         if ARGV[5] == 'in-progress' then
           redis.call('SET', KEYS[7], ARGV[6], 'PX', ARGV[2])
           redis.call('ZADD', KEYS[2], ARGV[7], ARGV[6])
         else
           redis.call('ZREM', KEYS[2], ARGV[6])
         end
         return 1`,
        10,
        this.snapshotKey(snapshot.sessionId),
        this.activeSessionsKey(),
        this.eventsKey(snapshot.sessionId),
        this.statusKey(snapshot.sessionId),
        this.lastActivityKey(snapshot.sessionId),
        this.phaseDeadlineKey(snapshot.sessionId),
        this.holderActiveSessionKey(snapshot.holderId),
        this.snapshotVersionKey(snapshot.sessionId),
        this.lifecycleKey(snapshot.sessionId),
        this.reconnectLeasesKey(snapshot.sessionId),
        JSON.stringify(snapshot),
        ttlMs,
        snapshot.lastActivityAt,
        snapshot.phaseDeadline,
        snapshot.status,
        snapshot.sessionId,
        this.now().valueOf(),
        snapshot.nextEventId,
        abandonedSessionTtlMs,
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((saved) => saved === 1);
  }

  load(sessionId: string): ResultAsync<DurableSessionSnapshot | undefined, DurableSessionError> {
    const key = this.snapshotKey(sessionId);
    return ResultAsync.fromPromise(this.redis.get(key), (cause): DurableSessionError => ({
      type: 'authority-unavailable',
      cause,
    }))
      .andThen((value) => this.parse(value, key, DurableSessionSnapshotSchema))
      .andThen((snapshot) => {
        if (!snapshot) return ok(undefined);
        return ResultAsync.combine([
          ResultAsync.fromPromise(this.redis.get(this.lifecycleKey(sessionId)), (cause) => ({
            type: 'authority-unavailable' as const,
            cause,
          })),
          ResultAsync.fromPromise(this.redis.get(this.lastActivityKey(sessionId)), (cause) => ({
            type: 'authority-unavailable' as const,
            cause,
          })),
        ]).map(([lifecycle, lastActivityAt]) => {
          if (lastActivityAt) snapshot.lastActivityAt = lastActivityAt;
          if (lifecycle === 'abandoned') {
            snapshot.status = 'abandoned';
            return snapshot;
          }
          if (lifecycle?.startsWith('lease:')) {
            const deadline = lifecycle.split('|')[1] ?? lifecycle.slice('lease:'.length);
            snapshot.reconnectLeaseDeadline = new Date(Number(deadline)).toISOString();
            snapshot.reconnectGraceDeadline = undefined;
            return snapshot;
          }
          if (!lifecycle?.startsWith('grace:')) {
            snapshot.reconnectGraceDeadline = undefined;
            return snapshot;
          }
          snapshot.reconnectGraceDeadline =
            lifecycle.split('|')[1] ?? lifecycle.slice('grace:'.length);
          return snapshot;
        });
      });
  }

  loadCreationIdempotency(
    holderId: string,
    idempotencyKey: string,
  ): ResultAsync<DurableCreationIdempotencyRecord | undefined, DurableSessionError> {
    const key = this.creationIdempotencyKey(holderId, idempotencyKey);
    return ResultAsync.fromPromise(this.redis.get(key), (cause): DurableSessionError => ({
      type: 'authority-unavailable',
      cause,
    })).andThen((value) => this.parseCreationIdempotency(value, key));
  }

  recordCreationIdempotency(
    holderId: string,
    idempotencyKey: string,
    record: DurableCreationIdempotencyRecord,
  ): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      this.redis.set(
        this.creationIdempotencyKey(holderId, idempotencyKey),
        this.serializeCreationIdempotency(record),
        'PX',
        sessionTtlMs,
        'NX',
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((created) => created === 'OK');
  }

  /**
   * Creates the initial snapshot, first event, guest allowance debit, and optional
   * idempotency record in one Redis script.  In particular, an idempotency replay
   * can never observe a record for a session whose snapshot has not committed.
   */
  create(
    snapshot: DurableSessionSnapshot,
    event: DurablePublicEvent,
    holderId: string,
    utcDay: string,
    allowance: number,
    idempotency: { key: string; fingerprint: string } | undefined,
    allowanceHolderId = holderId,
  ): ResultAsync<DurableCreationResult, DurableSessionError> {
    const idempotencyKey = idempotency
      ? this.creationIdempotencyKey(holderId, idempotency.key)
      : this.creationReservationKey(snapshot.sessionId);
    return ResultAsync.fromPromise(
      runRedisLuaCommand<number | string>(
        this.redis,
        `local function hasExpiredLifecycle(sessionId)
           local lifecycle = redis.call('GET', ARGV[15] .. ':lifecycles:' .. sessionId)
           local deadline = tonumber(string.match(lifecycle or '', '^[^:]+:(%d+)|'))
           return deadline and deadline <= tonumber(ARGV[10])
         end
         local function hasExpiredIdleActivity(sessionId)
           local lastActivityAt = redis.call('GET', ARGV[15] .. ':last-activity:' .. sessionId)
           return lastActivityAt and lastActivityAt <= ARGV[17]
         end
         local function expireIdleSession(sessionId)
           if not hasExpiredIdleActivity(sessionId) then return false end
           local reconnectLeasesKey = ARGV[15] .. ':reconnect-leases:' .. sessionId
           redis.call('ZREMRANGEBYSCORE', reconnectLeasesKey, '-inf', ARGV[10])
           if redis.call('ZCARD', reconnectLeasesKey) > 0 then return false end
           local snapshotKey = ARGV[15] .. ':snapshots:' .. sessionId
           local eventsKey = ARGV[15] .. ':events:' .. sessionId
           local versionKey = ARGV[15] .. ':snapshot-versions:' .. sessionId
           local lastActivityKey = ARGV[15] .. ':last-activity:' .. sessionId
           local phaseDeadlineKey = ARGV[15] .. ':phase-deadlines:' .. sessionId
           local statusKey = ARGV[15] .. ':statuses:' .. sessionId
           local lifecycleKey = ARGV[15] .. ':lifecycles:' .. sessionId
           redis.call('DEL', snapshotKey)
           redis.call('DEL', eventsKey)
           redis.call('DEL', versionKey)
           redis.call('DEL', reconnectLeasesKey)
           redis.call('DEL', statusKey)
           redis.call('DEL', lastActivityKey)
           redis.call('DEL', phaseDeadlineKey)
           redis.call('DEL', lifecycleKey)
           redis.call('ZREM', KEYS[6], sessionId)
           if redis.call('GET', KEYS[10]) == sessionId then redis.call('DEL', KEYS[10]) end
           return true
         end
         local function abandonExpiredSession(sessionId)
           if not hasExpiredLifecycle(sessionId) then return end
           local snapshotKey = ARGV[15] .. ':snapshots:' .. sessionId
           local eventsKey = ARGV[15] .. ':events:' .. sessionId
           local versionKey = ARGV[15] .. ':snapshot-versions:' .. sessionId
           local lastActivityKey = ARGV[15] .. ':last-activity:' .. sessionId
           local phaseDeadlineKey = ARGV[15] .. ':phase-deadlines:' .. sessionId
           local statusKey = ARGV[15] .. ':statuses:' .. sessionId
           local lifecycleKey = ARGV[15] .. ':lifecycles:' .. sessionId
           local reconnectLeasesKey = ARGV[15] .. ':reconnect-leases:' .. sessionId
           redis.call('SET', lifecycleKey, 'abandoned', 'PX', ARGV[16])
           redis.call('SET', statusKey, 'abandoned', 'PX', ARGV[16])
           redis.call('PEXPIRE', snapshotKey, ARGV[16])
           redis.call('PEXPIRE', eventsKey, ARGV[16])
           redis.call('PEXPIRE', versionKey, ARGV[16])
           redis.call('PEXPIRE', lastActivityKey, ARGV[16])
           redis.call('PEXPIRE', phaseDeadlineKey, ARGV[16])
           redis.call('PEXPIRE', reconnectLeasesKey, ARGV[16])
         end
         local function isUnavailable(sessionId)
           local snapshotKey = ARGV[15] .. ':snapshots:' .. sessionId
           if not redis.call('GET', snapshotKey) then return true end
           local status = redis.call('GET', ARGV[15] .. ':statuses:' .. sessionId)
           if status == 'abandoned' then return true end
           local lifecycle = redis.call('GET', ARGV[15] .. ':lifecycles:' .. sessionId)
           if lifecycle == 'abandoned' then return true end
           return hasExpiredLifecycle(sessionId)
         end
         if ARGV[8] == '1' then
           local existing = redis.call('GET', KEYS[5])
           if existing then
             local separator = string.find(existing, string.char(10))
             local existingSessionId = separator and string.sub(existing, separator + 1)
             if not existingSessionId
               or isUnavailable(existingSessionId)
               or expireIdleSession(existingSessionId) then
               if existingSessionId then
                 abandonExpiredSession(existingSessionId)
                 redis.call('ZREM', KEYS[6], existingSessionId)
                 if redis.call('GET', KEYS[10]) == existingSessionId then redis.call('DEL', KEYS[10]) end
               end
               return 'unavailable:' .. (existingSessionId or '')
             end
             if string.sub(existing, 1, string.len(ARGV[9]) + 1) == ARGV[9] .. string.char(10) then return 2 end
             return 3
           end
         end
         local activeSessionId = redis.call('GET', KEYS[10])
         if activeSessionId then
           if isUnavailable(activeSessionId) or expireIdleSession(activeSessionId) then
             abandonExpiredSession(activeSessionId)
             redis.call('ZREM', KEYS[6], activeSessionId)
             if redis.call('GET', KEYS[10]) == activeSessionId then redis.call('DEL', KEYS[10]) end
           else
             if ARGV[8] == '1' then
               redis.call('SET', KEYS[5], ARGV[9] .. string.char(10) .. activeSessionId, 'PX', ARGV[2])
             end
             return 'active:' .. activeSessionId
           end
         end
         local count = tonumber(redis.call('GET', KEYS[4]) or '0')
         if count >= tonumber(ARGV[7]) then return 4 end
         count = redis.call('INCR', KEYS[4])
         if count == 1 then redis.call('PEXPIRE', KEYS[4], ARGV[6]) end
         redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
         redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[2])
         redis.call('SET', KEYS[7], ARGV[13], 'PX', ARGV[2])
         redis.call('SET', KEYS[8], ARGV[14], 'PX', ARGV[2])
         redis.call('SET', KEYS[9], 'in-progress', 'PX', ARGV[2])
         redis.call('ZADD', KEYS[3], ARGV[3], ARGV[4])
         redis.call('PEXPIRE', KEYS[3], ARGV[5])
         redis.call('ZADD', KEYS[6], ARGV[10], ARGV[11])
         redis.call('SET', KEYS[10], ARGV[11], 'PX', ARGV[2])
         if ARGV[8] == '1' then
           redis.call('SET', KEYS[5], ARGV[12], 'PX', ARGV[2])
         end
         return 1`,
        10,
        this.snapshotKey(snapshot.sessionId),
        this.snapshotVersionKey(snapshot.sessionId),
        this.eventsKey(snapshot.sessionId),
        this.allowanceKey(allowanceHolderId, utcDay),
        idempotencyKey,
        this.activeSessionsKey(),
        this.lastActivityKey(snapshot.sessionId),
        this.phaseDeadlineKey(snapshot.sessionId),
        this.statusKey(snapshot.sessionId),
        this.holderActiveSessionKey(holderId),
        JSON.stringify(snapshot),
        sessionTtlMs,
        event.eventId,
        JSON.stringify(event),
        replayEventTtlMs,
        this.msUntilNextUtcDay(),
        allowance,
        idempotency ? '1' : '0',
        idempotency?.fingerprint ?? '',
        this.now().valueOf(),
        snapshot.sessionId,
        this.serializeCreationIdempotency({
          fingerprint: idempotency?.fingerprint ?? '',
          sessionId: snapshot.sessionId,
        }),
        snapshot.lastActivityAt,
        snapshot.phaseDeadline,
        this.keyPrefix,
        abandonedSessionTtlMs,
        new Date(this.now().valueOf() - inProgressIdleTtlMs).toISOString(),
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).andThen((value) => {
      if (typeof value === 'string' && value.startsWith('active:')) {
        return ok<DurableCreationResult, DurableSessionError>({
          type: 'active-session',
          sessionId: value.slice('active:'.length),
        });
      }
      if (typeof value === 'string' && value.startsWith('unavailable:')) {
        return ok<DurableCreationResult, DurableSessionError>({
          type: 'unavailable-session',
          sessionId: value.slice('unavailable:'.length),
        });
      }
      const outcome = Number(value);
      if (outcome === 1) return ok<DurableCreationResult, DurableSessionError>({ type: 'created' });
      if (outcome === 3)
        return ok<DurableCreationResult, DurableSessionError>({ type: 'conflict' });
      if (outcome === 4)
        return ok<DurableCreationResult, DurableSessionError>({ type: 'allowance-exhausted' });
      if (outcome !== 2 || !idempotency)
        return err<DurableCreationResult, DurableSessionError>({
          type: 'invalid-authority-data',
          key: idempotencyKey,
        });
      return this.loadCreationIdempotency(holderId, idempotency.key).andThen((record) =>
        record
          ? ok<DurableCreationResult, DurableSessionError>({ type: 'replayed', record })
          : err<DurableCreationResult, DurableSessionError>({
              type: 'invalid-authority-data',
              key: idempotencyKey,
            }),
      );
    });
  }

  activeSnapshots(): ResultAsync<DurableSessionSnapshot[], DurableSessionError> {
    const key = this.activeSessionsKey();
    return ResultAsync.fromPromise(
      this.redis.zrangebyscore(key, '-inf', '+inf'),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    )
      .andThen((sessionIds) =>
        ResultAsync.fromPromise(
          Promise.all(map(sessionIds, (sessionId) => this.loadActiveSnapshot(sessionId))),
          (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
        ),
      )
      .map((snapshots) => filter(snapshots, (snapshot) => snapshot !== undefined));
  }

  eventsAfter(
    sessionId: string,
    eventId: number,
  ): ResultAsync<DurablePublicEvent[], DurableSessionError> {
    const key = this.eventsKey(sessionId);
    return ResultAsync.fromPromise(
      this.redis.zrangebyscore(key, `(${eventId}`, '+inf'),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).andThen((values) => this.parseMany(values, key, DurablePublicEventSchema));
  }

  touch(sessionId: string, lastActivityAt: string): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      runRedisLuaCommand<number>(
        this.redis,
        `if not redis.call('GET', KEYS[1]) then return 0 end
         if redis.call('GET', KEYS[3]) ~= 'in-progress' then return 0 end
         local lifecycle = redis.call('GET', KEYS[4])
         if lifecycle == 'abandoned' then return 0 end
         local deadline = tonumber(string.match(lifecycle or '', '^[^:]+:(%d+)|'))
         if deadline and deadline <= tonumber(ARGV[5]) then return 0 end
         local previousActivity = redis.call('GET', KEYS[2])
         if not previousActivity or previousActivity < ARGV[1] then
           redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2])
         end
         redis.call('ZADD', KEYS[5], ARGV[3], ARGV[4])
         return 1`,
        5,
        this.snapshotKey(sessionId),
        this.lastActivityKey(sessionId),
        this.statusKey(sessionId),
        this.lifecycleKey(sessionId),
        this.activeSessionsKey(),
        lastActivityAt,
        sessionTtlMs,
        dayjs(lastActivityAt).valueOf(),
        sessionId,
        this.now().valueOf(),
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((touched) => touched === 1);
  }

  acquireReconnectLease(
    sessionId: string,
    connectionId: string,
    holderId: string,
  ): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      runRedisLuaCommand<number>(
        this.redis,
        `if not redis.call('GET', KEYS[1]) then return 0 end
         local lifecycle = redis.call('GET', KEYS[5])
         if lifecycle == 'abandoned' then return 0 end
         if string.sub(lifecycle or '', 1, 6) == 'grace:' then
           local deadline = tonumber(string.match(lifecycle, '^grace:(%d+)|'))
           if not deadline or deadline <= tonumber(ARGV[4]) then
             redis.call('DEL', KEYS[4])
             redis.call('SET', KEYS[5], 'abandoned', 'PX', ARGV[5])
             redis.call('SET', KEYS[6], 'abandoned', 'PX', ARGV[5])
             redis.call('PEXPIRE', KEYS[1], ARGV[5])
             redis.call('PEXPIRE', KEYS[2], ARGV[5])
             redis.call('PEXPIRE', KEYS[3], ARGV[5])
             redis.call('PEXPIRE', KEYS[9], ARGV[5])
             redis.call('PEXPIRE', KEYS[10], ARGV[5])
             redis.call('ZREM', KEYS[7], ARGV[6])
             if redis.call('GET', KEYS[8]) == ARGV[6] then redis.call('DEL', KEYS[8]) end
             return 0
           end
           redis.call('DEL', KEYS[5])
         elseif string.sub(lifecycle or '', 1, 6) == 'lease:' then
           redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', ARGV[4])
           local newestLease = redis.call('ZREVRANGE', KEYS[4], 0, 0, 'WITHSCORES')
           if newestLease[2] then
             lifecycle = 'lease:' .. newestLease[2] .. '|' .. newestLease[2]
             redis.call('SET', KEYS[5], lifecycle, 'PX', ARGV[7])
           end
           local leaseDeadline = tonumber(string.match(lifecycle, '^lease:(%d+)|'))
           if not leaseDeadline or leaseDeadline <= tonumber(ARGV[4]) then
             redis.call('DEL', KEYS[4])
             redis.call('SET', KEYS[5], 'abandoned', 'PX', ARGV[5])
             redis.call('SET', KEYS[6], 'abandoned', 'PX', ARGV[5])
             redis.call('PEXPIRE', KEYS[1], ARGV[5])
             redis.call('PEXPIRE', KEYS[2], ARGV[5])
             redis.call('PEXPIRE', KEYS[3], ARGV[5])
             redis.call('PEXPIRE', KEYS[9], ARGV[5])
             redis.call('PEXPIRE', KEYS[10], ARGV[5])
             redis.call('ZREM', KEYS[7], ARGV[6])
             if redis.call('GET', KEYS[8]) == ARGV[6] then redis.call('DEL', KEYS[8]) end
             return 0
           end
         end
         redis.call('ZADD', KEYS[4], ARGV[1], ARGV[2])
         redis.call('PEXPIRE', KEYS[4], ARGV[3])
         local newestLease = redis.call('ZREVRANGE', KEYS[4], 0, 0, 'WITHSCORES')
         redis.call('SET', KEYS[5], 'lease:' .. newestLease[2] .. '|' .. newestLease[2], 'PX', ARGV[7])
         return 1`,
        10,
        this.snapshotKey(sessionId),
        this.snapshotVersionKey(sessionId),
        this.eventsKey(sessionId),
        this.reconnectLeasesKey(sessionId),
        this.lifecycleKey(sessionId),
        this.statusKey(sessionId),
        this.activeSessionsKey(),
        this.holderActiveSessionKey(holderId),
        this.lastActivityKey(sessionId),
        this.phaseDeadlineKey(sessionId),
        this.now().valueOf() + reconnectGraceMs,
        connectionId,
        reconnectGraceMs,
        this.now().valueOf(),
        abandonedSessionTtlMs,
        sessionId,
        sessionTtlMs,
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((acquired) => acquired === 1);
  }

  clearReconnectGrace(sessionId: string): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      runRedisLuaCommand<number>(
        this.redis,
        `if redis.call('GET', KEYS[1]) == 'abandoned' then return 0 end
         return redis.call('DEL', KEYS[1])`,
        1,
        this.lifecycleKey(sessionId),
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((updated) => updated === 1);
  }

  beginReconnectGrace(
    sessionId: string,
    reconnectGraceDeadline: string,
  ): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      this.redis.set(
        this.lifecycleKey(sessionId),
        `grace:${Date.parse(reconnectGraceDeadline)}|${reconnectGraceDeadline}`,
        'PX',
        sessionTtlMs,
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((updated) => updated === 'OK');
  }

  releaseReconnectLeaseAndBeginGrace(
    sessionId: string,
    connectionId: string,
    holderId: string,
    reconnectGraceDeadline: string,
  ): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      runRedisLuaCommand<number>(
        this.redis,
        `local leaseDeadline = redis.call('ZSCORE', KEYS[3], ARGV[1])
         if not leaseDeadline then return 0 end
         if tonumber(leaseDeadline) <= tonumber(ARGV[2]) then
           redis.call('ZREM', KEYS[3], ARGV[1])
           redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[2])
           if redis.call('ZCARD', KEYS[3]) > 0 then return 0 end
           if not redis.call('GET', KEYS[1]) then return 0 end
           if redis.call('GET', KEYS[7]) ~= 'in-progress' then return 0 end
           redis.call('SET', KEYS[6], 'abandoned', 'PX', ARGV[6])
           redis.call('SET', KEYS[7], 'abandoned', 'PX', ARGV[6])
           redis.call('PEXPIRE', KEYS[1], ARGV[6])
           redis.call('PEXPIRE', KEYS[2], ARGV[6])
           redis.call('PEXPIRE', KEYS[4], ARGV[6])
           redis.call('PEXPIRE', KEYS[8], ARGV[6])
           redis.call('PEXPIRE', KEYS[9], ARGV[6])
           redis.call('ZREM', KEYS[5], ARGV[7])
           if redis.call('GET', KEYS[10]) == ARGV[7] then redis.call('DEL', KEYS[10]) end
           return 1
         end
         local removed = redis.call('ZREM', KEYS[3], ARGV[1])
         if removed == 0 then return 0 end
         redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[2])
         if redis.call('ZCARD', KEYS[3]) > 0 then return 0 end
         if not redis.call('GET', KEYS[1]) then return 0 end
         if redis.call('GET', KEYS[7]) ~= 'in-progress' then
           redis.call('DEL', KEYS[6])
           return 1
         end
         redis.call('SET', KEYS[6], 'grace:' .. ARGV[5] .. '|' .. ARGV[3], 'PX', ARGV[4])
         return 1`,
        10,
        this.snapshotKey(sessionId),
        this.snapshotVersionKey(sessionId),
        this.reconnectLeasesKey(sessionId),
        this.eventsKey(sessionId),
        this.activeSessionsKey(),
        this.lifecycleKey(sessionId),
        this.statusKey(sessionId),
        this.lastActivityKey(sessionId),
        this.phaseDeadlineKey(sessionId),
        this.holderActiveSessionKey(holderId),
        connectionId,
        this.now().valueOf(),
        reconnectGraceDeadline,
        sessionTtlMs,
        Date.parse(reconnectGraceDeadline),
        abandonedSessionTtlMs,
        sessionId,
        holderId,
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((started) => started === 1);
  }

  releaseReconnectLease(
    sessionId: string,
    connectionId: string,
  ): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      runRedisLuaCommand<number>(
        this.redis,
        `return redis.call('ZREM', KEYS[1], ARGV[1])`,
        1,
        this.reconnectLeasesKey(sessionId),
        connectionId,
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((released) => released === 1);
  }

  abandonIfReconnectExpired(
    sessionId: string,
    reconnectGraceDeadline: string,
    holderId: string,
  ): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      runRedisLuaCommand<number>(
        this.redis,
        `if not redis.call('GET', KEYS[1]) then return 0 end
         redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[2])
         if redis.call('ZCARD', KEYS[3]) > 0 then return 0 end
         if redis.call('GET', KEYS[6]) ~= 'grace:' .. ARGV[5] .. '|' .. ARGV[1] then return 0 end
         if redis.call('GET', KEYS[7]) ~= 'in-progress' then return 0 end
         redis.call('SET', KEYS[6], 'abandoned', 'PX', ARGV[3])
         redis.call('SET', KEYS[7], 'abandoned', 'PX', ARGV[3])
         redis.call('PEXPIRE', KEYS[1], ARGV[3])
         redis.call('PEXPIRE', KEYS[2], ARGV[3])
         redis.call('PEXPIRE', KEYS[8], ARGV[3])
         redis.call('PEXPIRE', KEYS[9], ARGV[3])
         redis.call('PEXPIRE', KEYS[4], ARGV[3])
         redis.call('ZREM', KEYS[5], ARGV[4])
         if redis.call('GET', KEYS[10]) == ARGV[4] then
           redis.call('DEL', KEYS[10])
         end
         return 1`,
        10,
        this.snapshotKey(sessionId),
        this.snapshotVersionKey(sessionId),
        this.reconnectLeasesKey(sessionId),
        this.eventsKey(sessionId),
        this.activeSessionsKey(),
        this.lifecycleKey(sessionId),
        this.statusKey(sessionId),
        this.lastActivityKey(sessionId),
        this.phaseDeadlineKey(sessionId),
        this.holderActiveSessionKey(holderId),
        reconnectGraceDeadline,
        this.now().valueOf(),
        abandonedSessionTtlMs,
        sessionId,
        Date.parse(reconnectGraceDeadline),
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((abandoned) => abandoned === 1);
  }

  abandonIfReconnectLeaseExpired(
    sessionId: string,
    reconnectLeaseDeadline: string,
    holderId: string,
  ): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      runRedisLuaCommand<number>(
        this.redis,
        `if not redis.call('GET', KEYS[1]) then return 0 end
         redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[2])
         if redis.call('ZCARD', KEYS[3]) > 0 then return 0 end
         if redis.call('GET', KEYS[6]) ~= 'lease:' .. ARGV[5] .. '|' .. ARGV[5] then return 0 end
         if redis.call('GET', KEYS[7]) ~= 'in-progress' then return 0 end
         redis.call('SET', KEYS[6], 'abandoned', 'PX', ARGV[3])
         redis.call('SET', KEYS[7], 'abandoned', 'PX', ARGV[3])
         redis.call('PEXPIRE', KEYS[1], ARGV[3])
         redis.call('PEXPIRE', KEYS[2], ARGV[3])
         redis.call('PEXPIRE', KEYS[8], ARGV[3])
         redis.call('PEXPIRE', KEYS[9], ARGV[3])
         redis.call('PEXPIRE', KEYS[4], ARGV[3])
         redis.call('ZREM', KEYS[5], ARGV[4])
         if redis.call('GET', KEYS[10]) == ARGV[4] then redis.call('DEL', KEYS[10]) end
         return 1`,
        10,
        this.snapshotKey(sessionId),
        this.snapshotVersionKey(sessionId),
        this.reconnectLeasesKey(sessionId),
        this.eventsKey(sessionId),
        this.activeSessionsKey(),
        this.lifecycleKey(sessionId),
        this.statusKey(sessionId),
        this.lastActivityKey(sessionId),
        this.phaseDeadlineKey(sessionId),
        this.holderActiveSessionKey(holderId),
        reconnectLeaseDeadline,
        this.now().valueOf(),
        abandonedSessionTtlMs,
        sessionId,
        Date.parse(reconnectLeaseDeadline),
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((abandoned) => abandoned === 1);
  }

  expireInactiveSessions(): ResultAsync<void, DurableSessionError> {
    return this.activeSnapshots().andThen((snapshots) =>
      ResultAsync.combine(
        map(snapshots, (snapshot) =>
          ResultAsync.fromPromise(
            runRedisLuaCommand<number>(
              this.redis,
              `if not redis.call('GET', KEYS[1]) then return 0 end
               if redis.call('GET', KEYS[6]) ~= 'in-progress' then return 0 end
               if redis.call('GET', KEYS[7]) ~= ARGV[1] then return 0 end
               if tonumber(ARGV[2]) - tonumber(ARGV[3]) < tonumber(ARGV[4]) then return 0 end
               redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', ARGV[2])
               if redis.call('ZCARD', KEYS[4]) > 0 then return 0 end
               redis.call('DEL', KEYS[1])
               redis.call('DEL', KEYS[2])
               redis.call('DEL', KEYS[3])
               redis.call('DEL', KEYS[4])
               redis.call('DEL', KEYS[6])
               redis.call('DEL', KEYS[7])
               redis.call('DEL', KEYS[8])
               redis.call('DEL', KEYS[10])
               redis.call('ZREM', KEYS[5], ARGV[5])
               if redis.call('GET', KEYS[9]) == ARGV[5] then redis.call('DEL', KEYS[9]) end
               return 1`,
              10,
              this.snapshotKey(snapshot.sessionId),
              this.snapshotVersionKey(snapshot.sessionId),
              this.eventsKey(snapshot.sessionId),
              this.reconnectLeasesKey(snapshot.sessionId),
              this.activeSessionsKey(),
              this.statusKey(snapshot.sessionId),
              this.lastActivityKey(snapshot.sessionId),
              this.phaseDeadlineKey(snapshot.sessionId),
              this.holderActiveSessionKey(snapshot.holderId),
              this.lifecycleKey(snapshot.sessionId),
              snapshot.lastActivityAt,
              this.now().valueOf(),
              dayjs(snapshot.lastActivityAt).valueOf(),
              inProgressIdleTtlMs,
              snapshot.sessionId,
            ),
            (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
          ),
        ),
      ).map(() => undefined),
    );
  }

  claimPhaseDeadline(
    sessionId: string,
    phaseDeadline: string,
  ): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      runRedisLuaCommand<number>(
        this.redis,
        `if not redis.call('GET', KEYS[1]) then return 0 end
         if redis.call('GET', KEYS[3]) ~= 'in-progress' then return 0 end
         if redis.call('GET', KEYS[4]) ~= ARGV[1] then return 0 end
         return redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2], 'NX') and 1 or 0`,
        4,
        this.snapshotKey(sessionId),
        this.phaseClaimKey(sessionId, phaseDeadline),
        this.statusKey(sessionId),
        this.phaseDeadlineKey(sessionId),
        phaseDeadline,
        phaseDeadlineClaimLeaseMs,
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((claimed) => claimed === 1);
  }

  resolveExpiredPhase(
    expectedPhaseDeadline: string,
    snapshot: DurableSessionSnapshot,
    event: DurablePublicEvent,
  ): ResultAsync<boolean, DurableSessionError> {
    const ttlMs = snapshot.status === 'abandoned' ? abandonedSessionTtlMs : sessionTtlMs;
    return ResultAsync.fromPromise(
      runRedisLuaCommand<number>(
        this.redis,
        `if not redis.call('GET', KEYS[1]) then return 0 end
         if redis.call('GET', KEYS[6]) ~= 'in-progress' then return 0 end
         if redis.call('GET', KEYS[7]) ~= ARGV[1] then return 0 end
         local lifecycle = redis.call('GET', KEYS[9])
         if lifecycle == 'abandoned' then return 0 end
         local deadline = tonumber(string.match(lifecycle or '', '^[^:]+:(%d+)|'))
         if deadline and deadline <= tonumber(ARGV[9]) then return 0 end
         local currentVersion = redis.call('GET', KEYS[4])
         if not currentVersion or tonumber(currentVersion) ~= tonumber(ARGV[2]) - 1 then return 0 end
         redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4])
         redis.call('SET', KEYS[4], ARGV[2], 'PX', ARGV[4])
         local previousActivity = redis.call('GET', KEYS[5])
         if not previousActivity or previousActivity < ARGV[5] then
           redis.call('SET', KEYS[5], ARGV[5], 'PX', ARGV[4])
         end
         redis.call('SET', KEYS[7], ARGV[6], 'PX', ARGV[4])
         if ARGV[6] == 'in-progress' then
           redis.call('SET', KEYS[8], ARGV[10], 'PX', ARGV[4])
         elseif redis.call('GET', KEYS[8]) == ARGV[10] then
           redis.call('DEL', KEYS[8])
         end
         redis.call('ZADD', KEYS[2], ARGV[2], ARGV[7])
         redis.call('PEXPIRE', KEYS[2], ARGV[8])
         if ARGV[6] == 'in-progress' then
           redis.call('ZADD', KEYS[3], ARGV[9], ARGV[10])
         else
           redis.call('ZREM', KEYS[3], ARGV[10])
         end
         return 1`,
        9,
        this.snapshotKey(snapshot.sessionId),
        this.eventsKey(snapshot.sessionId),
        this.activeSessionsKey(),
        this.snapshotVersionKey(snapshot.sessionId),
        this.lastActivityKey(snapshot.sessionId),
        this.statusKey(snapshot.sessionId),
        this.phaseDeadlineKey(snapshot.sessionId),
        this.holderActiveSessionKey(snapshot.holderId),
        this.lifecycleKey(snapshot.sessionId),
        expectedPhaseDeadline,
        event.eventId,
        JSON.stringify(snapshot),
        ttlMs,
        snapshot.lastActivityAt,
        snapshot.status,
        JSON.stringify(event),
        replayEventTtlMs,
        this.now().valueOf(),
        snapshot.sessionId,
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((resolved) => resolved === 1);
  }

  releasePhaseDeadlineClaim(
    sessionId: string,
    phaseDeadline: string,
  ): ResultAsync<void, DurableSessionError> {
    return ResultAsync.fromPromise(
      this.redis.del(this.phaseClaimKey(sessionId, phaseDeadline)),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map(() => undefined);
  }

  consumeGuestAllowance(
    holderId: string,
    utcDay: string,
    allowance: number,
  ): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      runRedisLuaCommand<number>(
        this.redis,
        `local count = tonumber(redis.call('GET', KEYS[1]) or '0')
         if count >= tonumber(ARGV[2]) then return 0 end
         count = redis.call('INCR', KEYS[1])
         if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
         return 1`,
        1,
        this.allowanceKey(holderId, utcDay),
        this.msUntilNextUtcDay(),
        allowance,
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((result) => result === 1);
  }

  async close() {
    await this.redis.quit();
  }

  private parse<Value>(
    value: string | null,
    key: string,
    schema: v.GenericSchema<unknown, Value>,
  ): Result<Value | undefined, DurableSessionError> {
    if (value === null) return ok(undefined);
    try {
      const parsed: unknown = JSON.parse(value);
      return this.validate(parsed, key, schema);
    } catch {
      return err({ type: 'invalid-authority-data', key });
    }
  }

  private async loadActiveSnapshot(sessionId: string): Promise<DurableSessionSnapshot | undefined> {
    const loaded = await this.load(sessionId);
    return loaded.match(
      async (snapshot) => {
        if (snapshot) return snapshot;
        await this.removeFromActiveIndex(sessionId);
        return undefined;
      },
      async (error) =>
        match(error)
          .with({ type: 'invalid-authority-data' }, async () => {
            await this.removeFromActiveIndex(sessionId);
            return undefined;
          })
          .with({ type: 'authority-unavailable' }, () => undefined)
          .exhaustive(),
    );
  }

  private removeFromActiveIndex(sessionId: string): ResultAsync<void, DurableSessionError> {
    return ResultAsync.fromPromise(
      this.redis.zrem(this.activeSessionsKey(), sessionId),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map(() => undefined);
  }

  private parseMany<Value>(
    values: string[],
    key: string,
    schema: v.GenericSchema<unknown, Value>,
  ): Result<Value[], DurableSessionError> {
    const parsed: Value[] = [];
    for (const value of values) {
      const result = this.parse(value, key, schema);
      if (result.isErr()) return err(result.error);
      if (result.value) parsed.push(result.value);
    }
    return ok(parsed);
  }

  private parseCreationIdempotency(
    value: string | null,
    key: string,
  ): Result<DurableCreationIdempotencyRecord | undefined, DurableSessionError> {
    if (value === null) return ok(undefined);
    const separator = value.indexOf('\n');
    if (separator <= 0 || separator === value.length - 1)
      return err({ type: 'invalid-authority-data', key });
    return this.validate(
      { fingerprint: value.slice(0, separator), sessionId: value.slice(separator + 1) },
      key,
      DurableCreationIdempotencyRecordSchema,
    );
  }

  private validate<Value>(
    value: unknown,
    key: string,
    schema: v.GenericSchema<unknown, Value>,
  ): Result<Value, DurableSessionError> {
    const parsed = v.safeParse(schema, value);
    return parsed.success ? ok(parsed.output) : err({ type: 'invalid-authority-data', key });
  }

  private serializeCreationIdempotency(record: DurableCreationIdempotencyRecord) {
    return `${record.fingerprint}\n${record.sessionId}`;
  }

  private snapshotKey(sessionId: string) {
    return `${this.keyPrefix}:snapshots:${sessionId}`;
  }

  private eventsKey(sessionId: string) {
    return `${this.keyPrefix}:events:${sessionId}`;
  }

  private snapshotVersionKey(sessionId: string) {
    return `${this.keyPrefix}:snapshot-versions:${sessionId}`;
  }

  private reconnectLeasesKey(sessionId: string) {
    return `${this.keyPrefix}:reconnect-leases:${sessionId}`;
  }

  private lifecycleKey(sessionId: string) {
    return `${this.keyPrefix}:lifecycles:${sessionId}`;
  }

  private allowanceKey(holderId: string, utcDay: string) {
    return `${this.keyPrefix}:guest-allowances:${utcDay}:${holderId}`;
  }

  private creationIdempotencyKey(holderId: string, idempotencyKey: string) {
    return `${this.keyPrefix}:creation-idempotency:${holderId}:${idempotencyKey}`;
  }

  private creationReservationKey(sessionId: string) {
    return `${this.keyPrefix}:creation-reservations:${sessionId}`;
  }

  private phaseClaimKey(sessionId: string, phaseDeadline: string) {
    return `${this.keyPrefix}:phase-claims:${sessionId}:${phaseDeadline}`;
  }

  private activeSessionsKey() {
    return `${this.keyPrefix}:active-sessions`;
  }

  private lastActivityKey(sessionId: string) {
    return `${this.keyPrefix}:last-activity:${sessionId}`;
  }

  private phaseDeadlineKey(sessionId: string) {
    return `${this.keyPrefix}:phase-deadlines:${sessionId}`;
  }

  private statusKey(sessionId: string) {
    return `${this.keyPrefix}:statuses:${sessionId}`;
  }

  private holderActiveSessionKey(holderId: string) {
    return `${this.keyPrefix}:holder-active-sessions:${holderId}`;
  }

  private msUntilNextUtcDay() {
    const now = dayjs(this.now());
    return now.utc().add(1, 'day').startOf('day').diff(now);
  }
}
