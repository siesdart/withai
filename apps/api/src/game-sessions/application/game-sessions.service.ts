import { randomUUID } from 'node:crypto';

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { MafiaGameModule, mafiaGameConfig, type MafiaOutputLanguage } from '@repo/mafia';
import type { MafiaGameProjection } from '@repo/mafia';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { err, ok, type Result } from 'neverthrow';
import {
  concat,
  concatMap,
  defer,
  filter,
  finalize,
  from,
  mergeMap,
  Observable,
  of,
  ReplaySubject,
  startWith,
  takeWhile,
} from 'rxjs';
import { match, P } from 'ts-pattern';

import {
  agentDecisionGateway,
  type AgentDecisionGateway,
} from '../agents/agent-decision.gateway.js';
import { createAgentMinds } from '../agents/agent-mind.js';
import { GameSessionAgentOrchestrator } from '../agents/game-session-agent-orchestrator.js';
import {
  type DurableSessionSnapshot,
  RedisGameSessionAuthority,
} from '../durability/redis-game-session-authority.js';
import { cooldownRetryAfterMs } from './cooldown/cooldown.js';
import {
  gameSessionClock,
  nativeGameSessionClock,
  type GameSessionClock,
} from './game-session-clock.js';
import { GameSessionDurability } from './game-session-durability.js';
import type { GameSessionError } from './game-session-error.js';
import { GameSessionLifecycle } from './game-session-lifecycle.js';
import { gameSessionsConfig } from './game-sessions.config.js';
import {
  type IdempotencyRecord,
  lookupIdempotency,
  recordIdempotency,
} from './idempotency/idempotency-ledger.js';
import { KeyedRetryScheduler } from './keyed-retry-scheduler.js';
import { mafiaNightPhaseKey, type StoredGameSessionEntity } from './stored-game-session.entity.js';

dayjs.extend(utc);

export type { GameSessionError } from './game-session-error.js';

type CreatedMafiaSession = {
  holderId: string;
  projection: MafiaGameProjection;
};
type ActiveMafiaSession = {
  projection: MafiaGameProjection;
  outputLanguage: MafiaOutputLanguage;
};
export type GuestPlayAllowance = {
  holderId: string;
  remaining: number;
  limit: number;
  resetsAt: string;
};

type IdempotentProjectionAction = {
  idempotencyKey: string;
  fingerprint: string;
  conflict: GameSessionError;
  records: (
    session: StoredGameSessionEntity,
  ) => Map<string, IdempotencyRecord<MafiaGameProjection>>;
  submit: (session: StoredGameSessionEntity) => Result<MafiaGameProjection, GameSessionError>;
  beforeSave?: (session: StoredGameSessionEntity) => void | Promise<void>;
  afterCommit?: (session: StoredGameSessionEntity) => void;
  runConcurrently?: boolean;
  skipHydration?: boolean;
};

@Injectable()
export class GameSessionsService implements OnModuleInit, OnModuleDestroy {
  private readonly mafiaModule: MafiaGameModule;
  private readonly sessions = new Map<string, StoredGameSessionEntity>();
  private readonly guestSessionCounts = new Map<string, number>();
  private readonly activeSessionIdsByHolder = new Map<string, string>();
  private readonly latestSessionIdsByHolder = new Map<string, string>();
  private readonly idempotencyKeys = new Map<string, IdempotencyRecord<string>>();
  private readonly sessionMutationTails = new Map<string, Promise<void>>();
  private readonly agentActionRetries: KeyedRetryScheduler;
  private readonly phaseTransitionRetries: KeyedRetryScheduler;
  private readonly scheduledAgentRetries: KeyedRetryScheduler;
  private readonly mafiaChatReplyRetries: KeyedRetryScheduler;
  private readonly pendingAgentActionSessionIds = new Set<string>();
  private readonly agentActionSubmissions = new Map<
    string,
    Promise<Result<void, GameSessionError>>
  >();
  private readonly eventSubscriberCounts = new Map<string, number>();
  private readonly agentActions: GameSessionAgentOrchestrator;
  private readonly durability: GameSessionDurability;
  private readonly lifecycle: GameSessionLifecycle;
  private readonly authority = RedisGameSessionAuthority.fromEnvironment();
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(agentDecisionGateway) agentDecisions: AgentDecisionGateway,
    @Inject(gameSessionClock) private readonly clock: GameSessionClock = nativeGameSessionClock,
  ) {
    this.agentActionRetries = new KeyedRetryScheduler(this.clock);
    this.phaseTransitionRetries = new KeyedRetryScheduler(this.clock);
    this.scheduledAgentRetries = new KeyedRetryScheduler(this.clock);
    this.mafiaChatReplyRetries = new KeyedRetryScheduler(this.clock);
    this.mafiaModule = new MafiaGameModule(undefined, undefined, () => this.clock.now());
    this.agentActions = new GameSessionAgentOrchestrator(
      agentDecisions,
      (session, mutate, schedulePhaseTransition, hydrationLocked) =>
        this.commitAgentMutation(session, mutate, 0, schedulePhaseTransition, hydrationLocked),
      this.clock,
      (session) => this.sessions.get(session.gameSession.snapshot().sessionId),
    );
    this.durability = new GameSessionDurability(
      () => this.authority,
      this.clock,
      this.sessions,
      this.disposeSession.bind(this),
    );
    this.lifecycle = new GameSessionLifecycle({
      state: {
        sessions: this.sessions,
        guestSessionCounts: this.guestSessionCounts,
        idempotencyKeys: this.idempotencyKeys,
        eventSubscriberCounts: this.eventSubscriberCounts,
      },
      persistence: {
        authorityFor: () => this.authority,
        save: this.saveAuthoritativeProjection.bind(this),
        hydrate: this.hydrateAuthoritativeSession.bind(this),
        snapshotFor: this.durableSnapshot.bind(this),
        restore: this.durability.restore.bind(this.durability),
      },
      phaseOperations: {
        projectionFor: this.projectionFor.bind(this),
        publishProjection: this.publishProjection.bind(this),
        submitAgentActions: this.submitAndCommitAgentActions.bind(this),
        retryAgentActions: this.retryAgentActions.bind(this),
        retryMafiaChatReplies: this.retryMafiaChatReplies.bind(this),
        retryPhaseTransition: this.retryPhaseTransition.bind(this),
        retryPhaseTransitionAfterClaimLease: this.retryPhaseTransitionAfterClaimLease.bind(this),
      },
      clock: this.clock,
      agentActions: this.agentActions,
      disposeSession: this.disposeSession.bind(this),
      now: this.now.bind(this),
      utcDay: this.utcDay.bind(this),
    });
  }

  async onModuleInit() {
    if (!this.authority && this.requiresDurableAuthority()) {
      throw new Error('REDIS_URL is required for durable Game Sessions.');
    }
    await this.lifecycle.recoverDurableSessions();
    this.cleanupTimer = this.clock.setInterval(
      () => void this.lifecycle.cleanupExpiredSessions(),
      gameSessionsConfig.cleanupIntervalMs,
    );
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      this.clock.clearInterval(this.cleanupTimer);
    }
    this.agentActionRetries.clearAll();
    this.phaseTransitionRetries.clearAll();
    this.scheduledAgentRetries.clearAll();
    this.mafiaChatReplyRetries.clearAll();
    void this.authority?.close();
  }

  async createMafiaSession(
    holderId: string | undefined,
    participantCount: number = mafiaGameConfig.defaultParticipantCount,
    idempotencyKey: string | undefined,
    humanName?: string,
    outputLanguage: MafiaOutputLanguage = 'ko',
    awaitInitialAgentActions = true,
    allowanceHolderId?: string,
  ): Promise<Result<CreatedMafiaSession, GameSessionError>> {
    if (!this.authority && this.requiresDurableAuthority()) {
      return err({ type: 'durability-unavailable' });
    }
    void this.lifecycle.cleanupExpiredSessions();
    const resolvedHolderId = holderId ?? randomUUID();
    const resolvedAllowanceHolderId = allowanceHolderId ?? resolvedHolderId;
    const activeSessionId = this.activeSessionIdsByHolder.get(resolvedHolderId);
    if (!this.authority && activeSessionId) {
      const activeSession = this.sessions.get(activeSessionId);
      if (activeSession?.status === 'in-progress') {
        return this.projectionFor(activeSession).map((projection) => ({
          holderId: resolvedHolderId,
          projection,
        }));
      }
      this.activeSessionIdsByHolder.delete(resolvedHolderId);
    }
    const scopedIdempotencyKey = idempotencyKey && `${resolvedHolderId}:${idempotencyKey}`;
    if (!this.authority && scopedIdempotencyKey) {
      const lookup = lookupIdempotency(
        this.idempotencyKeys,
        scopedIdempotencyKey,
        JSON.stringify({ participantCount, humanName, outputLanguage }),
      );
      const idempotencyResult = match(lookup)
        .with({ type: 'conflict' }, () =>
          err<CreatedMafiaSession, GameSessionError>({ type: 'idempotency-conflict' }),
        )
        .with({ type: 'replayed' }, ({ result }) => {
          const existingSession = this.sessions.get(result);
          if (!existingSession) {
            this.idempotencyKeys.delete(scopedIdempotencyKey);
            return undefined;
          }

          this.touch(existingSession);
          return this.projectionFor(existingSession).map((projection) => ({
            holderId: resolvedHolderId,
            projection,
          }));
        })
        .with({ type: 'new-request' }, () => undefined)
        .exhaustive();
      if (idempotencyResult) return idempotencyResult;
    }

    const countKey = `${this.utcDay()}:${resolvedAllowanceHolderId}`;
    if (!this.authority) {
      const count = this.guestSessionCounts.get(countKey) ?? 0;
      if (count >= gameSessionsConfig.guestAllowance) {
        return err({ type: 'guest-allowance-exhausted' });
      }
      this.guestSessionCounts.set(countKey, count + 1);
    }

    const sessionId = randomUUID();
    const gameSessionResult = this.mafiaModule.create({
      sessionId,
      participantCount,
      humanName: humanName?.trim() || (outputLanguage === 'ko' ? '플레이어' : 'Player'),
      outputLanguage,
    });
    if (gameSessionResult.isErr()) {
      return err({ type: 'invalid-mafia-session-input', cause: gameSessionResult.error });
    }

    const gameSession = gameSessionResult.value;
    const session: StoredGameSessionEntity = {
      holderId: resolvedHolderId,
      humanParticipantId: 'participant-1',
      outputLanguage,
      gameSession,
      agentMinds: createAgentMinds(gameSession, 'participant-1'),
      events: new ReplaySubject<MafiaGameProjection>(gameSessionsConfig.eventReplayBufferSize),
      nextEventId: 0,
      nextPublicSpeechAt: undefined,
      nextFinalDefenceAt: undefined,
      nextDiscussionTimeAdjustmentAt: undefined,
      lastAccessedAt: this.now(),
      status: 'in-progress',
      publicSpeechIdempotencyKeys: new Map(),
      mafiaChatIdempotencyKeys: new Map(),
      dayActionIdempotencyKeys: new Map(),
      discussionTimeAdjustmentIdempotencyKeys: new Map(),
      phaseTimer: undefined,
      agentFinalDefenceTimer: undefined,
      publicSpeechAgentTimers: new Map(),
      mafiaChatReplyTimers: new Map(),
      mafiaTargetFallbackTimer: undefined,
      scheduledAgentPublicSpeeches: [],
      scheduledAgentFinalDefence: undefined,
      scheduledAgentMafiaChatReplies: [],
      scheduledMafiaTargetFallbackAt: undefined,
      autonomousPublicSpeechTurns: 0,
      lastAutonomousPublicSpeechSnapshotKey: undefined,
      autonomousPublicSpeechLimitReachedDiscussionKey: undefined,
      agentActionsPending: true,
      reconnectGraceTimer: undefined,
      reconnectGraceDeadline: undefined,
    };
    if (!this.authority && scopedIdempotencyKey) {
      recordIdempotency(
        this.idempotencyKeys,
        scopedIdempotencyKey,
        JSON.stringify({ participantCount, humanName, outputLanguage }),
        sessionId,
      );
    }
    const projection = this.publishProjection(session);
    if (projection.isErr()) return err(projection.error);
    if (this.authority) {
      const creation = await this.authority.create(
        this.durableSnapshot(session, projection.value),
        { eventId: projection.value.eventId, projection: projection.value },
        resolvedHolderId,
        this.utcDay(),
        gameSessionsConfig.guestAllowance,
        idempotencyKey
          ? {
              key: idempotencyKey,
              fingerprint: JSON.stringify({ participantCount, humanName, outputLanguage }),
            }
          : undefined,
        resolvedAllowanceHolderId,
      );
      if (creation.isErr()) return err({ type: 'durability-unavailable' });
      if (creation.value.type === 'unavailable-session') {
        return err({ type: 'session-not-found', sessionId: creation.value.sessionId });
      }
      if (creation.value.type === 'allowance-exhausted') {
        return err({ type: 'guest-allowance-exhausted' });
      }
      if (creation.value.type === 'conflict') return err({ type: 'idempotency-conflict' });
      if (creation.value.type === 'replayed') {
        const hydrated = await this.hydrateAuthoritativeSession(
          creation.value.record.sessionId,
          false,
          false,
        );
        if (hydrated.isErr()) return err(hydrated.error);
        const existingSession = this.sessions.get(creation.value.record.sessionId);
        if (!existingSession || existingSession.status === 'abandoned') {
          return err({ type: 'session-not-found', sessionId: creation.value.record.sessionId });
        }
        return this.projectionFor(existingSession).map((existingProjection) => ({
          holderId: resolvedHolderId,
          projection: existingProjection,
        }));
      }
      if (creation.value.type === 'active-session') {
        const hydrated = await this.hydrateAuthoritativeSession(
          creation.value.sessionId,
          false,
          false,
        );
        if (hydrated.isErr()) return err(hydrated.error);
        const activeSession = this.sessions.get(creation.value.sessionId);
        if (!activeSession || activeSession.status !== 'in-progress') {
          return err({ type: 'session-not-found', sessionId: creation.value.sessionId });
        }
        return this.projectionFor(activeSession).map((existingProjection) => ({
          holderId: resolvedHolderId,
          projection: existingProjection,
        }));
      }
    }
    this.sessions.set(sessionId, session);
    this.activeSessionIdsByHolder.set(resolvedHolderId, sessionId);
    this.latestSessionIdsByHolder.set(resolvedHolderId, sessionId);
    this.lifecycle.schedulePhaseTransition(session);
    if (awaitInitialAgentActions) {
      const actions = await this.submitAndCommitAgentActions(session);
      if (actions.isErr()) this.retryAgentActions(sessionId);
    } else {
      this.queuePendingAgentActions(session);
    }
    return ok({ holderId: resolvedHolderId, projection: projection.value });
  }

  async activeMafiaSession(
    holderId: string | undefined,
  ): Promise<Result<ActiveMafiaSession | undefined, GameSessionError>> {
    if (!holderId) return ok(undefined);
    if (!this.authority) {
      const sessionId = this.activeSessionIdsByHolder.get(holderId);
      const session = sessionId ? this.sessions.get(sessionId) : undefined;
      if (!session || session.status !== 'in-progress') return ok(undefined);
      return this.projectionFor(session).map((projection) => ({
        projection,
        outputLanguage: session.outputLanguage ?? 'ko',
      }));
    }
    const activeSessionId = await this.authority.activeSessionIdForHolder(holderId);
    if (activeSessionId.isErr()) return err({ type: 'durability-unavailable' });
    if (!activeSessionId.value) return ok(undefined);
    const hydrated = await this.hydrateAuthoritativeSession(activeSessionId.value, false, false);
    if (hydrated.isErr()) {
      await this.authority.clearActiveSessionForHolder(holderId, activeSessionId.value);
      return ok(undefined);
    }
    const session = this.sessions.get(activeSessionId.value);
    if (!session || session.status !== 'in-progress') {
      await this.authority.clearActiveSessionForHolder(holderId, activeSessionId.value);
      return ok(undefined);
    }
    return this.projectionFor(session).map((projection) => ({
      projection,
      outputLanguage: session.outputLanguage ?? 'ko',
    }));
  }

  async latestSessionIdForHolder(
    holderId: string | undefined,
  ): Promise<Result<string | undefined, GameSessionError>> {
    if (!holderId) return ok(undefined);

    if (!this.authority) {
      const sessionId = this.latestSessionIdsByHolder.get(holderId);
      const session = sessionId ? this.sessions.get(sessionId) : undefined;
      if (!session || session.status === 'abandoned') {
        if (sessionId) this.latestSessionIdsByHolder.delete(holderId);
        return ok(undefined);
      }
      return ok(sessionId);
    }

    const latestSessionId = await this.authority.latestSessionIdForHolder(holderId);
    if (latestSessionId.isErr()) return err({ type: 'durability-unavailable' });
    if (!latestSessionId.value) return ok(undefined);

    const hydrated = await this.hydrateAuthoritativeSession(latestSessionId.value, false, false);
    if (hydrated.isErr()) {
      await this.authority.clearLatestSessionForHolder(holderId, latestSessionId.value);
      return ok(undefined);
    }
    const session = this.sessions.get(latestSessionId.value);
    if (!session || session.status === 'abandoned') {
      await this.authority.clearLatestSessionForHolder(holderId, latestSessionId.value);
      return ok(undefined);
    }
    return ok(latestSessionId.value);
  }

  async guestPlayAllowance(
    allowanceHolderId: string,
    holderId: string | undefined,
  ): Promise<Result<GuestPlayAllowance, GameSessionError>> {
    if (!this.authority && this.requiresDurableAuthority()) {
      return err({ type: 'durability-unavailable' });
    }

    const countKey = `${this.utcDay()}:${allowanceHolderId}`;
    const used = this.authority
      ? await this.authority.guestAllowanceUsage(allowanceHolderId, this.utcDay())
      : ok(this.guestSessionCounts.get(countKey) ?? 0);
    if (used.isErr()) return err({ type: 'durability-unavailable' });

    return ok({
      holderId: holderId ?? randomUUID(),
      remaining: Math.max(0, gameSessionsConfig.guestAllowance - used.value),
      limit: gameSessionsConfig.guestAllowance,
      resetsAt: this.nextUtcDay().toISOString(),
    });
  }

  getProjection(
    sessionId: string,
    holderId: string | undefined,
    mutationLocked = false,
  ):
    | Result<MafiaGameProjection, GameSessionError>
    | Promise<Result<MafiaGameProjection, GameSessionError>> {
    if (!this.authority) {
      return this.requiresDurableAuthority()
        ? err({ type: 'durability-unavailable' })
        : this.getProjectionFromMemory(sessionId, holderId);
    }
    return this.hydrateAuthoritativeSession(sessionId, mutationLocked).then(
      async (hydrated): Promise<Result<MafiaGameProjection, GameSessionError>> => {
        if (hydrated.isErr()) return err<MafiaGameProjection, GameSessionError>(hydrated.error);
        const session = this.sessions.get(sessionId);
        if (!session)
          return err<MafiaGameProjection, GameSessionError>({
            type: 'session-not-found',
            sessionId,
          });
        const readableSession = this.sessionForHolder(sessionId, holderId);
        if (readableSession.isErr()) return err(readableSession.error);
        if (readableSession.value.status === 'completed')
          return this.projectionFor(readableSession.value);
        const activeSession = this.activeSessionForHolder(sessionId, holderId);
        if (activeSession.isErr()) return err(activeSession.error);
        const currentProjection = this.projectionFor(session);
        if (currentProjection.isErr()) return currentProjection;
        if (dayjs(currentProjection.value.public.phaseDeadline).isBefore(this.now())) {
          const claimed = await this.authority!.claimPhaseDeadline(
            sessionId,
            currentProjection.value.public.phaseDeadline,
          );
          if (claimed.isErr()) return err({ type: 'durability-unavailable' });
        }
        const recovery = await this.lifecycle.recoverExpiredPhaseDurably(session, mutationLocked);
        if (recovery.isErr()) return err(recovery.error);
        const recoveredSession = this.sessions.get(sessionId);
        if (!recoveredSession) return err({ type: 'session-not-found', sessionId });
        const recoveredActiveSession = this.activeSessionForHolder(sessionId, holderId);
        if (recoveredActiveSession.isErr()) return err(recoveredActiveSession.error);
        const touched = await this.touchAuthoritativeSession(recoveredActiveSession.value);
        if (touched.isErr()) return err(touched.error);
        return this.projectionFor(recoveredSession);
      },
    );
  }

  private getProjectionFromMemory(
    sessionId: string,
    holderId: string | undefined,
  ): Result<MafiaGameProjection, GameSessionError> {
    void this.lifecycle.cleanupExpiredSessions();
    return this.sessionForHolder(sessionId, holderId).andThen((session) => {
      if (session.status === 'completed') return this.projectionFor(session);
      return this.activeSessionForHolder(sessionId, holderId).andThen((activeSession) =>
        this.projectionFor(activeSession),
      );
    });
  }

  eventsFor(
    sessionId: string,
    holderId: string | undefined,
    lastEventId: number | undefined,
  ):
    | Result<Observable<MafiaGameProjection>, GameSessionError>
    | Promise<Result<Observable<MafiaGameProjection>, GameSessionError>> {
    const authority = this.authority;
    if (!authority) {
      return this.requiresDurableAuthority()
        ? err({ type: 'durability-unavailable' })
        : this.eventsForFromMemory(sessionId, holderId, lastEventId);
    }
    return this.hydrateAuthoritativeSession(sessionId).then(async (hydrated) => {
      if (hydrated.isErr())
        return err<Observable<MafiaGameProjection>, GameSessionError>(hydrated.error);
      const readableSession = this.sessionForHolder(sessionId, holderId);
      if (readableSession.isErr())
        return err<Observable<MafiaGameProjection>, GameSessionError>(readableSession.error);
      if (readableSession.value.status === 'completed')
        return this.projectionFor(readableSession.value).map((snapshot) => of(snapshot));
      const session = this.activeSessionForHolder(sessionId, holderId);
      if (session.isErr())
        return err<Observable<MafiaGameProjection>, GameSessionError>(session.error);
      const touched = await this.touchAuthoritativeSession(session.value);
      if (touched.isErr())
        return err<Observable<MafiaGameProjection>, GameSessionError>(touched.error);
      const connectionId = randomUUID();
      const lease = await authority.acquireReconnectLease(
        sessionId,
        connectionId,
        session.value.holderId,
      );
      if (lease.isErr()) return err({ type: 'durability-unavailable' });
      if (!lease.value) return err({ type: 'unavailable-to-guest', sessionId });
      const snapshot = this.projectionFor(session.value);
      if (snapshot.isErr())
        return err<Observable<MafiaGameProjection>, GameSessionError>(snapshot.error);
      return ok<Observable<MafiaGameProjection>, GameSessionError>(
        defer(() => {
          this.addEventSubscriber(sessionId);
          // A current projection is a complete snapshot. Starting from its
          // event version ensures the stream never follows it with older
          // projections from a reconnect cursor.
          let cursor = snapshot.value.eventId;
          return concat(
            from([snapshot.value]),
            this.clockInterval(250).pipe(
              startWith(0),
              concatMap(async () => {
                const renewedLease = await authority.acquireReconnectLease(
                  sessionId,
                  connectionId,
                  session.value.holderId,
                );
                if (renewedLease.isErr() || !renewedLease.value)
                  throw new Error('Game Session is unavailable.');
                const events = await authority.eventsAfter(sessionId, cursor);
                if (events.isErr()) throw new Error('Game Session authority is unavailable.');
                if (events.value.length > 0) cursor = events.value.at(-1)!.eventId;
                return events.value;
              }),
              mergeMap((events) => from(events.map((event) => event.projection))),
            ),
          ).pipe(
            takeWhile((projection) => projection.public.phase !== 'completed', true),
            finalize(() => {
              this.removeEventSubscriber(sessionId);
              void this.releaseReconnectLeaseWithRetry(
                authority,
                sessionId,
                connectionId,
                session.value.holderId,
                this.now().add(gameSessionsConfig.reconnectGraceMs, 'millisecond').toISOString(),
              );
            }),
          );
        }),
      );
    });
  }

  private eventsForFromMemory(
    sessionId: string,
    holderId: string | undefined,
    lastEventId: number | undefined,
  ): Result<Observable<MafiaGameProjection>, GameSessionError> {
    void this.lifecycle.cleanupExpiredSessions();
    const readableSession = this.sessionForHolder(sessionId, holderId);
    if (readableSession.isErr()) return err(readableSession.error);
    if (readableSession.value.status === 'completed')
      return this.projectionFor(readableSession.value).map((snapshot) => of(snapshot));
    return this.activeSessionForHolder(sessionId, holderId).map((session) =>
      defer(() => {
        this.addEventSubscriber(sessionId);
        const connectionId = randomUUID();
        void this.authority?.acquireReconnectLease(sessionId, connectionId, session.holderId);
        if (session.reconnectGraceTimer) {
          this.clock.clearTimeout(session.reconnectGraceTimer);
          session.reconnectGraceTimer = undefined;
          session.reconnectGraceDeadline = undefined;
        }
        this.touch(session);
        return session.events.asObservable().pipe(
          filter((projection) => lastEventId === undefined || projection.eventId > lastEventId),
          finalize(() => {
            this.removeEventSubscriber(sessionId);
            void this.authority?.releaseReconnectLease(sessionId, connectionId);
            this.touch(session);
            if (!this.hasEventSubscribers(sessionId))
              this.lifecycle.scheduleReconnectGrace(session);
          }),
        );
      }),
    );
  }

  publishSessionProjection(sessionId: string): Result<MafiaGameProjection, GameSessionError> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return err({ type: 'session-not-found', sessionId });
    }

    return this.publishProjection(session);
  }

  async submitPublicSpeech(
    sessionId: string,
    holderId: string | undefined,
    content: string,
    idempotencyKey: string,
  ): Promise<Result<MafiaGameProjection, GameSessionError>> {
    const current = this.sessions.get(sessionId);
    if (current) this.agentActions.cancelPublicSpeechReply(current);
    return this.runIdempotentProjectionAction(sessionId, holderId, {
      idempotencyKey,
      fingerprint: content,
      conflict: { type: 'public-speech-idempotency-conflict' },
      records: (session) => session.publicSpeechIdempotencyKeys,
      submit: (session) => {
        const now = this.now();
        const retryAfterMs = cooldownRetryAfterMs(session.nextPublicSpeechAt, now);
        if (retryAfterMs) {
          return err<MafiaGameProjection, GameSessionError>({
            type: 'speech-rate-limited',
            retryAfterMs,
          });
        }

        const speechResult = session.gameSession.submitPublicSpeech(
          session.humanParticipantId,
          content,
          this.clock.now(),
        );
        if (speechResult.isErr()) {
          const error: GameSessionError = match(speechResult.error)
            .with({ type: 'invalid-public-speech' }, () => ({
              type: 'invalid-public-speech' as const,
            }))
            .with({ type: 'expired-phase', phaseDeadline: P.select() }, (phaseDeadline) => ({
              type: 'expired-phase' as const,
              phaseDeadline,
            }))
            .with({ type: 'dead-participant', participantId: P.select() }, (participantId) => ({
              type: 'dead-participant' as const,
              participantId,
            }))
            .with({ type: 'unknown-participant' }, () => ({
              type: 'invalid-public-speech' as const,
            }))
            .with({ type: 'invalid-phase' }, () => ({ type: 'invalid-public-speech' as const }))
            .with({ type: 'not-nominated-participant' }, () => ({
              type: 'invalid-public-speech' as const,
            }))
            .with({ type: 'invalid-target' }, () => ({ type: 'invalid-public-speech' as const }))
            .with({ type: 'invalid-night-action' }, () => ({
              type: 'invalid-public-speech' as const,
            }))
            .with({ type: 'night-action-already-submitted' }, () => ({
              type: 'invalid-public-speech' as const,
            }))
            .exhaustive();
          return err<MafiaGameProjection, GameSessionError>(error);
        }

        return this.publishProjection(session).andTee(() => {
          session.nextPublicSpeechAt = now.add(
            gameSessionsConfig.humanActionCooldownMs,
            'millisecond',
          );
        });
      },
      afterCommit: (session) => this.queuePublicSpeechReplies(session),
    });
  }

  async submitMafiaChat(
    sessionId: string,
    holderId: string | undefined,
    content: string,
    idempotencyKey: string,
  ): Promise<Result<MafiaGameProjection, GameSessionError>> {
    return this.runIdempotentProjectionAction(sessionId, holderId, {
      idempotencyKey,
      fingerprint: content,
      conflict: { type: 'mafia-chat-idempotency-conflict' },
      records: (session) => session.mafiaChatIdempotencyKeys,
      submit: (session) => {
        const now = this.now();
        const retryAfterMs = cooldownRetryAfterMs(session.nextPublicSpeechAt, now);
        if (retryAfterMs) return err({ type: 'speech-rate-limited', retryAfterMs });
        return session.gameSession
          .submitMafiaChat(session.humanParticipantId, content)
          .mapErr((): GameSessionError => ({ type: 'invalid-mafia-chat' }))
          .andThen(() => this.publishProjection(session))
          .andTee(() => {
            session.nextPublicSpeechAt = now.add(
              gameSessionsConfig.humanActionCooldownMs,
              'millisecond',
            );
          });
      },
      afterCommit: (session) => this.queueMafiaChatReplies(session),
    });
  }

  async submitNomination(
    sessionId: string,
    holderId: string | undefined,
    targetParticipantId: string,
    idempotencyKey: string,
  ): Promise<Result<MafiaGameProjection, GameSessionError>> {
    return this.submitDayAction(
      sessionId,
      holderId,
      `nomination:${targetParticipantId}`,
      idempotencyKey,
      (session) =>
        session.gameSession.submitNomination(session.humanParticipantId, targetParticipantId),
    );
  }

  async submitVerdict(
    sessionId: string,
    holderId: string | undefined,
    vote: 'eliminate' | 'spare',
    idempotencyKey: string,
  ): Promise<Result<MafiaGameProjection, GameSessionError>> {
    return this.submitDayAction(sessionId, holderId, `verdict:${vote}`, idempotencyKey, (session) =>
      session.gameSession.submitVerdict(session.humanParticipantId, vote),
    );
  }

  async submitMafiaTarget(
    sessionId: string,
    holderId: string | undefined,
    targetParticipantId: string,
    idempotencyKey: string,
  ) {
    return this.submitDayAction(
      sessionId,
      holderId,
      `mafia-target:${targetParticipantId}`,
      idempotencyKey,
      (session) =>
        session.gameSession.submitMafiaTarget(session.humanParticipantId, targetParticipantId),
    );
  }

  async submitDoctorProtection(
    sessionId: string,
    holderId: string | undefined,
    targetParticipantId: string,
    idempotencyKey: string,
  ) {
    return this.submitDayAction(
      sessionId,
      holderId,
      `doctor-protection:${targetParticipantId}`,
      idempotencyKey,
      (session) =>
        session.gameSession.submitDoctorProtection(session.humanParticipantId, targetParticipantId),
    );
  }

  async submitPoliceInvestigation(
    sessionId: string,
    holderId: string | undefined,
    targetParticipantId: string,
    idempotencyKey: string,
  ) {
    return this.submitDayAction(
      sessionId,
      holderId,
      `police-investigation:${targetParticipantId}`,
      idempotencyKey,
      (session) =>
        session.gameSession.submitPoliceInvestigation(
          session.humanParticipantId,
          targetParticipantId,
        ),
    );
  }

  async adjustDiscussionTime(
    sessionId: string,
    holderId: string | undefined,
    adjustmentSeconds: 10 | -10,
    expectedDeadline: string,
    idempotencyKey: string,
  ): Promise<Result<MafiaGameProjection, GameSessionError>> {
    const fingerprint = `${adjustmentSeconds}:${expectedDeadline}`;
    return this.runIdempotentProjectionAction(sessionId, holderId, {
      idempotencyKey,
      fingerprint,
      conflict: { type: 'discussion-time-adjustment-idempotency-conflict' },
      records: (session) => session.discussionTimeAdjustmentIdempotencyKeys,
      runConcurrently: true,
      skipHydration: true,
      submit: (session) => {
        const currentProjection = session.gameSession.projectionFor(
          session.humanParticipantId,
          session.nextEventId,
        );
        if (currentProjection.isErr()) {
          return err<MafiaGameProjection, GameSessionError>({
            type: 'invalid-mafia-projection',
            cause: currentProjection.error,
          });
        }
        if (currentProjection.value.public.phase !== 'discussion') {
          return err<MafiaGameProjection, GameSessionError>({
            type: 'invalid-discussion-time-adjustment',
          });
        }
        if (currentProjection.value.public.phaseDeadline !== expectedDeadline) {
          return err<MafiaGameProjection, GameSessionError>({
            type: 'stale-discussion-time-adjustment',
          });
        }

        const now = this.now();
        const retryAfterMs = cooldownRetryAfterMs(session.nextDiscussionTimeAdjustmentAt, now);
        if (retryAfterMs) {
          return err<MafiaGameProjection, GameSessionError>({
            type: 'discussion-time-adjustment-rate-limited',
            retryAfterMs,
          });
        }

        const adjustment = session.gameSession.adjustDiscussionTime(
          session.humanParticipantId,
          adjustmentSeconds,
          now.toDate(),
        );
        if (adjustment.isErr()) {
          return err<MafiaGameProjection, GameSessionError>(
            match(adjustment.error)
              .with({ type: 'dead-participant', participantId: P.select() }, (participantId) => ({
                type: 'dead-participant' as const,
                participantId,
              }))
              .with(
                { type: 'unknown-participant' },
                { type: 'expired-phase' },
                { type: 'invalid-phase' },
                { type: 'not-nominated-participant' },
                { type: 'invalid-target' },
                { type: 'invalid-night-action' },
                { type: 'night-action-already-submitted' },
                { type: 'invalid-public-speech' },
                () => ({ type: 'invalid-discussion-time-adjustment' as const }),
              )
              .exhaustive(),
          );
        }

        const phaseResult = session.gameSession.advanceDayPhase(now.toDate());
        phaseResult.match(
          (result) => {
            if (result.type === 'not-due') return;
            this.agentActions.clearTimers(session);
            session.agentActionsPending = true;
          },
          () => undefined,
        );

        return this.publishProjection(session).andTee(() => {
          session.nextDiscussionTimeAdjustmentAt = now.add(
            gameSessionsConfig.humanActionCooldownMs,
            'millisecond',
          );
          this.lifecycle.schedulePhaseTransition(session);
        });
      },
      afterCommit: (session) => {
        this.queuePendingAgentActions(session);
        if (session.gameSession.snapshot().phase === 'discussion')
          this.queuePublicSpeechReplies(session);
      },
    });
  }

  async submitFinalDefence(
    sessionId: string,
    holderId: string | undefined,
    content: string,
    idempotencyKey: string,
  ): Promise<Result<MafiaGameProjection, GameSessionError>> {
    const fingerprint = `final-defence:${content}`;
    return this.runIdempotentProjectionAction(sessionId, holderId, {
      idempotencyKey,
      fingerprint,
      conflict: { type: 'day-action-idempotency-conflict' },
      records: (session) => session.dayActionIdempotencyKeys,
      submit: (session) => {
        const now = this.now();
        const retryAfterMs = cooldownRetryAfterMs(session.nextFinalDefenceAt, now);
        if (retryAfterMs) {
          return err<MafiaGameProjection, GameSessionError>({
            type: 'day-action-rate-limited',
            retryAfterMs,
          });
        }

        const action = session.gameSession.submitFinalDefence(session.humanParticipantId, content);
        if (action.isErr()) {
          return err<MafiaGameProjection, GameSessionError>({
            type: 'invalid-day-action',
          });
        }

        return this.publishProjection(session).andTee(() => {
          session.nextFinalDefenceAt = now.add(
            gameSessionsConfig.humanActionCooldownMs,
            'millisecond',
          );
        });
      },
    });
  }

  private async submitDayAction(
    sessionId: string,
    holderId: string | undefined,
    fingerprint: string,
    idempotencyKey: string,
    submit: (
      session: StoredGameSessionEntity,
    ) => ReturnType<StoredGameSessionEntity['gameSession']['submitNomination']>,
  ): Promise<Result<MafiaGameProjection, GameSessionError>> {
    return this.runIdempotentProjectionAction(sessionId, holderId, {
      idempotencyKey,
      fingerprint,
      conflict: { type: 'day-action-idempotency-conflict' },
      records: (session) => session.dayActionIdempotencyKeys,
      submit: (session) => {
        const action = submit(session);
        if (action.isErr()) {
          return err<MafiaGameProjection, GameSessionError>({
            type: 'invalid-day-action',
          });
        }
        return this.publishProjection(session);
      },
      afterCommit: (session) => this.queuePendingAgentActions(session),
    });
  }

  private async submitPendingAgentActions(session: StoredGameSessionEntity) {
    if (!session.agentActionsPending) return;
    const actions = await this.submitAndCommitAgentActions(session);
    if (actions.isErr()) this.retryAgentActions(session.gameSession.snapshot().sessionId);
  }

  private queuePendingAgentActions(session: StoredGameSessionEntity) {
    const sessionId = session.gameSession.snapshot().sessionId;
    if (this.pendingAgentActionSessionIds.has(sessionId)) return;
    this.pendingAgentActionSessionIds.add(sessionId);
    void Promise.resolve()
      .then(() =>
        // Deliberately do not hold the human-action mutex while the gateway waits for an LLM.
        // Durable writes compare-and-set the authoritative snapshot, so a concurrent Human
        // Player action wins and this stale Agent run hydrates before it can publish anything.
        this.submitPendingAgentActions(session),
      )
      .catch(() => this.retryAgentActions(sessionId))
      .finally(() => this.pendingAgentActionSessionIds.delete(sessionId));
  }

  private async runIdempotentProjectionAction(
    sessionId: string,
    holderId: string | undefined,
    action: IdempotentProjectionAction,
  ): Promise<Result<MafiaGameProjection, GameSessionError>> {
    if (action.runConcurrently)
      return this.runIdempotentProjectionActionUnlocked(sessionId, holderId, action);
    return this.withSessionMutation(sessionId, () =>
      this.runIdempotentProjectionActionUnlocked(sessionId, holderId, action),
    );
  }

  private async runIdempotentProjectionActionUnlocked(
    sessionId: string,
    holderId: string | undefined,
    {
      idempotencyKey,
      fingerprint,
      conflict,
      records,
      submit,
      beforeSave,
      afterCommit,
      runConcurrently = false,
      skipHydration = false,
    }: IdempotentProjectionAction,
    attempt = 0,
  ): Promise<Result<MafiaGameProjection, GameSessionError>> {
    if (this.authority && !skipHydration) {
      const recovered = await this.getProjection(sessionId, holderId, true);
      if (recovered.isErr()) return err<MafiaGameProjection, GameSessionError>(recovered.error);
    }
    let committedAction = false;
    const result = this.activeSessionForHolder(sessionId, holderId).andThen((session) => {
      const ledger = records(session);
      const idempotencyResult = match(lookupIdempotency(ledger, idempotencyKey, fingerprint))
        .with({ type: 'replayed' }, ({ result: replayedProjection }) =>
          ok<MafiaGameProjection, GameSessionError>(replayedProjection),
        )
        .with({ type: 'conflict' }, () => err<MafiaGameProjection, GameSessionError>(conflict))
        .with({ type: 'new-request' }, () => undefined)
        .exhaustive();
      if (idempotencyResult) return idempotencyResult;

      return submit(session).andTee((projection) => {
        committedAction = true;
        recordIdempotency(ledger, idempotencyKey, fingerprint, projection);
      });
    });
    if (result.isErr()) return result;
    if (!this.authority) {
      if (committedAction) await beforeSave?.(this.sessions.get(sessionId)!);
      if (committedAction) afterCommit?.(this.sessions.get(sessionId)!);
      return result;
    }
    if (!committedAction) return result;
    const session = this.sessions.get(sessionId);
    if (!session) return err({ type: 'session-not-found', sessionId });
    await beforeSave?.(session);
    const saved = await this.saveAuthoritativeProjection(session, result.value);
    if (saved.isErr()) {
      await this.hydrateAuthoritativeSessionUnlocked(sessionId);
      return err({ type: 'durability-unavailable' });
    }
    if (!saved.value && attempt < 1) {
      await this.hydrateAuthoritativeSessionUnlocked(sessionId);
      return this.runIdempotentProjectionActionUnlocked(
        sessionId,
        holderId,
        {
          idempotencyKey,
          fingerprint,
          conflict,
          records,
          submit,
          beforeSave,
          afterCommit,
          runConcurrently,
          skipHydration,
        },
        attempt + 1,
      );
    }
    if (!saved.value) await this.hydrateAuthoritativeSessionUnlocked(sessionId);
    if (saved.value && committedAction) afterCommit?.(session);
    return saved.value ? result : err({ type: 'durability-unavailable' });
  }

  private async withSessionMutation<Value>(
    sessionId: string,
    operation: () => Promise<Value>,
  ): Promise<Value> {
    const previous = this.sessionMutationTails.get(sessionId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => tail);
    this.sessionMutationTails.set(sessionId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.sessionMutationTails.get(sessionId) === queued) {
        this.sessionMutationTails.delete(sessionId);
      }
    }
  }

  private utcDay() {
    return this.clock.now().toISOString().slice(0, 10);
  }

  private nextUtcDay() {
    return this.now().utc().add(1, 'day').startOf('day');
  }

  private now() {
    return dayjs(this.clock.now());
  }

  private clockInterval(delayMs: number) {
    return new Observable<void>((subscriber) => {
      const timer = this.clock.setInterval(() => subscriber.next(), delayMs);
      return () => this.clock.clearInterval(timer);
    });
  }

  private requiresDurableAuthority() {
    return process.env.NODE_ENV !== 'test';
  }

  private publishProjection(
    session: StoredGameSessionEntity,
  ): Result<MafiaGameProjection, GameSessionError> {
    session.nextEventId += 1;
    return session.gameSession
      .projectionFor(session.humanParticipantId, session.nextEventId)
      .map((projection) => {
        if (projection.public.phase === 'completed') session.status = 'completed';
        return projection;
      })
      .mapErr((cause): GameSessionError => ({
        type: 'invalid-mafia-projection',
        cause,
      }));
  }

  private async publishAgentProjection(session: StoredGameSessionEntity, hydrationLocked = false) {
    const projection = this.publishProjection(session);
    if (projection.isErr()) return projection;
    const saved = await this.saveAuthoritativeProjection(session, projection.value);
    if (saved.isOk() && saved.value) return projection;
    await this.hydrateAfterAgentSaveFailure(projection.value.sessionId, hydrationLocked);
    return err<MafiaGameProjection, GameSessionError>({
      type: 'durability-unavailable',
    });
  }

  private submitAndCommitAgentActions(
    session: StoredGameSessionEntity,
    hydrationLocked = false,
  ): Promise<Result<void, GameSessionError>> {
    const sessionId = session.gameSession.snapshot().sessionId;
    const existing = this.agentActionSubmissions.get(sessionId);
    if (existing) return existing;
    let submission: Promise<Result<void, GameSessionError>>;
    submission = this.submitCurrentAndPendingAgentActions(session, hydrationLocked).finally(() => {
      if (this.agentActionSubmissions.get(sessionId) === submission)
        this.agentActionSubmissions.delete(sessionId);
    });
    this.agentActionSubmissions.set(sessionId, submission);
    return submission;
  }

  private async submitCurrentAndPendingAgentActions(
    session: StoredGameSessionEntity,
    hydrationLocked: boolean,
  ): Promise<Result<void, GameSessionError>> {
    const result = await this.performAndCommitAgentActions(session, hydrationLocked);
    if (result.isErr()) return result;

    const current = this.sessions.get(session.gameSession.snapshot().sessionId);
    if (!current?.agentActionsPending) return result;
    return this.submitCurrentAndPendingAgentActions(current, hydrationLocked);
  }

  private async performAndCommitAgentActions(
    session: StoredGameSessionEntity,
    hydrationLocked: boolean,
  ): Promise<Result<void, GameSessionError>> {
    if (!session.agentActionsPending) {
      session.agentActionsPending = true;
      const prepared = await this.durability.saveSnapshot(session);
      if (prepared.isErr() || !prepared.value) {
        await this.hydrateAfterAgentSaveFailure(
          session.gameSession.snapshot().sessionId,
          hydrationLocked,
        );
        return err({ type: 'durability-unavailable' });
      }
    }
    const actionPhase = session.gameSession.snapshot().phase;
    const actionPhaseDeadline = session.gameSession.snapshot().phaseDeadline;
    const beforeGame = JSON.stringify(session.gameSession.snapshot());
    await this.agentActions.submitDayActions(session);
    const current = this.sessions.get(session.gameSession.snapshot().sessionId);
    if (!current)
      return err({
        type: 'session-not-found',
        sessionId: session.gameSession.snapshot().sessionId,
      });
    const phaseChanged =
      current.gameSession.snapshot().phase !== actionPhase ||
      current.gameSession.snapshot().phaseDeadline !== actionPhaseDeadline;
    current.agentActionsPending = phaseChanged;
    const saved =
      current !== session || phaseChanged
        ? await this.durability.saveSnapshot(current)
        : beforeGame !== JSON.stringify(current.gameSession.snapshot())
          ? await this.publishAgentProjection(current, hydrationLocked)
          : await this.durability.saveSnapshot(current);
    if (saved.isOk() && saved.value) {
      if (current.gameSession.snapshot().phase === 'discussion')
        this.queuePublicSpeechReplies(current);
      this.lifecycle.schedulePhaseTransition(current);
      return ok(undefined);
    }
    await this.hydrateAfterAgentSaveFailure(
      current.gameSession.snapshot().sessionId,
      hydrationLocked,
    );
    return err({ type: 'durability-unavailable' });
  }

  private disposeSession(session: StoredGameSessionEntity) {
    if (session.phaseTimer) this.clock.clearTimeout(session.phaseTimer);
    if (session.reconnectGraceTimer) this.clock.clearTimeout(session.reconnectGraceTimer);
    session.phaseTimer = undefined;
    session.reconnectGraceTimer = undefined;
    session.reconnectGraceDeadline = undefined;
    this.agentActions.clearTimers(session);

    const sessionId = session.gameSession.snapshot().sessionId;
    if (this.latestSessionIdsByHolder.get(session.holderId) === sessionId) {
      this.latestSessionIdsByHolder.delete(session.holderId);
    }
    this.agentActionRetries.clear(sessionId);
    this.phaseTransitionRetries.clear(sessionId);
    this.scheduledAgentRetries.clear(sessionId);
    this.mafiaChatReplyRetries.clear(sessionId);
  }

  private retryAgentActions(sessionId: string) {
    this.agentActionRetries.retry(sessionId, async () => {
      const hydrated = await this.hydrateAuthoritativeSession(sessionId, false, false);
      if (hydrated.isErr()) return true;
      const session = this.sessions.get(sessionId);
      if (!session) return false;
      if (session.agentActionsPending) {
        const actions = await this.submitAndCommitAgentActions(session);
        if (actions.isErr()) return true;
      }
      this.agentActions.resumeScheduledTasks(session);
      this.lifecycle.schedulePhaseTransition(session);
      return false;
    });
  }

  private async deliverMafiaChatReplies(
    session: StoredGameSessionEntity,
    hydrationLocked = false,
  ): Promise<void> {
    const published = await this.agentActions.publishMafiaChatReplies(session, hydrationLocked);
    if (!published || published.isOk()) return;
    this.retryMafiaChatReplies(session.gameSession.snapshot().sessionId);
  }

  private queueMafiaChatReplies(session: StoredGameSessionEntity) {
    const sessionId = session.gameSession.snapshot().sessionId;
    void Promise.resolve().then(() => this.prepareAndDeliverMafiaChatReplies(sessionId));
  }

  private queuePublicSpeechReplies(session: StoredGameSessionEntity) {
    const sessionId = session.gameSession.snapshot().sessionId;
    void Promise.resolve().then(() => this.preparePublicSpeechReplies(sessionId));
  }

  private async preparePublicSpeechReplies(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'in-progress') return;

    const prepared = await this.withSessionMutation(sessionId, async () => {
      const current = this.sessions.get(sessionId);
      if (!current || current.status !== 'in-progress')
        return err({ type: 'session-not-found', sessionId });
      await this.agentActions.publishPublicSpeechReplies(current, true);
      return this.durability.saveSnapshot(current);
    });
    if (prepared.isErr() || !prepared.value) {
      this.retryScheduledAgentTasks(sessionId);
      return;
    }

    const current = this.sessions.get(sessionId);
    if (current) this.agentActions.resumeScheduledTasks(current);
  }

  private async prepareAndDeliverMafiaChatReplies(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'in-progress') return;

    const replies = await this.agentActions.mafiaChatRepliesFor(session);
    if (replies.length === 0) return;

    const prepared = await this.withSessionMutation(sessionId, async () => {
      const current = this.sessions.get(sessionId);
      if (!current || current.status !== 'in-progress')
        return err({ type: 'session-not-found', sessionId });
      const currentPhaseKey = mafiaNightPhaseKey(current.gameSession.snapshot());
      for (const reply of replies) {
        if (reply.phaseKey === currentPhaseKey) current.scheduledAgentMafiaChatReplies.push(reply);
      }
      return this.durability.saveSnapshot(current);
    });
    if (prepared.isErr() || !prepared.value) {
      this.retryMafiaChatReplies(sessionId);
      return;
    }

    const current = this.sessions.get(sessionId);
    if (current) this.agentActions.resumeScheduledTasks(current);
  }

  private retryMafiaChatReplies(sessionId: string) {
    this.mafiaChatReplyRetries.retry(sessionId, async () => {
      const hydrated = await this.hydrateAuthoritativeSession(sessionId);
      if (hydrated.isErr()) return true;
      const session = this.sessions.get(sessionId);
      if (!session || session.scheduledAgentMafiaChatReplies.length === 0) return false;
      await this.deliverMafiaChatReplies(session);
      return false;
    });
  }

  private retryPhaseTransition(sessionId: string) {
    this.phaseTransitionRetries.retry(sessionId, async () => {
      const hydrated = await this.hydrateAuthoritativeSession(sessionId);
      if (hydrated.isErr()) return true;
      const session = this.sessions.get(sessionId);
      if (!session || session.status !== 'in-progress') return false;
      this.lifecycle.schedulePhaseTransition(session);
      return false;
    });
  }

  private retryPhaseTransitionAfterClaimLease(sessionId: string) {
    this.phaseTransitionRetries.schedule(
      sessionId,
      gameSessionsConfig.phaseDeadlineClaimLeaseMs,
      async () => {
        const hydrated = await this.hydrateAuthoritativeSession(sessionId);
        if (hydrated.isErr()) {
          this.retryPhaseTransition(sessionId);
          return;
        }
        const session = this.sessions.get(sessionId);
        if (!session || session.status !== 'in-progress') return;
        this.lifecycle.schedulePhaseTransition(session);
      },
    );
  }

  private retryScheduledAgentTasks(sessionId: string) {
    this.scheduledAgentRetries.retry(sessionId, async () => {
      const hydrated = await this.hydrateAuthoritativeSession(sessionId);
      if (hydrated.isErr()) return true;
      const session = this.sessions.get(sessionId);
      if (!session || session.status !== 'in-progress') return false;
      this.agentActions.resumeScheduledTasks(session);
      this.lifecycle.schedulePhaseTransition(session);
      return false;
    });
  }

  private async commitAgentMutation(
    staleSession: StoredGameSessionEntity,
    mutate: (session: StoredGameSessionEntity) => boolean,
    attempt = 0,
    schedulePhaseTransition = true,
    hydrationLocked = false,
  ): Promise<Result<void, GameSessionError>> {
    const sessionId = staleSession.gameSession.snapshot().sessionId;
    if (!this.authority || hydrationLocked)
      return this.commitAgentMutationUnlocked(
        staleSession,
        mutate,
        attempt,
        schedulePhaseTransition,
        true,
      );
    return this.withSessionMutation(sessionId, () =>
      this.commitAgentMutationUnlocked(
        staleSession,
        mutate,
        attempt,
        schedulePhaseTransition,
        true,
      ),
    );
  }

  private async commitAgentMutationUnlocked(
    staleSession: StoredGameSessionEntity,
    mutate: (session: StoredGameSessionEntity) => boolean,
    attempt: number,
    schedulePhaseTransition: boolean,
    hydrationLocked: boolean,
  ): Promise<Result<void, GameSessionError>> {
    const sessionId = staleSession.gameSession.snapshot().sessionId;
    if (this.authority) {
      const hydrated = await this.hydrateAuthoritativeSession(sessionId, true);
      if (hydrated.isErr()) {
        this.retryScheduledAgentTasks(sessionId);
        return err(hydrated.error);
      }
    }
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'in-progress') return ok(undefined);
    if (!mutate(session)) {
      const saved = await this.durability.saveSnapshot(session);
      if (saved.isOk() && saved.value) {
        if (schedulePhaseTransition) this.lifecycle.schedulePhaseTransition(session);
        return ok(undefined);
      }
      if (attempt < 1)
        return this.commitAgentMutationUnlocked(
          staleSession,
          mutate,
          attempt + 1,
          schedulePhaseTransition,
          hydrationLocked,
        );
      this.retryScheduledAgentTasks(sessionId);
      return err({ type: 'durability-unavailable' });
    }
    const published = await this.publishAgentProjection(session, hydrationLocked);
    if (published.isOk()) {
      if (schedulePhaseTransition) this.lifecycle.schedulePhaseTransition(session);
      if (published.value.public.phase === 'discussion') this.queuePublicSpeechReplies(session);
      return ok(undefined);
    }
    if (attempt >= 1) {
      this.retryScheduledAgentTasks(sessionId);
      return err(published.error);
    }
    return this.commitAgentMutationUnlocked(
      staleSession,
      mutate,
      attempt + 1,
      schedulePhaseTransition,
      hydrationLocked,
    );
  }

  private async releaseReconnectLeaseWithRetry(
    authority: RedisGameSessionAuthority,
    sessionId: string,
    connectionId: string,
    holderId: string,
    reconnectGraceDeadline: string,
    attempt = 0,
  ): Promise<void> {
    const released = await authority.releaseReconnectLeaseAndBeginGrace(
      sessionId,
      connectionId,
      holderId,
      reconnectGraceDeadline,
    );
    if (!released.isErr() || attempt >= 2) return;
    await new Promise<void>((resolve) => this.clock.setTimeout(resolve, 100 * (attempt + 1)));
    await this.releaseReconnectLeaseWithRetry(
      authority,
      sessionId,
      connectionId,
      holderId,
      reconnectGraceDeadline,
      attempt + 1,
    );
  }

  private sessionForHolder(
    sessionId: string,
    holderId: string | undefined,
  ): Result<StoredGameSessionEntity, GameSessionError> {
    const session = this.sessions.get(sessionId);
    if (!session || !holderId || session.holderId !== holderId) {
      return err({ type: 'unavailable-to-guest', sessionId });
    }

    if (session.status === 'in-progress') this.touch(session);
    return ok(session);
  }

  private activeSessionForHolder(
    sessionId: string,
    holderId: string | undefined,
  ): Result<StoredGameSessionEntity, GameSessionError> {
    return this.sessionForHolder(sessionId, holderId).andThen((session) => {
      if (session.status !== 'in-progress')
        return err<StoredGameSessionEntity, GameSessionError>({
          type: 'unavailable-to-guest',
          sessionId,
        });
      this.touch(session);
      if (this.authority) return ok(session);
      return this.lifecycle.recoverExpiredPhase(session).map(() => session);
    });
  }

  private projectionFor(
    session: StoredGameSessionEntity,
  ): Result<MafiaGameProjection, GameSessionError> {
    return session.gameSession
      .projectionFor(session.humanParticipantId, session.nextEventId)
      .mapErr((cause): GameSessionError => ({
        type: 'invalid-mafia-projection',
        cause,
      }));
  }

  private touch(session: StoredGameSessionEntity) {
    session.lastAccessedAt = this.now();
  }

  private addEventSubscriber(sessionId: string) {
    this.eventSubscriberCounts.set(sessionId, (this.eventSubscriberCounts.get(sessionId) ?? 0) + 1);
  }

  private removeEventSubscriber(sessionId: string) {
    const nextCount = (this.eventSubscriberCounts.get(sessionId) ?? 0) - 1;
    if (nextCount > 0) {
      this.eventSubscriberCounts.set(sessionId, nextCount);
      return;
    }
    this.eventSubscriberCounts.delete(sessionId);
  }

  private hasEventSubscribers(sessionId: string) {
    return (this.eventSubscriberCounts.get(sessionId) ?? 0) > 0;
  }

  private async touchAuthoritativeSession(
    session: StoredGameSessionEntity,
  ): Promise<Result<void, GameSessionError>> {
    return this.durability.touch(session);
  }

  private saveAuthoritativeProjection(
    session: StoredGameSessionEntity,
    projection: MafiaGameProjection,
  ) {
    return this.durability.save(session, projection);
  }

  private durableSnapshot(
    session: StoredGameSessionEntity,
    projection: MafiaGameProjection,
  ): DurableSessionSnapshot {
    return this.durability.snapshotFor(session, projection);
  }

  private async hydrateAuthoritativeSession(
    sessionId: string,
    mutationLocked = false,
    processPendingAgentActions = true,
  ): Promise<Result<void, GameSessionError>> {
    if (mutationLocked)
      return this.hydrateAuthoritativeSessionUnlocked(sessionId, processPendingAgentActions);
    return this.withSessionMutation(sessionId, () =>
      this.hydrateAuthoritativeSessionUnlocked(sessionId, processPendingAgentActions),
    );
  }

  private async hydrateAuthoritativeSessionUnlocked(
    sessionId: string,
    processPendingAgentActions = true,
  ): Promise<Result<void, GameSessionError>> {
    const hydrated = await this.durability.hydrate(sessionId);
    if (hydrated.isErr()) return hydrated;
    const session = this.sessions.get(sessionId);
    if (session) {
      if (
        processPendingAgentActions &&
        session.status === 'in-progress' &&
        session.agentActionsPending
      ) {
        // Hydration runs on the human read and action paths. Queue slow Agent decisions so a
        // gateway response never delays the current Human Player request.
        this.queuePendingAgentActions(session);
      }
      if (session.status === 'in-progress' && !session.agentActionsPending) {
        if (session.scheduledAgentMafiaChatReplies.length > 0)
          this.retryMafiaChatReplies(sessionId);
        this.agentActions.resumeScheduledTasks(session);
        this.lifecycle.schedulePhaseTransition(session);
      }
    }
    return hydrated;
  }

  private hydrateAfterAgentSaveFailure(sessionId: string, hydrationLocked: boolean) {
    return hydrationLocked
      ? this.hydrateAuthoritativeSessionUnlocked(sessionId, false)
      : this.hydrateAuthoritativeSession(sessionId, false, false);
  }
}
