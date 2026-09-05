import { randomUUID } from 'node:crypto';

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { MafiaGameModule, mafiaGameConfig } from '@repo/mafia';
import dayjs from 'dayjs';
import { err, ok, type Result } from 'neverthrow';
import { defer, filter, finalize, type Observable, ReplaySubject } from 'rxjs';
import { match, P } from 'ts-pattern';

import { agentDecisionGateway, type AgentDecisionGateway } from './agent-decision.gateway';
import { cooldownRetryAfterMs } from './cooldown/cooldown';
import type { MafiaGameSessionProjectionEntity } from './entities/mafia-game-session-projection.entity';
import type { StoredGameSessionEntity } from './entities/stored-game-session.entity';
import { GameSessionAgentOrchestrator } from './game-session-agent-orchestrator';
import type { GameSessionError } from './game-session-error';
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
};

@Injectable()
export class GameSessionsService implements OnModuleInit, OnModuleDestroy {
  private readonly mafiaModule = new MafiaGameModule();
  private readonly sessions = new Map<string, StoredGameSessionEntity>();
  private readonly guestSessionCounts = new Map<string, number>();
  private readonly idempotencyKeys = new Map<string, IdempotencyRecord<string>>();
  private readonly guestCookies = createGuestCookieSigner(
    gameSessionsConfig.guestCookieName,
    guestCookieSecret(),
  );
  private readonly agentActions: GameSessionAgentOrchestrator;
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(@Inject(agentDecisionGateway) agentDecisions: AgentDecisionGateway) {
    this.agentActions = new GameSessionAgentOrchestrator(
      agentDecisions,
      this.publishProjection.bind(this),
    );
  }

  onModuleInit() {
    this.cleanupTimer = setInterval(
      () => this.cleanupExpiredSessions(),
      gameSessionsConfig.cleanupIntervalMs,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  createMafiaSession(
    cookie: string | undefined,
    participantCount: number = mafiaGameConfig.defaultParticipantCount,
    idempotencyKey: string | undefined,
  ): Result<CreatedMafiaSession, GameSessionError> {
    this.cleanupExpiredSessions();
    const holderId = this.guestCookies.read(cookie) ?? randomUUID();
    const scopedIdempotencyKey = idempotencyKey && `${holderId}:${idempotencyKey}`;
    if (scopedIdempotencyKey) {
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
    const count = this.guestSessionCounts.get(countKey) ?? 0;
    if (count >= gameSessionsConfig.guestAllowance) {
      return err({ type: 'guest-allowance-exhausted' });
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
      lastAccessedAt: dayjs(),
      activeEventSubscribers: 0,
      publicSpeechIdempotencyKeys: new Map(),
      mafiaChatIdempotencyKeys: new Map(),
      dayActionIdempotencyKeys: new Map(),
      discussionTimeAdjustmentIdempotencyKeys: new Map(),
      phaseTimer: undefined,
      agentFinalDefenceTimer: undefined,
      mafiaTargetFallbackTimer: undefined,
    };
    this.sessions.set(sessionId, session);
    if (scopedIdempotencyKey) {
      recordIdempotency(
        this.idempotencyKeys,
        scopedIdempotencyKey,
        String(participantCount),
        sessionId,
      );
    }
    this.guestSessionCounts.set(countKey, count + 1);
    this.agentActions.submitDayActions(session);

    return this.publishProjection(session)
      .andTee(() => this.schedulePhaseTransition(session))
      .map((projection) => ({ holderId, projection }));
  }

  getProjection(
    sessionId: string,
    cookie: string | undefined,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
    this.cleanupExpiredSessions();
    return this.activeSessionForHolder(sessionId, cookie).andThen((session) =>
      this.projectionFor(session),
    );
  }

  eventsFor(
    sessionId: string,
    cookie: string | undefined,
    lastEventId: number | undefined,
  ): Result<Observable<MafiaGameSessionProjectionEntity>, GameSessionError> {
    this.cleanupExpiredSessions();
    return this.activeSessionForHolder(sessionId, cookie).map((session) =>
      defer(() => {
        session.activeEventSubscribers += 1;
        this.touch(session);
        return session.events.asObservable().pipe(
          filter((projection) => lastEventId === undefined || projection.eventId > lastEventId),
          finalize(() => {
            session.activeEventSubscribers -= 1;
            this.touch(session);
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

  submitPublicSpeech(
    sessionId: string,
    cookie: string | undefined,
    content: string,
    idempotencyKey: string,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
    return this.runIdempotentProjectionAction(sessionId, cookie, {
      idempotencyKey,
      fingerprint: content,
      conflict: { type: 'public-speech-idempotency-conflict' },
      records: (session) => session.publicSpeechIdempotencyKeys,
      submit: (session) => {
        const now = dayjs();
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
          this.agentActions.publishPublicSpeechReplies(session);
        });
      },
    });
  }

  submitMafiaChat(
    sessionId: string,
    cookie: string | undefined,
    content: string,
    idempotencyKey: string,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
    return this.runIdempotentProjectionAction(sessionId, cookie, {
      idempotencyKey,
      fingerprint: content,
      conflict: { type: 'mafia-chat-idempotency-conflict' },
      records: (session) => session.mafiaChatIdempotencyKeys,
      submit: (session) => {
        const now = dayjs();
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
            this.agentActions.publishMafiaChatReplies(session);
          });
      },
    });
  }

  submitNomination(
    sessionId: string,
    cookie: string | undefined,
    targetParticipantId: string,
    idempotencyKey: string,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
    return this.submitDayAction(
      sessionId,
      cookie,
      `nomination:${targetParticipantId}`,
      idempotencyKey,
      (session) =>
        session.gameSession.submitNomination(session.humanParticipantId, targetParticipantId),
    );
  }

  submitVerdict(
    sessionId: string,
    cookie: string | undefined,
    vote: 'eliminate' | 'spare',
    idempotencyKey: string,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
    return this.submitDayAction(sessionId, cookie, `verdict:${vote}`, idempotencyKey, (session) =>
      session.gameSession.submitVerdict(session.humanParticipantId, vote),
    );
  }

  submitMafiaTarget(
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

  submitDoctorProtection(
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

  submitDetectiveInvestigation(
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

  adjustDiscussionTime(
    sessionId: string,
    cookie: string | undefined,
    adjustmentSeconds: 10 | -10,
    expectedDeadline: string,
    idempotencyKey: string,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
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

        const now = dayjs();
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
          this.schedulePhaseTransition(session);
        });
      },
    });
  }

  submitFinalDefence(
    sessionId: string,
    cookie: string | undefined,
    content: string,
    idempotencyKey: string,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
    const fingerprint = `final-defence:${content}`;
    return this.runIdempotentProjectionAction(sessionId, cookie, {
      idempotencyKey,
      fingerprint,
      conflict: { type: 'day-action-idempotency-conflict' },
      records: (session) => session.dayActionIdempotencyKeys,
      submit: (session) => {
        const now = dayjs();
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

  private submitDayAction(
    sessionId: string,
    cookie: string | undefined,
    fingerprint: string,
    idempotencyKey: string,
    submit: (
      session: StoredGameSessionEntity,
    ) => ReturnType<StoredGameSessionEntity['gameSession']['submitNomination']>,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
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

  private runIdempotentProjectionAction(
    sessionId: string,
    cookie: string | undefined,
    { idempotencyKey, fingerprint, conflict, records, submit }: IdempotentProjectionAction,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
    return this.activeSessionForHolder(sessionId, cookie).andThen((session) => {
      const ledger = records(session);
      const idempotencyResult = match(lookupIdempotency(ledger, idempotencyKey, fingerprint))
        .with({ type: 'replayed' }, ({ result }) =>
          ok<MafiaGameSessionProjectionEntity, GameSessionError>(result),
        )
        .with({ type: 'conflict' }, () =>
          err<MafiaGameSessionProjectionEntity, GameSessionError>(conflict),
        )
        .with({ type: 'new-request' }, () => undefined)
        .exhaustive();
      if (idempotencyResult) return idempotencyResult;

      return submit(session).andTee((projection) => {
        recordIdempotency(ledger, idempotencyKey, fingerprint, projection);
      });
    });
  }

  guestCookieName() {
    return gameSessionsConfig.guestCookieName;
  }

  signGuestId(holderId: string) {
    return this.guestCookies.sign(holderId);
  }

  private utcDay() {
    return new Date().toISOString().slice(0, 10);
  }

  private publishProjection(
    session: StoredGameSessionEntity,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
    this.touch(session);
    session.nextEventId += 1;
    return session.gameSession
      .projectionFor(session.humanParticipantId, session.nextEventId)
      .mapErr((cause): GameSessionError => ({
        type: 'invalid-mafia-projection',
        cause,
      }))
      .andTee((projection) => {
        session.events.next(projection);
      });
  }

  private schedulePhaseTransition(session: StoredGameSessionEntity) {
    if (session.phaseTimer) {
      clearTimeout(session.phaseTimer);
    }
    const projection = session.gameSession.projectionFor(
      session.humanParticipantId,
      session.nextEventId,
    );
    if (projection.isErr() || projection.value.public.phase === 'completed') return;
    const delayMs = Math.max(0, Date.parse(projection.value.public.phaseDeadline) - Date.now());
    session.phaseTimer = setTimeout(() => {
      session.gameSession.advanceDayPhase(new Date()).match(
        (result) => {
          if (result.type === 'not-due') {
            this.schedulePhaseTransition(session);
            return;
          }
          this.agentActions.submitDayActions(session);
          this.publishProjection(session).match(
            () => this.schedulePhaseTransition(session),
            () => undefined,
          );
        },
        () => undefined,
      );
    }, delayMs);
    session.phaseTimer.unref();
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

    this.touch(session);
    return ok(session);
  }

  private activeSessionForHolder(
    sessionId: string,
    cookie: string | undefined,
  ): Result<StoredGameSessionEntity, GameSessionError> {
    return this.sessionForHolder(sessionId, cookie).andThen((session) =>
      this.recoverExpiredPhase(session).map(() => session),
    );
  }

  private recoverExpiredPhase(session: StoredGameSessionEntity): Result<void, GameSessionError> {
    return session.gameSession.advanceDayPhase(new Date()).andThen((result) => {
      if (result.type === 'not-due') return ok<void, GameSessionError>(undefined);

      this.agentActions.submitDayActions(session);
      return this.publishProjection(session)
        .andTee(() => this.schedulePhaseTransition(session))
        .map(() => undefined);
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
    session.lastAccessedAt = dayjs();
  }

  private cleanupExpiredSessions() {
    const now = dayjs();
    for (const [sessionId, session] of this.sessions) {
      if (
        session.activeEventSubscribers > 0 ||
        now.diff(session.lastAccessedAt, 'hour', true) < gameSessionsConfig.sessionIdleTtlHours
      ) {
        continue;
      }

      session.events.complete();
      if (session.phaseTimer) {
        clearTimeout(session.phaseTimer);
      }
      this.agentActions.clearTimers(session);
      this.sessions.delete(sessionId);
      for (const [key, record] of this.idempotencyKeys) {
        if (record.result === sessionId) {
          this.idempotencyKeys.delete(key);
        }
      }
    }

    const activeDayPrefix = `${this.utcDay()}:`;
    for (const countKey of this.guestSessionCounts.keys()) {
      if (!countKey.startsWith(activeDayPrefix)) {
        this.guestSessionCounts.delete(countKey);
      }
    }
  }
}
