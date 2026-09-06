import type { MafiaGameSessionSnapshot } from '@repo/mafia';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import Redis from 'ioredis';
import { ResultAsync, err, ok, type Result } from 'neverthrow';
import { filter, flatMap, map } from 'remeda';

import type { MafiaGameSessionProjectionEntity } from '../entities/mafia-game-session-projection.entity';
import type {
  ScheduledAgentFinalDefence,
  ScheduledAgentPublicSpeech,
} from '../entities/stored-game-session.entity';
import type { GameSessionStatus } from '../game-session-status';
import { gameSessionsConfig } from '../game-sessions.config';

dayjs.extend(utc);

export type DurableSessionSnapshot = {
  sessionId: string;
  holderId: string;
  humanParticipantId: string;
  gameSession: MafiaGameSessionSnapshot;
  nextEventId: number;
  phaseDeadline: string;
  lastActivityAt: string;
  status: GameSessionStatus;
  reconnectGraceDeadline: string | undefined;
  cooldowns?: {
    publicSpeech: string | undefined;
    finalDefence: string | undefined;
    discussionTimeAdjustment: string | undefined;
  };
  idempotency?: Record<
    string,
    [string, { fingerprint: string; result: MafiaGameSessionProjectionEntity }][]
  >;
  scheduledAgentPublicSpeeches?: ScheduledAgentPublicSpeech[];
  scheduledAgentFinalDefence?: ScheduledAgentFinalDefence;
  scheduledMafiaTargetFallbackAt?: string;
};

export type DurablePublicEvent = {
  eventId: number;
  projection: MafiaGameSessionProjectionEntity;
};

export type DurableCreationIdempotencyRecord = {
  fingerprint: string;
  sessionId: string;
};

export type DurableCreationResult =
  | { type: 'created' }
  | { type: 'replayed'; record: DurableCreationIdempotencyRecord }
  | { type: 'active-session'; sessionId: string }
  | { type: 'conflict' }
  | { type: 'allowance-exhausted' };

export type DurableSessionError =
  | { type: 'authority-unavailable'; cause: unknown }
  | { type: 'invalid-authority-data'; key: string };

type RedisCommands = Pick<
  Redis,
  'eval' | 'get' | 'set' | 'zadd' | 'zrange' | 'zrangebyscore' | 'del' | 'quit'
>;

const millisecondsPerMinute = 60 * 1000;
const sessionTtlMs = gameSessionsConfig.sessionIdleTtlHours * 60 * millisecondsPerMinute;
const replayEventTtlMs = sessionTtlMs;
const reconnectGraceMs = gameSessionsConfig.reconnectGraceMs;
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
      ? new RedisGameSessionAuthority(new Redis(redisUrl, { lazyConnect: true }))
      : undefined;
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
      this.redis.eval(
        `local previousVersion = redis.call('GET', KEYS[4])
         local expectedVersion = tonumber(ARGV[8])
         if expectedVersion == 0 then
           if previousVersion then return 0 end
         elseif not previousVersion or tonumber(previousVersion) ~= expectedVersion then
           return 0
         end
         local lifecycle = redis.call('GET', KEYS[5])
         if lifecycle == 'abandoned' then return 0 end
         redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
         redis.call('SET', KEYS[4], ARGV[3], 'PX', ARGV[2])
         redis.call('SET', KEYS[6], ARGV[9], 'PX', ARGV[2])
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
        9,
        snapshotKey,
        eventsKey,
        this.activeSessionsKey(),
        this.snapshotVersionKey(snapshot.sessionId),
        this.lifecycleKey(snapshot.sessionId),
        this.lastActivityKey(snapshot.sessionId),
        this.phaseDeadlineKey(snapshot.sessionId),
        this.statusKey(snapshot.sessionId),
        this.holderActiveSessionKey(snapshot.holderId),
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
      .andThen((value) => this.parse<DurableSessionSnapshot>(value, key))
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
          if (!lifecycle?.startsWith('grace:')) return snapshot;
          snapshot.reconnectGraceDeadline = lifecycle.slice('grace:'.length);
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
  ): ResultAsync<DurableCreationResult, DurableSessionError> {
    const idempotencyKey = idempotency
      ? this.creationIdempotencyKey(holderId, idempotency.key)
      : this.creationReservationKey(snapshot.sessionId);
    return ResultAsync.fromPromise(
      this.redis.eval(
        `if ARGV[8] == '1' then
           local existing = redis.call('GET', KEYS[5])
           if existing then
             if string.sub(existing, 1, string.len(ARGV[9]) + 1) == ARGV[9] .. string.char(10) then return 2 end
             return 3
           end
         end
         local activeSessionId = redis.call('GET', KEYS[10])
         if activeSessionId then return 'active:' .. activeSessionId end
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
        this.allowanceKey(holderId, utcDay),
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
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).andThen((value) => {
      if (typeof value === 'string' && value.startsWith('active:')) {
        return ok<DurableCreationResult, DurableSessionError>({
          type: 'active-session',
          sessionId: value.slice('active:'.length),
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
    ).andThen((sessionIds) =>
      ResultAsync.combine(map(sessionIds, (sessionId) => this.load(sessionId))).map((snapshots) =>
        flatMap(snapshots, (snapshot) => (snapshot ? [snapshot] : [])),
      ),
    );
  }

  eventsAfter(
    sessionId: string,
    eventId: number,
  ): ResultAsync<DurablePublicEvent[], DurableSessionError> {
    const key = this.eventsKey(sessionId);
    return ResultAsync.fromPromise(this.redis.zrange(key, 0, -1), (cause): DurableSessionError => ({
      type: 'authority-unavailable',
      cause,
    }))
      .andThen((values) => this.parseMany<DurablePublicEvent>(values, key))
      .map((events) => filter(events, (event) => event.eventId > eventId));
  }

  touch(sessionId: string, lastActivityAt: string): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      this.redis.eval(
        `if not redis.call('GET', KEYS[1]) then return 0 end
         if redis.call('GET', KEYS[3]) ~= 'in-progress' then return 0 end
         if redis.call('GET', KEYS[4]) == 'abandoned' then return 0 end
         redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2])
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
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((touched) => touched === 1);
  }

  acquireReconnectLease(
    sessionId: string,
    connectionId: string,
  ): ResultAsync<void, DurableSessionError> {
    return ResultAsync.fromPromise(
      this.redis.eval(
        `redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
         redis.call('PEXPIRE', KEYS[1], ARGV[3])
         return 1`,
        1,
        this.reconnectLeasesKey(sessionId),
        this.now().valueOf() + reconnectGraceMs,
        connectionId,
        reconnectGraceMs,
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map(() => undefined);
  }

  clearReconnectGrace(sessionId: string): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      this.redis.eval(
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
        `grace:${reconnectGraceDeadline}`,
        'PX',
        sessionTtlMs,
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((updated) => updated === 'OK');
  }

  releaseReconnectLeaseAndBeginGrace(
    sessionId: string,
    connectionId: string,
    reconnectGraceDeadline: string,
  ): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      this.redis.eval(
        `local removed = redis.call('ZREM', KEYS[2], ARGV[1])
         if removed == 0 then return 0 end
         redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[2])
         if redis.call('ZCARD', KEYS[2]) > 0 then return 0 end
         if not redis.call('GET', KEYS[1]) then return 0 end
         redis.call('SET', KEYS[3], 'grace:' .. ARGV[3], 'PX', ARGV[4])
         return 1`,
        3,
        this.snapshotKey(sessionId),
        this.reconnectLeasesKey(sessionId),
        this.lifecycleKey(sessionId),
        connectionId,
        this.now().valueOf(),
        reconnectGraceDeadline,
        sessionTtlMs,
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((started) => started === 1);
  }

  releaseReconnectLease(
    sessionId: string,
    connectionId: string,
  ): ResultAsync<boolean, DurableSessionError> {
    return ResultAsync.fromPromise(
      this.redis.eval(
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
      this.redis.eval(
        `if not redis.call('GET', KEYS[1]) then return 0 end
         redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[2])
         if redis.call('ZCARD', KEYS[3]) > 0 then return 0 end
         if redis.call('GET', KEYS[6]) ~= 'grace:' .. ARGV[1] then return 0 end
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
      ),
      (cause): DurableSessionError => ({ type: 'authority-unavailable', cause }),
    ).map((abandoned) => abandoned === 1);
  }

  expireInactiveSessions(): ResultAsync<void, DurableSessionError> {
    return this.activeSnapshots().andThen((snapshots) =>
      ResultAsync.combine(
        map(snapshots, (snapshot) =>
          ResultAsync.fromPromise(
            this.redis.eval(
              `if not redis.call('GET', KEYS[1]) then return 0 end
               if redis.call('GET', KEYS[6]) ~= 'in-progress' then return 0 end
               if redis.call('GET', KEYS[7]) ~= ARGV[1] then return 0 end
               if tonumber(ARGV[2]) - tonumber(ARGV[3]) < tonumber(ARGV[4]) then return 0 end
               redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', ARGV[2])
               if redis.call('ZCARD', KEYS[4]) > 0 then return 0 end
               redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[6], KEYS[7], KEYS[8])
               redis.call('ZREM', KEYS[5], ARGV[5])
               if redis.call('GET', KEYS[9]) == ARGV[5] then redis.call('DEL', KEYS[9]) end
               return 1`,
              9,
              this.snapshotKey(snapshot.sessionId),
              this.snapshotVersionKey(snapshot.sessionId),
              this.eventsKey(snapshot.sessionId),
              this.reconnectLeasesKey(snapshot.sessionId),
              this.activeSessionsKey(),
              this.statusKey(snapshot.sessionId),
              this.lastActivityKey(snapshot.sessionId),
              this.phaseDeadlineKey(snapshot.sessionId),
              this.holderActiveSessionKey(snapshot.holderId),
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
      this.redis.eval(
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
        reconnectGraceMs,
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
      this.redis.eval(
        `if not redis.call('GET', KEYS[1]) then return 0 end
         if redis.call('GET', KEYS[6]) ~= 'in-progress' then return 0 end
         if redis.call('GET', KEYS[7]) ~= ARGV[1] then return 0 end
         redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4])
         redis.call('SET', KEYS[4], ARGV[2], 'PX', ARGV[4])
         redis.call('SET', KEYS[5], ARGV[5], 'PX', ARGV[4])
         redis.call('SET', KEYS[7], ARGV[6], 'PX', ARGV[4])
         if ARGV[6] == 'in-progress' then
           redis.call('SET', KEYS[8], ARGV[10], 'PX', ARGV[4])
         elseif redis.call('GET', KEYS[8]) == ARGV[10] then
           redis.call('DEL', KEYS[8])
         end
         redis.call('ZADD', KEYS[2], ARGV[2], ARGV[7])
         redis.call('PEXPIRE', KEYS[2], ARGV[8])
         redis.call('ZADD', KEYS[3], ARGV[9], ARGV[10])
         return 1`,
        8,
        this.snapshotKey(snapshot.sessionId),
        this.eventsKey(snapshot.sessionId),
        this.activeSessionsKey(),
        this.snapshotVersionKey(snapshot.sessionId),
        this.lastActivityKey(snapshot.sessionId),
        this.statusKey(snapshot.sessionId),
        this.phaseDeadlineKey(snapshot.sessionId),
        this.holderActiveSessionKey(snapshot.holderId),
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
      this.redis.eval(
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
  ): Result<Value | undefined, DurableSessionError> {
    if (value === null) return ok(undefined);
    try {
      // Redis is the configured authority; the caller owns validation of its bounded record type.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return ok(JSON.parse(value) as Value);
    } catch {
      return err({ type: 'invalid-authority-data', key });
    }
  }

  private parseMany<Value>(values: string[], key: string): Result<Value[], DurableSessionError> {
    const parsed: Value[] = [];
    for (const value of values) {
      const result = this.parse<Value>(value, key);
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
    return ok({ fingerprint: value.slice(0, separator), sessionId: value.slice(separator + 1) });
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
