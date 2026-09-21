import type { MafiaGameProjection } from '@repo/mafia';
import dayjs, { type Dayjs } from 'dayjs';
import { err, ok, type Result } from 'neverthrow';
import { filter, map } from 'remeda';

import { createStructuredLogger, type StructuredLogger } from '../../logging/structured-logger.js';
import type { GameSessionAgentOrchestrator } from '../agents/game-session-agent-orchestrator.js';
import {
  type DurableSessionSnapshot,
  RedisGameSessionAuthority,
} from '../durability/redis-game-session-authority.js';
import type { GameSessionClock } from './game-session-clock.js';
import type { GameSessionError } from './game-session-error.js';
import { gameSessionsConfig } from './game-sessions.config.js';
import type { IdempotencyRecord } from './idempotency/idempotency-ledger.js';
import type { StoredGameSessionEntity } from './stored-game-session.entity.js';

type LifecycleState = {
  sessions: Map<string, StoredGameSessionEntity>;
  guestSessionCounts: Map<string, number>;
  idempotencyKeys: Map<string, IdempotencyRecord<string>>;
  eventSubscriberCounts: Map<string, number>;
};

type LifecyclePersistence = {
  authorityFor(): RedisGameSessionAuthority | undefined;
  save(
    session: StoredGameSessionEntity,
    projection: MafiaGameProjection,
  ): Promise<Result<boolean, GameSessionError>>;
  hydrate(sessionId: string, mutationLocked?: boolean): Promise<Result<void, GameSessionError>>;
  snapshotFor(
    session: StoredGameSessionEntity,
    projection: MafiaGameProjection,
  ): DurableSessionSnapshot;
  restore(snapshot: DurableSessionSnapshot): StoredGameSessionEntity;
};

type LifecyclePhaseOperations = {
  projectionFor(session: StoredGameSessionEntity): Result<MafiaGameProjection, GameSessionError>;
  publishProjection(
    session: StoredGameSessionEntity,
  ): Result<MafiaGameProjection, GameSessionError>;
  submitAgentActions(
    session: StoredGameSessionEntity,
    hydrationLocked?: boolean,
  ): Promise<Result<void, GameSessionError>>;
  retryAgentActions(sessionId: string): void;
  retryMafiaChatReplies(sessionId: string): void;
  retryPhaseTransition(sessionId: string): void;
  retryPhaseTransitionAfterClaimLease(sessionId: string): void;
};

type LifecycleRuntime = {
  state: LifecycleState;
  persistence: LifecyclePersistence;
  phaseOperations: LifecyclePhaseOperations;
  clock: GameSessionClock;
  agentActions: GameSessionAgentOrchestrator;
  disposeSession(session: StoredGameSessionEntity): void;
  now(): Dayjs;
  utcDay(): string;
  logger?: StructuredLogger;
};

export class GameSessionLifecycle {
  private recoveringDurableSessions = false;
  private readonly logger: StructuredLogger;

  constructor(private readonly runtime: LifecycleRuntime) {
    this.logger = runtime.logger ?? createStructuredLogger();
  }

  schedulePhaseTransition(session: StoredGameSessionEntity) {
    const clock = this.runtime.clock;
    if (session.phaseTimer) clock.clearTimeout(session.phaseTimer);
    const projection = session.gameSession.projectionFor(
      session.humanParticipantId,
      session.nextEventId,
    );
    if (
      projection.isErr() ||
      projection.value.public.phase === 'completed' ||
      session.status !== 'in-progress'
    )
      return;
    const delayMs = Math.max(
      0,
      dayjs(projection.value.public.phaseDeadline).diff(this.runtime.now()),
    );
    session.phaseTimer = clock.setTimeout(() => {
      const resolve = async () => {
        if (session.status !== 'in-progress') return;
        const phaseNow = clock.now();
        if (this.runtime.agentActions.hasDueScheduledTasks(session)) {
          const drained = await this.runtime.agentActions.drainDueScheduledTasks(session);
          if (drained.isErr()) {
            this.logger.error(
              { error: drained.error, sessionId: projection.value.sessionId },
              'Could not finish scheduled Agent tasks before a phase transition',
            );
            return;
          }
        }
        const current = this.runtime.state.sessions.get(projection.value.sessionId);
        if (!current || current.status !== 'in-progress') return;
        // An Agent's nomination or verdict belongs to the phase that requested it, even when
        // its decision arrives after the visible countdown. Resolving first discards that vote.
        // The pending action commits and schedules this deadline again once every Agent has voted.
        if (current.agentActionsPending) return;
        const advanced = current.gameSession.advanceDayPhase(phaseNow);
        if (advanced.isErr()) {
          this.logger.error(
            { error: advanced.error, sessionId: projection.value.sessionId },
            'Could not advance the Game Session phase at its deadline',
          );
          return;
        }
        if (advanced.value.type === 'not-due') {
          const authority = this.runtime.persistence.authorityFor();
          if (authority)
            await authority.releasePhaseDeadlineClaim(
              projection.value.sessionId,
              projection.value.public.phaseDeadline,
            );
          this.schedulePhaseTransition(current);
          return;
        }
        this.runtime.agentActions.clearTimers(current);
        current.agentActionsPending = true;
        const nextProjection = this.runtime.phaseOperations.publishProjection(current);
        if (nextProjection.isErr()) {
          this.logger.error(
            { error: nextProjection.error, sessionId: projection.value.sessionId },
            'Could not publish the Game Session phase transition',
          );
          return;
        }
        const saved = await this.runtime.persistence.save(current, nextProjection.value);
        if (saved.isOk() && saved.value) {
          this.logger.info(
            {
              sessionId: nextProjection.value.sessionId,
              eventId: nextProjection.value.eventId,
              previousPhase: projection.value.public.phase,
              phase: nextProjection.value.public.phase,
            },
            'Game Session phase transition persisted',
          );
          const actions = await this.runtime.phaseOperations.submitAgentActions(current);
          if (actions.isErr()) {
            this.logger.error(
              { error: actions.error, sessionId: nextProjection.value.sessionId },
              'Agent actions failed after a Game Session phase transition',
            );
            this.runtime.phaseOperations.retryAgentActions(nextProjection.value.sessionId);
            return;
          }
          this.schedulePhaseTransition(current);
          return;
        }
        const authority = this.runtime.persistence.authorityFor();
        if (!authority) return;
        await authority.releasePhaseDeadlineClaim(
          nextProjection.value.sessionId,
          projection.value.public.phaseDeadline,
        );
        const hydrated = await this.runtime.persistence.hydrate(nextProjection.value.sessionId);
        if (hydrated.isErr()) {
          this.logger.error(
            { error: hydrated.error, sessionId: nextProjection.value.sessionId },
            'Could not reload the authoritative Game Session after a phase transition conflict',
          );
          this.runtime.phaseOperations.retryPhaseTransition(nextProjection.value.sessionId);
          return;
        }
        const latest = this.runtime.state.sessions.get(nextProjection.value.sessionId);
        if (latest) this.schedulePhaseTransition(latest);
      };
      const authority = this.runtime.persistence.authorityFor();
      if (!authority) {
        void resolve().catch((cause: unknown) => {
          this.logger.error(
            { err: cause, sessionId: projection.value.sessionId },
            'Scheduled Game Session phase transition failed unexpectedly',
          );
        });
        return;
      }
      void authority
        .claimPhaseDeadline(projection.value.sessionId, projection.value.public.phaseDeadline)
        .match(
          (claimed) => {
            if (claimed) {
              void resolve().catch((cause: unknown) => {
                this.logger.error(
                  { err: cause, sessionId: projection.value.sessionId },
                  'Claimed Game Session phase transition failed unexpectedly',
                );
              });
              return;
            }
            this.runtime.phaseOperations.retryPhaseTransitionAfterClaimLease(
              projection.value.sessionId,
            );
          },
          (error) => {
            this.logger.error(
              { error, sessionId: projection.value.sessionId, operation: 'claim-phase-deadline' },
              'Could not claim the Game Session phase deadline',
            );
            this.runtime.phaseOperations.retryPhaseTransition(projection.value.sessionId);
          },
        );
    }, delayMs);
    session.phaseTimer.unref?.();
  }

  recoverExpiredPhase(session: StoredGameSessionEntity): Result<void, GameSessionError> {
    return session.gameSession.advanceDayPhase(this.runtime.clock.now()).andThen((result) => {
      if (result.type === 'not-due') return ok(undefined);
      void this.runtime.agentActions.submitDayActions(session);
      return this.runtime.phaseOperations
        .publishProjection(session)
        .andTee((projection) => void this.runtime.persistence.save(session, projection))
        .andTee(() => this.schedulePhaseTransition(session))
        .map(() => undefined);
    });
  }

  async recoverExpiredPhaseDurably(
    session: StoredGameSessionEntity,
    hydrationLocked = false,
  ): Promise<Result<void, GameSessionError>> {
    if (session.status !== 'in-progress') return ok(undefined);
    if (this.runtime.agentActions.hasDueScheduledTasks(session)) {
      const drained = await this.runtime.agentActions.drainDueScheduledTasks(
        session,
        hydrationLocked,
      );
      if (drained.isErr()) return drained;
    }
    const current = this.runtime.state.sessions.get(session.gameSession.snapshot().sessionId);
    if (!current || current.status !== 'in-progress') return ok(undefined);
    // Durable reads can recover a missed deadline while the Agent request for this phase is
    // still in flight. Keep the phase open until its required actions are persisted; otherwise
    // a late Night response is applied after the transition to Discussion and is discarded.
    if (current.agentActionsPending) return ok(undefined);
    const expected = current.gameSession
      .projectionFor(current.humanParticipantId, current.nextEventId)
      .map((projection) => projection.public.phaseDeadline);
    if (expected.isErr()) return err({ type: 'invalid-mafia-projection', cause: expected.error });
    const advanced = current.gameSession.advanceDayPhase(this.runtime.clock.now());
    if (advanced.isErr()) return err({ type: 'invalid-mafia-projection', cause: advanced.error });
    if (advanced.value.type === 'not-due') return ok(undefined);
    this.runtime.agentActions.clearTimers(current);
    current.agentActionsPending = true;
    const projection = this.runtime.phaseOperations.publishProjection(current);
    if (projection.isErr()) return projection.map(() => undefined);
    const authority = this.runtime.persistence.authorityFor();
    if (!authority) return err({ type: 'durability-unavailable' });
    const saved = await authority.resolveExpiredPhase(
      expected.value,
      this.runtime.persistence.snapshotFor(current, projection.value),
      { eventId: projection.value.eventId, projection: projection.value },
    );
    if (saved.isErr()) {
      this.logger.error(
        { error: saved.error, sessionId: current.gameSession.snapshot().sessionId },
        'Could not persist an expired Game Session phase transition',
      );
      return err({ type: 'durability-unavailable' });
    }
    if (!saved.value) {
      const hydrated = await this.runtime.persistence.hydrate(
        current.gameSession.snapshot().sessionId,
        hydrationLocked,
      );
      return hydrated.isErr() ? err(hydrated.error) : ok(undefined);
    }
    current.snapshotRevision += 1;
    const actions = await this.runtime.phaseOperations.submitAgentActions(current, hydrationLocked);
    if (actions.isErr()) {
      this.runtime.phaseOperations.retryAgentActions(projection.value.sessionId);
      return actions;
    }
    this.schedulePhaseTransition(current);
    return ok(undefined);
  }

  scheduleReconnectGrace(
    session: StoredGameSessionEntity,
    remainingGraceMs = gameSessionsConfig.reconnectGraceMs,
  ) {
    if (session.status !== 'in-progress') return;
    const { clock } = this.runtime;
    if (session.reconnectGraceTimer) clock.clearTimeout(session.reconnectGraceTimer);
    session.reconnectGraceDeadline = this.runtime.now().add(remainingGraceMs, 'millisecond');
    session.reconnectGraceTimer = clock.setTimeout(() => {
      if (this.hasEventSubscribers(session)) return;
      const abandon = () => {
        session.status = 'abandoned';
        this.runtime.disposeSession(session);
      };
      const authority = this.runtime.persistence.authorityFor();
      if (!authority) {
        abandon();
        this.runtime.phaseOperations.projectionFor(session).match(
          (projection) => void this.runtime.persistence.save(session, projection),
          () => undefined,
        );
        return;
      }
      void authority
        .abandonIfReconnectExpired(
          session.gameSession.snapshot().sessionId,
          session.reconnectGraceDeadline!.toISOString(),
          session.holderId,
        )
        .match(
          (abandoned) => {
            if (abandoned) abandon();
          },
          () => undefined,
        );
    }, remainingGraceMs);
    session.reconnectGraceTimer.unref?.();
  }

  async cleanupExpiredSessions() {
    const authority = this.runtime.persistence.authorityFor();
    if (authority) {
      const expired = await authority.expireInactiveSessions();
      if (expired.isErr())
        this.logger.error(
          { error: expired.error, operation: 'expire-inactive-sessions' },
          'Could not expire inactive durable Game Sessions',
        );
    }
    await this.recoverDurableSessions();
    await this.sweepReconnectGraceDeadlines();
    const now = this.runtime.now();
    for (const [sessionId, session] of this.runtime.state.sessions) {
      const limit =
        session.status === 'in-progress'
          ? gameSessionsConfig.inProgressIdleTtlMinutes
          : session.status === 'abandoned'
            ? gameSessionsConfig.abandonedSessionTtlMinutes
            : gameSessionsConfig.sessionIdleTtlHours * 60;
      if (
        this.hasEventSubscribers(session) ||
        now.diff(session.lastAccessedAt, 'minute', true) < limit
      )
        continue;
      session.events.complete();
      this.runtime.disposeSession(session);
      this.runtime.state.sessions.delete(sessionId);
      this.runtime.state.eventSubscriberCounts.delete(sessionId);
      for (const [key, record] of this.runtime.state.idempotencyKeys)
        if (record.result === sessionId) this.runtime.state.idempotencyKeys.delete(key);
    }
    const prefix = `${this.runtime.utcDay()}:`;
    for (const key of this.runtime.state.guestSessionCounts.keys())
      if (!key.startsWith(prefix)) this.runtime.state.guestSessionCounts.delete(key);
  }

  private hasEventSubscribers(session: StoredGameSessionEntity) {
    return (
      (this.runtime.state.eventSubscriberCounts.get(session.gameSession.snapshot().sessionId) ??
        0) > 0
    );
  }

  async recoverDurableSessions() {
    const authority = this.runtime.persistence.authorityFor();
    if (!authority || this.recoveringDurableSessions) return;
    this.recoveringDurableSessions = true;
    try {
      const snapshots = await authority.activeSnapshots();
      if (snapshots.isErr()) {
        this.logger.error(
          { error: snapshots.error, operation: 'recover-active-sessions' },
          'Could not load durable Game Sessions during recovery',
        );
        return;
      }
      const recoverableSnapshots = filter(
        snapshots.value,
        (snapshot) =>
          snapshot.status === 'in-progress' && !this.runtime.state.sessions.has(snapshot.sessionId),
      );
      if (recoverableSnapshots.length > 0) {
        this.logger.info(
          { recoverableSessionCount: recoverableSnapshots.length },
          'Recovering durable Game Sessions',
        );
      }
      await Promise.all(
        map(recoverableSnapshots, async (snapshot) => {
          const session = this.runtime.persistence.restore(snapshot);
          this.runtime.state.sessions.set(snapshot.sessionId, session);
          if (session.reconnectGraceDeadline) {
            const remaining = session.reconnectGraceDeadline.diff(
              this.runtime.now(),
              'millisecond',
            );
            if (remaining <= 0) {
              await authority.abandonIfReconnectExpired(
                snapshot.sessionId,
                session.reconnectGraceDeadline.toISOString(),
                snapshot.holderId,
              );
              return;
            }
            this.scheduleReconnectGrace(session, remaining);
          }
          const events = await authority.eventsAfter(snapshot.sessionId, 0);
          if (events.isOk()) {
            for (const event of events.value) session.events.next(event.projection);
          } else {
            this.logger.error(
              { error: events.error, sessionId: snapshot.sessionId, operation: 'load-events' },
              'Could not restore Game Session events during recovery',
            );
          }
          if (session.agentActionsPending) {
            const actions = await this.runtime.phaseOperations.submitAgentActions(session);
            if (actions.isErr()) {
              this.logger.error(
                { error: actions.error, sessionId: snapshot.sessionId },
                'Could not resume pending Agent actions during recovery',
              );
              this.runtime.phaseOperations.retryAgentActions(snapshot.sessionId);
              return;
            }
          }
          if (session.scheduledAgentMafiaChatReplies.length > 0) {
            this.runtime.phaseOperations.retryMafiaChatReplies(snapshot.sessionId);
          }
          const recovered = await this.recoverExpiredPhaseDurably(session);
          if (recovered.isErr()) {
            this.logger.error(
              { error: recovered.error, sessionId: snapshot.sessionId },
              'Could not recover an expired Game Session phase',
            );
            this.runtime.phaseOperations.retryPhaseTransition(snapshot.sessionId);
            return;
          }
          const current = this.runtime.state.sessions.get(snapshot.sessionId);
          if (!current || current.status !== 'in-progress') return;
          this.runtime.agentActions.resumeScheduledTasks(current);
          this.schedulePhaseTransition(current);
        }),
      );
    } finally {
      this.recoveringDurableSessions = false;
    }
  }

  private async sweepReconnectGraceDeadlines() {
    const authority = this.runtime.persistence.authorityFor();
    if (!authority) return;
    const snapshots = await authority.activeSnapshots();
    if (snapshots.isErr()) {
      this.logger.error(
        { error: snapshots.error, operation: 'sweep-reconnect-grace' },
        'Could not load Game Sessions while sweeping reconnect deadlines',
      );
      return;
    }
    await Promise.all(
      map(snapshots.value, async (snapshot) => {
        if (
          snapshot.reconnectLeaseDeadline &&
          dayjs(snapshot.reconnectLeaseDeadline).isBefore(this.runtime.now())
        ) {
          await authority.abandonIfReconnectLeaseExpired(
            snapshot.sessionId,
            snapshot.reconnectLeaseDeadline,
            snapshot.holderId,
          );
          return;
        }
        if (
          !snapshot.reconnectGraceDeadline ||
          !dayjs(snapshot.reconnectGraceDeadline).isBefore(this.runtime.now())
        )
          return;
        await authority.abandonIfReconnectExpired(
          snapshot.sessionId,
          snapshot.reconnectGraceDeadline,
          snapshot.holderId,
        );
      }),
    );
  }
}
