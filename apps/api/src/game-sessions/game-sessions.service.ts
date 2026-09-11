import { randomUUID } from 'node:crypto';

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { MafiaGameModule, mafiaGameConfig } from '@repo/mafia';
import dayjs from 'dayjs';
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

import { agentDecisionGateway, type AgentDecisionGateway } from './agent-decision.gateway';
import { cooldownRetryAfterMs } from './cooldown/cooldown';
import {
  type DurableSessionSnapshot,
  RedisGameSessionAuthority,
} from './durability/redis-game-session-authority';
import type { MafiaGameSessionProjectionEntity } from './entities/mafia-game-session-projection.entity';
import type { StoredGameSessionEntity } from './entities/stored-game-session.entity';
import { GameSessionAgentOrchestrator } from './game-session-agent-orchestrator';
import {
  gameSessionClock,
  nativeGameSessionClock,
  type GameSessionClock,
} from './game-session-clock';
import { GameSessionDurability } from './game-session-durability';
import type { GameSessionError } from './game-session-error';
import { GameSessionLifecycle } from './game-session-lifecycle';
import { gameSessionsConfig } from './game-sessions.config';
import { createGuestCookieSigner, guestCookieSecret } from './guest-cookie';
import {
  type IdempotencyRecord,
  lookupIdempotency,
  recordIdempotency,
} from './idempotency/idempotency-ledger';

export type { GameSessionError } from './game-session-error';

type CreatedMafiaSession = {
  holderId: string;
  projection: MafiaGameSessionProjectionEntity;
};

type IdempotentProjectionAction = {
  idempotencyKey: string;
  fingerprint: string;
  conflict: GameSessionError;
  records: (
    session: StoredGameSessionEntity,
  ) => Map<string, IdempotencyRecord<MafiaGameSessionProjectionEntity>>;
  submit: (
    session: StoredGameSessionEntity,
  ) => Result<MafiaGameSessionProjectionEntity, GameSessionError>;
  beforeSave?: (session: StoredGameSessionEntity) => void | Promise<void>;
  afterCommit?: (session: StoredGameSessionEntity) => void | Promise<void>;
};

@Injectable()
export class GameSessionsService implements OnModuleInit, OnModuleDestroy {
  private readonly mafiaModule: MafiaGameModule;
  private readonly sessions = new Map<string, StoredGameSessionEntity>();
  private readonly guestSessionCounts = new Map<string, number>();
  private readonly activeSessionIdsByHolder = new Map<string, string>();
  private readonly idempotencyKeys = new Map<string, IdempotencyRecord<string>>();
  private readonly sessionMutationTails = new Map<string, Promise<void>>();
  private readonly agentActionRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly phaseTransitionRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly scheduledAgentRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly mafiaChatReplyRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly guestCookies = createGuestCookieSigner(
    gameSessionsConfig.guestCookieName,
    guestCookieSecret(),
  );
  private readonly agentActions: GameSessionAgentOrchestrator;
  private readonly durability: GameSessionDurability;
  private readonly lifecycle: GameSessionLifecycle;
  private readonly authority = RedisGameSessionAuthority.fromEnvironment();
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(agentDecisionGateway) agentDecisions: AgentDecisionGateway,
    @Inject(gameSessionClock) private readonly clock: GameSessionClock = nativeGameSessionClock,
  ) {
    this.mafiaModule = new MafiaGameModule(undefined, undefined, () => this.clock.now());
    this.agentActions = new GameSessionAgentOrchestrator(
      agentDecisions,
      this.publishAgentProjection.bind(this),
      (session, mutate, schedulePhaseTransition, hydrationLocked) =>
        this.commitAgentMutation(session, mutate, 0, schedulePhaseTransition, hydrationLocked),
      this.clock,
    );
    this.durability = new GameSessionDurability(
      () => this.authority,
      this.clock,
      this.sessions,
      (session) => {
        if (session.phaseTimer) this.clock.clearTimeout(session.phaseTimer);
        if (session.reconnectGraceTimer) this.clock.clearTimeout(session.reconnectGraceTimer);
        this.agentActions.clearTimers(session);
      },
    );
    this.lifecycle = new GameSessionLifecycle({
      state: {
        sessions: this.sessions,
        guestSessionCounts: this.guestSessionCounts,
        idempotencyKeys: this.idempotencyKeys,
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
    for (const timer of this.agentActionRetryTimers.values()) this.clock.clearTimeout(timer);
    this.agentActionRetryTimers.clear();
    for (const timer of this.phaseTransitionRetryTimers.values()) this.clock.clearTimeout(timer);
    this.phaseTransitionRetryTimers.clear();
    for (const timer of this.scheduledAgentRetryTimers.values()) this.clock.clearTimeout(timer);
    this.scheduledAgentRetryTimers.clear();
    for (const timer of this.mafiaChatReplyRetryTimers.values()) this.clock.clearTimeout(timer);
    this.mafiaChatReplyRetryTimers.clear();
    void this.authority?.close();
  }

  async createMafiaSession(
    cookie: string | undefined,
    participantCount: number = mafiaGameConfig.defaultParticipantCount,
    idempotencyKey: string | undefined,
  ): Promise<Result<CreatedMafiaSession, GameSessionError>> {
    if (!this.authority && this.requiresDurableAuthority()) {
      return err({ type: 'durability-unavailable' });
    }
    void this.lifecycle.cleanupExpiredSessions();
    const holderId = this.guestCookies.read(cookie) ?? randomUUID();
    const activeSessionId = this.activeSessionIdsByHolder.get(holderId);
    if (!this.authority && activeSessionId) {
      const activeSession = this.sessions.get(activeSessionId);
      if (activeSession?.status === 'in-progress') {
        return this.projectionFor(activeSession).map((projection) => ({ holderId, projection }));
      }
      this.activeSessionIdsByHolder.delete(holderId);
    }
    const scopedIdempotencyKey = idempotencyKey && `${holderId}:${idempotencyKey}`;
    if (!this.authority && scopedIdempotencyKey) {
      const lookup = lookupIdempotency(
        this.idempotencyKeys,
        scopedIdempotencyKey,
        String(participantCount),
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
            holderId,
            projection,
          }));
        })
        .with({ type: 'new-request' }, () => undefined)
        .exhaustive();
      if (idempotencyResult) return idempotencyResult;
    }

    const countKey = `${this.utcDay()}:${holderId}`;
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
    });
    if (gameSessionResult.isErr()) {
      return err({ type: 'invalid-mafia-session-input', cause: gameSessionResult.error });
    }

    const gameSession = gameSessionResult.value;
    const session: StoredGameSessionEntity = {
      holderId,
      humanParticipantId: 'participant-1',
      gameSession,
      events: new ReplaySubject<MafiaGameSessionProjectionEntity>(
        gameSessionsConfig.eventReplayBufferSize,
      ),
      nextEventId: 0,
      nextPublicSpeechAt: undefined,
      nextFinalDefenceAt: undefined,
      nextDiscussionTimeAdjustmentAt: undefined,
      lastAccessedAt: this.now(),
      activeEventSubscribers: 0,
      status: 'in-progress',
      publicSpeechIdempotencyKeys: new Map(),
      mafiaChatIdempotencyKeys: new Map(),
      dayActionIdempotencyKeys: new Map(),
      discussionTimeAdjustmentIdempotencyKeys: new Map(),
      phaseTimer: undefined,
      agentFinalDefenceTimer: undefined,
      publicSpeechAgentTimers: new Map(),
      mafiaTargetFallbackTimer: undefined,
      scheduledAgentPublicSpeeches: [],
      scheduledAgentFinalDefence: undefined,
      scheduledAgentMafiaChatReplies: [],
      scheduledMafiaTargetFallbackAt: undefined,
      agentActionsPending: true,
      reconnectGraceTimer: undefined,
      reconnectGraceDeadline: undefined,
    };
    if (!this.authority && scopedIdempotencyKey) {
      recordIdempotency(
        this.idempotencyKeys,
        scopedIdempotencyKey,
        String(participantCount),
        sessionId,
      );
    }
    const projection = this.publishProjection(session);
    if (projection.isErr()) return err(projection.error);
    if (this.authority) {
      const creation = await this.authority.create(
        this.durableSnapshot(session, projection.value),
        { eventId: projection.value.eventId, projection: projection.value },
        holderId,
        this.utcDay(),
        gameSessionsConfig.guestAllowance,
        idempotencyKey ? { key: idempotencyKey, fingerprint: String(participantCount) } : undefined,
      );
      if (creation.isErr()) return err({ type: 'durability-unavailable' });
      if (creation.value.type === 'allowance-exhausted') {
        return err({ type: 'guest-allowance-exhausted' });
      }
      if (creation.value.type === 'conflict') return err({ type: 'idempotency-conflict' });
      if (creation.value.type === 'replayed') {
        const hydrated = await this.hydrateAuthoritativeSession(creation.value.record.sessionId);
        if (hydrated.isErr()) return err(hydrated.error);
        const existingSession = this.sessions.get(creation.value.record.sessionId);
        if (!existingSession) {
          return err({ type: 'session-not-found', sessionId: creation.value.record.sessionId });
        }
        return this.projectionFor(existingSession).map((existingProjection) => ({
          holderId,
          projection: existingProjection,
        }));
      }
      if (creation.value.type === 'active-session') {
        const hydrated = await this.hydrateAuthoritativeSession(creation.value.sessionId);
        if (hydrated.isErr()) return err(hydrated.error);
        const activeSession = this.sessions.get(creation.value.sessionId);
        if (!activeSession) {
          return err({ type: 'session-not-found', sessionId: creation.value.sessionId });
        }
        return this.projectionFor(activeSession).map((existingProjection) => ({
          holderId,
          projection: existingProjection,
        }));
      }
    }
    this.sessions.set(sessionId, session);
    this.activeSessionIdsByHolder.set(holderId, sessionId);
    const actions = await this.submitAndCommitAgentActions(session);
    if (actions.isErr()) {
      this.retryAgentActions(sessionId);
      return ok({ holderId, projection: projection.value });
    }
    this.lifecycle.schedulePhaseTransition(session);
    return ok({ holderId, projection: projection.value });
  }

  getProjection(
    sessionId: string,
    cookie: string | undefined,
    mutationLocked = false,
  ):
    | Result<MafiaGameSessionProjectionEntity, GameSessionError>
    | Promise<Result<MafiaGameSessionProjectionEntity, GameSessionError>> {
    if (!this.authority) {
      return this.requiresDurableAuthority()
        ? err({ type: 'durability-unavailable' })
        : this.getProjectionFromMemory(sessionId, cookie);
    }
    return this.hydrateAuthoritativeSession(sessionId, mutationLocked).then(
      async (hydrated): Promise<Result<MafiaGameSessionProjectionEntity, GameSessionError>> => {
        if (hydrated.isErr())
          return err<MafiaGameSessionProjectionEntity, GameSessionError>(hydrated.error);
        const session = this.sessions.get(sessionId);
        if (!session)
          return err<MafiaGameSessionProjectionEntity, GameSessionError>({
            type: 'session-not-found',
            sessionId,
          });
        const readableSession = this.sessionForHolder(sessionId, cookie);
        if (readableSession.isErr()) return err(readableSession.error);
        if (readableSession.value.status === 'completed')
          return this.projectionFor(readableSession.value);
        const activeSession = this.activeSessionForHolder(sessionId, cookie);
        if (activeSession.isErr()) return err(activeSession.error);
        const currentProjection = this.projectionFor(session);
        if (currentProjection.isErr()) return currentProjection;
        if (dayjs(currentProjection.value.public.phaseDeadline).isBefore(this.now())) {
          const claimed = await this.authority!.claimPhaseDeadline(
            sessionId,
            currentProjection.value.public.phaseDeadline,
          );
          if (claimed.isErr()) return err({ type: 'durability-unavailable' });
          if (!claimed.value) {
            const refreshed = await this.hydrateAuthoritativeSession(sessionId, mutationLocked);
            if (refreshed.isErr()) return err(refreshed.error);
            const refreshedSession = this.sessions.get(sessionId);
            if (!refreshedSession) return err({ type: 'session-not-found', sessionId });
            return this.projectionFor(refreshedSession);
          }
        }
        const recovery = await this.lifecycle.recoverExpiredPhaseDurably(session);
        if (recovery.isErr()) return err(recovery.error);
        const recoveredSession = this.sessions.get(sessionId);
        if (!recoveredSession) return err({ type: 'session-not-found', sessionId });
        const recoveredActiveSession = this.activeSessionForHolder(sessionId, cookie);
        if (recoveredActiveSession.isErr()) return err(recoveredActiveSession.error);
        const touched = await this.touchAuthoritativeSession(recoveredActiveSession.value);
        if (touched.isErr()) return err(touched.error);
        return this.projectionFor(recoveredSession);
      },
    );
  }

  private getProjectionFromMemory(
    sessionId: string,
    cookie: string | undefined,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
    void this.lifecycle.cleanupExpiredSessions();
    return this.sessionForHolder(sessionId, cookie).andThen((session) => {
      if (session.status === 'completed') return this.projectionFor(session);
      return this.activeSessionForHolder(sessionId, cookie).andThen((activeSession) =>
        this.projectionFor(activeSession),
      );
    });
  }

  eventsFor(
    sessionId: string,
    cookie: string | undefined,
    lastEventId: number | undefined,
  ):
    | Result<Observable<MafiaGameSessionProjectionEntity>, GameSessionError>
    | Promise<Result<Observable<MafiaGameSessionProjectionEntity>, GameSessionError>> {
    const authority = this.authority;
    if (!authority) {
      return this.requiresDurableAuthority()
        ? err({ type: 'durability-unavailable' })
        : this.eventsForFromMemory(sessionId, cookie, lastEventId);
    }
    return this.hydrateAuthoritativeSession(sessionId).then(async (hydrated) => {
      if (hydrated.isErr())
        return err<Observable<MafiaGameSessionProjectionEntity>, GameSessionError>(hydrated.error);
      const readableSession = this.sessionForHolder(sessionId, cookie);
      if (readableSession.isErr())
        return err<Observable<MafiaGameSessionProjectionEntity>, GameSessionError>(
          readableSession.error,
        );
      if (readableSession.value.status === 'completed')
        return this.projectionFor(readableSession.value).map((snapshot) => of(snapshot));
      const session = this.activeSessionForHolder(sessionId, cookie);
      if (session.isErr())
        return err<Observable<MafiaGameSessionProjectionEntity>, GameSessionError>(session.error);
      const touched = await this.touchAuthoritativeSession(session.value);
      if (touched.isErr())
        return err<Observable<MafiaGameSessionProjectionEntity>, GameSessionError>(touched.error);
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
        return err<Observable<MafiaGameSessionProjectionEntity>, GameSessionError>(snapshot.error);
      return ok<Observable<MafiaGameSessionProjectionEntity>, GameSessionError>(
        defer(() => {
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
              void this.releaseReconnectLeaseWithRetry(
                authority,
                sessionId,
                connectionId,
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
    cookie: string | undefined,
    lastEventId: number | undefined,
  ): Result<Observable<MafiaGameSessionProjectionEntity>, GameSessionError> {
    void this.lifecycle.cleanupExpiredSessions();
    const readableSession = this.sessionForHolder(sessionId, cookie);
    if (readableSession.isErr()) return err(readableSession.error);
    if (readableSession.value.status === 'completed')
      return this.projectionFor(readableSession.value).map((snapshot) => of(snapshot));
    return this.activeSessionForHolder(sessionId, cookie).map((session) =>
      defer(() => {
        session.activeEventSubscribers += 1;
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
            session.activeEventSubscribers -= 1;
            void this.authority?.releaseReconnectLease(sessionId, connectionId);
            this.touch(session);
            if (session.activeEventSubscribers === 0)
              this.lifecycle.scheduleReconnectGrace(session);
          }),
        );
      }),
    );
  }

  publishSessionProjection(
    sessionId: string,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return err({ type: 'session-not-found', sessionId });
    }

    return this.publishProjection(session);
  }

  async submitPublicSpeech(
    sessionId: string,
    cookie: string | undefined,
    content: string,
    idempotencyKey: string,
  ): Promise<Result<MafiaGameSessionProjectionEntity, GameSessionError>> {
    return this.runIdempotentProjectionAction(sessionId, cookie, {
      idempotencyKey,
      fingerprint: content,
      conflict: { type: 'public-speech-idempotency-conflict' },
      records: (session) => session.publicSpeechIdempotencyKeys,
      submit: (session) => {
        const now = this.now();
        const retryAfterMs = cooldownRetryAfterMs(session.nextPublicSpeechAt, now);
        if (retryAfterMs) {
          return err<MafiaGameSessionProjectionEntity, GameSessionError>({
            type: 'public-speech-rate-limited',
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
          return err<MafiaGameSessionProjectionEntity, GameSessionError>(error);
        }

        return this.publishProjection(session).andTee(() => {
          session.nextPublicSpeechAt = now.add(
            gameSessionsConfig.humanActionCooldownMs,
            'millisecond',
          );
        });
      },
      beforeSave: (session) => this.agentActions.publishPublicSpeechReplies(session),
    });
  }

  async submitMafiaChat(
    sessionId: string,
    cookie: string | undefined,
    content: string,
    idempotencyKey: string,
  ): Promise<Result<MafiaGameSessionProjectionEntity, GameSessionError>> {
    return this.runIdempotentProjectionAction(sessionId, cookie, {
      idempotencyKey,
      fingerprint: content,
      conflict: { type: 'mafia-chat-idempotency-conflict' },
      records: (session) => session.mafiaChatIdempotencyKeys,
      submit: (session) => {
        const now = this.now();
        const retryAfterMs = cooldownRetryAfterMs(session.nextPublicSpeechAt, now);
        if (retryAfterMs) return err({ type: 'public-speech-rate-limited', retryAfterMs });
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
      beforeSave: (session) => this.agentActions.prepareMafiaChatReplies(session),
      afterCommit: (session) => this.deliverMafiaChatReplies(session, true),
    });
  }

  async submitNomination(
    sessionId: string,
    cookie: string | undefined,
    targetParticipantId: string,
    idempotencyKey: string,
  ): Promise<Result<MafiaGameSessionProjectionEntity, GameSessionError>> {
    return this.submitDayAction(
      sessionId,
      cookie,
      `nomination:${targetParticipantId}`,
      idempotencyKey,
      (session) =>
        session.gameSession.submitNomination(session.humanParticipantId, targetParticipantId),
    );
  }

  async submitVerdict(
    sessionId: string,
    cookie: string | undefined,
    vote: 'eliminate' | 'spare',
    idempotencyKey: string,
  ): Promise<Result<MafiaGameSessionProjectionEntity, GameSessionError>> {
    return this.submitDayAction(sessionId, cookie, `verdict:${vote}`, idempotencyKey, (session) =>
      session.gameSession.submitVerdict(session.humanParticipantId, vote),
    );
  }

  async submitMafiaTarget(
    sessionId: string,
    cookie: string | undefined,
    targetParticipantId: string,
    idempotencyKey: string,
  ) {
    return this.submitDayAction(
      sessionId,
      cookie,
      `mafia-target:${targetParticipantId}`,
      idempotencyKey,
      (session) =>
        session.gameSession.submitMafiaTarget(session.humanParticipantId, targetParticipantId),
    );
  }

  async submitDoctorProtection(
    sessionId: string,
    cookie: string | undefined,
    targetParticipantId: string,
    idempotencyKey: string,
  ) {
    return this.submitDayAction(
      sessionId,
      cookie,
      `doctor-protection:${targetParticipantId}`,
      idempotencyKey,
      (session) =>
        session.gameSession.submitDoctorProtection(session.humanParticipantId, targetParticipantId),
    );
  }

  async submitDetectiveInvestigation(
    sessionId: string,
    cookie: string | undefined,
    targetParticipantId: string,
    idempotencyKey: string,
  ) {
    return this.submitDayAction(
      sessionId,
      cookie,
      `detective-investigation:${targetParticipantId}`,
      idempotencyKey,
      (session) =>
        session.gameSession.submitDetectiveInvestigation(
          session.humanParticipantId,
          targetParticipantId,
        ),
    );
  }

  async adjustDiscussionTime(
    sessionId: string,
    cookie: string | undefined,
    adjustmentSeconds: 10 | -10,
    expectedDeadline: string,
    idempotencyKey: string,
  ): Promise<Result<MafiaGameSessionProjectionEntity, GameSessionError>> {
    const fingerprint = `${adjustmentSeconds}:${expectedDeadline}`;
    return this.runIdempotentProjectionAction(sessionId, cookie, {
      idempotencyKey,
      fingerprint,
      conflict: { type: 'discussion-time-adjustment-idempotency-conflict' },
      records: (session) => session.discussionTimeAdjustmentIdempotencyKeys,
      submit: (session) => {
        const currentProjection = session.gameSession.projectionFor(
          session.humanParticipantId,
          session.nextEventId,
        );
        if (currentProjection.isErr()) {
          return err<MafiaGameSessionProjectionEntity, GameSessionError>({
            type: 'invalid-mafia-projection',
            cause: currentProjection.error,
          });
        }
        if (currentProjection.value.public.phase !== 'discussion') {
          return err<MafiaGameSessionProjectionEntity, GameSessionError>({
            type: 'invalid-discussion-time-adjustment',
          });
        }
        if (currentProjection.value.public.phaseDeadline !== expectedDeadline) {
          return err<MafiaGameSessionProjectionEntity, GameSessionError>({
            type: 'stale-discussion-time-adjustment',
          });
        }

        const now = this.now();
        const retryAfterMs = cooldownRetryAfterMs(session.nextDiscussionTimeAdjustmentAt, now);
        if (retryAfterMs) {
          return err<MafiaGameSessionProjectionEntity, GameSessionError>({
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
          return err<MafiaGameSessionProjectionEntity, GameSessionError>(
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
            if (result.type !== 'not-due') this.agentActions.submitDayActions(session);
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
    });
  }

  async submitFinalDefence(
    sessionId: string,
    cookie: string | undefined,
    content: string,
    idempotencyKey: string,
  ): Promise<Result<MafiaGameSessionProjectionEntity, GameSessionError>> {
    const fingerprint = `final-defence:${content}`;
    return this.runIdempotentProjectionAction(sessionId, cookie, {
      idempotencyKey,
      fingerprint,
      conflict: { type: 'day-action-idempotency-conflict' },
      records: (session) => session.dayActionIdempotencyKeys,
      submit: (session) => {
        const now = this.now();
        const retryAfterMs = cooldownRetryAfterMs(session.nextFinalDefenceAt, now);
        if (retryAfterMs) {
          return err<MafiaGameSessionProjectionEntity, GameSessionError>({
            type: 'day-action-rate-limited',
            retryAfterMs,
          });
        }

        const action = session.gameSession.submitFinalDefence(session.humanParticipantId, content);
        if (action.isErr()) {
          return err<MafiaGameSessionProjectionEntity, GameSessionError>({
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
    cookie: string | undefined,
    fingerprint: string,
    idempotencyKey: string,
    submit: (
      session: StoredGameSessionEntity,
    ) => ReturnType<StoredGameSessionEntity['gameSession']['submitNomination']>,
  ): Promise<Result<MafiaGameSessionProjectionEntity, GameSessionError>> {
    return this.runIdempotentProjectionAction(sessionId, cookie, {
      idempotencyKey,
      fingerprint,
      conflict: { type: 'day-action-idempotency-conflict' },
      records: (session) => session.dayActionIdempotencyKeys,
      submit: (session) => {
        const action = submit(session);
        if (action.isErr()) {
          return err<MafiaGameSessionProjectionEntity, GameSessionError>({
            type: 'invalid-day-action',
          });
        }
        return this.publishProjection(session);
      },
    });
  }

  private async runIdempotentProjectionAction(
    sessionId: string,
    cookie: string | undefined,
    action: IdempotentProjectionAction,
  ): Promise<Result<MafiaGameSessionProjectionEntity, GameSessionError>> {
    return this.withSessionMutation(sessionId, () =>
      this.runIdempotentProjectionActionUnlocked(sessionId, cookie, action),
    );
  }

  private async runIdempotentProjectionActionUnlocked(
    sessionId: string,
    cookie: string | undefined,
    {
      idempotencyKey,
      fingerprint,
      conflict,
      records,
      submit,
      beforeSave,
      afterCommit,
    }: IdempotentProjectionAction,
    attempt = 0,
  ): Promise<Result<MafiaGameSessionProjectionEntity, GameSessionError>> {
    if (this.authority) {
      const recovered = await this.getProjection(sessionId, cookie, true);
      if (recovered.isErr())
        return err<MafiaGameSessionProjectionEntity, GameSessionError>(recovered.error);
    }
    let committedAction = false;
    const result = this.activeSessionForHolder(sessionId, cookie).andThen((session) => {
      const ledger = records(session);
      const idempotencyResult = match(lookupIdempotency(ledger, idempotencyKey, fingerprint))
        .with({ type: 'replayed' }, ({ result: replayedProjection }) =>
          ok<MafiaGameSessionProjectionEntity, GameSessionError>(replayedProjection),
        )
        .with({ type: 'conflict' }, () =>
          err<MafiaGameSessionProjectionEntity, GameSessionError>(conflict),
        )
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
      if (committedAction) await afterCommit?.(this.sessions.get(sessionId)!);
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
        cookie,
        { idempotencyKey, fingerprint, conflict, records, submit, beforeSave, afterCommit },
        attempt + 1,
      );
    }
    if (!saved.value) await this.hydrateAuthoritativeSessionUnlocked(sessionId);
    if (saved.value && committedAction) await afterCommit?.(session);
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

  guestCookieName() {
    return gameSessionsConfig.guestCookieName;
  }

  signGuestId(holderId: string) {
    return this.guestCookies.sign(holderId);
  }

  private utcDay() {
    return this.clock.now().toISOString().slice(0, 10);
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
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
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
    return err<MafiaGameSessionProjectionEntity, GameSessionError>({
      type: 'durability-unavailable',
    });
  }

  private async submitAndCommitAgentActions(
    session: StoredGameSessionEntity,
    hydrationLocked = false,
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
    const beforeGame = JSON.stringify(session.gameSession.snapshot());
    this.agentActions.submitDayActions(session);
    session.agentActionsPending = false;
    const saved =
      beforeGame !== JSON.stringify(session.gameSession.snapshot())
        ? await this.publishAgentProjection(session, hydrationLocked)
        : await this.durability.saveSnapshot(session);
    if (saved.isOk() && saved.value) return ok(undefined);
    await this.hydrateAfterAgentSaveFailure(
      session.gameSession.snapshot().sessionId,
      hydrationLocked,
    );
    return err({ type: 'durability-unavailable' });
  }

  private retryAgentActions(sessionId: string, attempt = 0) {
    if (this.agentActionRetryTimers.has(sessionId)) return;
    const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
    const timer = this.clock.setTimeout(() => {
      this.agentActionRetryTimers.delete(sessionId);
      void (async () => {
        const hydrated = await this.hydrateAuthoritativeSession(sessionId);
        if (hydrated.isErr()) {
          this.retryAgentActions(sessionId, attempt + 1);
          return;
        }
        const session = this.sessions.get(sessionId);
        if (!session) return;
        if (session.agentActionsPending) {
          this.retryAgentActions(sessionId, attempt + 1);
          return;
        }
        this.agentActions.resumeScheduledTasks(session);
        this.lifecycle.schedulePhaseTransition(session);
      })();
    }, delayMs);
    this.agentActionRetryTimers.set(sessionId, timer);
    timer.unref?.();
  }

  private async deliverMafiaChatReplies(
    session: StoredGameSessionEntity,
    hydrationLocked = false,
  ): Promise<void> {
    const published = await this.agentActions.publishMafiaChatReplies(session, hydrationLocked);
    if (!published || published.isOk()) return;
    this.retryMafiaChatReplies(session.gameSession.snapshot().sessionId);
  }

  private retryMafiaChatReplies(sessionId: string, attempt = 0) {
    if (this.mafiaChatReplyRetryTimers.has(sessionId)) return;
    const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
    const timer = this.clock.setTimeout(() => {
      this.mafiaChatReplyRetryTimers.delete(sessionId);
      void (async () => {
        const hydrated = await this.hydrateAuthoritativeSession(sessionId);
        if (hydrated.isErr()) {
          this.retryMafiaChatReplies(sessionId, attempt + 1);
          return;
        }
        const session = this.sessions.get(sessionId);
        if (!session || session.scheduledAgentMafiaChatReplies.length === 0) return;
        await this.deliverMafiaChatReplies(session);
      })();
    }, delayMs);
    this.mafiaChatReplyRetryTimers.set(sessionId, timer);
    timer.unref?.();
  }

  private retryPhaseTransition(sessionId: string, attempt = 0) {
    if (this.phaseTransitionRetryTimers.has(sessionId)) return;
    const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
    const timer = this.clock.setTimeout(() => {
      this.phaseTransitionRetryTimers.delete(sessionId);
      void (async () => {
        const hydrated = await this.hydrateAuthoritativeSession(sessionId);
        if (hydrated.isErr()) {
          this.retryPhaseTransition(sessionId, attempt + 1);
          return;
        }
        const session = this.sessions.get(sessionId);
        if (!session || session.status !== 'in-progress') return;
        this.lifecycle.schedulePhaseTransition(session);
      })();
    }, delayMs);
    this.phaseTransitionRetryTimers.set(sessionId, timer);
    timer.unref?.();
  }

  private retryPhaseTransitionAfterClaimLease(sessionId: string) {
    if (this.phaseTransitionRetryTimers.has(sessionId)) return;
    const timer = this.clock.setTimeout(() => {
      this.phaseTransitionRetryTimers.delete(sessionId);
      void (async () => {
        const hydrated = await this.hydrateAuthoritativeSession(sessionId);
        if (hydrated.isErr()) {
          this.retryPhaseTransition(sessionId);
          return;
        }
        const session = this.sessions.get(sessionId);
        if (!session || session.status !== 'in-progress') return;
        this.lifecycle.schedulePhaseTransition(session);
      })();
    }, gameSessionsConfig.phaseDeadlineClaimLeaseMs);
    this.phaseTransitionRetryTimers.set(sessionId, timer);
    timer.unref?.();
  }

  private retryScheduledAgentTasks(sessionId: string, attempt = 0) {
    if (this.scheduledAgentRetryTimers.has(sessionId)) return;
    const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
    const timer = this.clock.setTimeout(() => {
      this.scheduledAgentRetryTimers.delete(sessionId);
      void (async () => {
        const hydrated = await this.hydrateAuthoritativeSession(sessionId);
        if (hydrated.isErr()) {
          this.retryScheduledAgentTasks(sessionId, attempt + 1);
          return;
        }
        const session = this.sessions.get(sessionId);
        if (!session || session.status !== 'in-progress') return;
        this.agentActions.resumeScheduledTasks(session);
        this.lifecycle.schedulePhaseTransition(session);
      })();
    }, delayMs);
    this.scheduledAgentRetryTimers.set(sessionId, timer);
    timer.unref?.();
  }

  private async commitAgentMutation(
    staleSession: StoredGameSessionEntity,
    mutate: (session: StoredGameSessionEntity) => boolean,
    attempt = 0,
    schedulePhaseTransition = true,
    hydrationLocked = false,
  ): Promise<Result<void, GameSessionError>> {
    const sessionId = staleSession.gameSession.snapshot().sessionId;
    if (this.authority) {
      const hydrated = await this.hydrateAuthoritativeSession(sessionId, hydrationLocked);
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
        return this.commitAgentMutation(
          staleSession,
          mutate,
          attempt + 1,
          schedulePhaseTransition,
          hydrationLocked,
        );
      this.retryScheduledAgentTasks(sessionId);
      return err({ type: 'durability-unavailable' });
    }
    const published = await this.publishAgentProjection(session);
    if (published.isOk()) {
      if (schedulePhaseTransition) this.lifecycle.schedulePhaseTransition(session);
      return ok(undefined);
    }
    if (attempt >= 1) {
      this.retryScheduledAgentTasks(sessionId);
      return err(published.error);
    }
    return this.commitAgentMutation(
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
    reconnectGraceDeadline: string,
    attempt = 0,
  ): Promise<void> {
    const released = await authority.releaseReconnectLeaseAndBeginGrace(
      sessionId,
      connectionId,
      reconnectGraceDeadline,
    );
    if (!released.isErr() || attempt >= 2) return;
    await new Promise<void>((resolve) => this.clock.setTimeout(resolve, 100 * (attempt + 1)));
    await this.releaseReconnectLeaseWithRetry(
      authority,
      sessionId,
      connectionId,
      reconnectGraceDeadline,
      attempt + 1,
    );
  }

  private sessionForHolder(
    sessionId: string,
    cookie: string | undefined,
  ): Result<StoredGameSessionEntity, GameSessionError> {
    const session = this.sessions.get(sessionId);
    const holderId = this.guestCookies.read(cookie);
    if (!session || !holderId || session.holderId !== holderId) {
      return err({ type: 'unavailable-to-guest', sessionId });
    }

    if (session.status === 'in-progress') this.touch(session);
    return ok(session);
  }

  private activeSessionForHolder(
    sessionId: string,
    cookie: string | undefined,
  ): Result<StoredGameSessionEntity, GameSessionError> {
    return this.sessionForHolder(sessionId, cookie).andThen((session) => {
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
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
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

  private async touchAuthoritativeSession(
    session: StoredGameSessionEntity,
  ): Promise<Result<void, GameSessionError>> {
    return this.durability.touch(session);
  }

  private saveAuthoritativeProjection(
    session: StoredGameSessionEntity,
    projection: MafiaGameSessionProjectionEntity,
  ) {
    return this.durability.save(session, projection);
  }

  private durableSnapshot(
    session: StoredGameSessionEntity,
    projection: MafiaGameSessionProjectionEntity,
  ): DurableSessionSnapshot {
    return this.durability.snapshotFor(session, projection);
  }

  private async hydrateAuthoritativeSession(
    sessionId: string,
    mutationLocked = false,
  ): Promise<Result<void, GameSessionError>> {
    if (mutationLocked) return this.hydrateAuthoritativeSessionUnlocked(sessionId);
    return this.withSessionMutation(sessionId, () =>
      this.hydrateAuthoritativeSessionUnlocked(sessionId),
    );
  }

  private async hydrateAuthoritativeSessionUnlocked(
    sessionId: string,
  ): Promise<Result<void, GameSessionError>> {
    const hydrated = await this.durability.hydrate(sessionId);
    if (hydrated.isErr()) return hydrated;
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.status === 'in-progress' && session.agentActionsPending) {
        const actions = await this.submitAndCommitAgentActions(session, true);
        if (actions.isErr()) this.retryAgentActions(sessionId);
      }
      if (session.status === 'in-progress') {
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
      ? this.hydrateAuthoritativeSessionUnlocked(sessionId)
      : this.hydrateAuthoritativeSession(sessionId);
  }
}
