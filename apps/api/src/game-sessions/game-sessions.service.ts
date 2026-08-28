import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  MafiaGameModule,
  mafiaGameConfig,
  type MafiaPhase,
  type MafiaProjectionError,
  type MafiaSessionInputError,
} from '@repo/mafia';
import dayjs from 'dayjs';
import { err, ok, type Result } from 'neverthrow';
import { filter as filterValues, find, map, pipe } from 'remeda';
import { defer, filter, finalize, type Observable, ReplaySubject } from 'rxjs';
import { match, P } from 'ts-pattern';

import { agentSpeechGateway, type AgentSpeechGateway } from './agent-speech.gateway';
import { cooldownRetryAfterMs } from './cooldown/cooldown';
import type { MafiaGameSessionProjectionEntity } from './entities/mafia-game-session-projection.entity';
import type { StoredGameSessionEntity } from './entities/stored-game-session.entity';
import { gameSessionsConfig } from './game-sessions.config';
import {
  type IdempotencyRecord,
  lookupIdempotency,
  recordIdempotency,
} from './idempotency/idempotency-ledger';

export type GameSessionError =
  | { type: 'idempotency-conflict' }
  | { type: 'guest-allowance-exhausted' }
  | { type: 'unavailable-to-guest'; sessionId: string }
  | { type: 'session-not-found'; sessionId: string }
  | { type: 'invalid-mafia-session-input'; cause: MafiaSessionInputError }
  | { type: 'invalid-mafia-projection'; cause: MafiaProjectionError }
  | { type: 'public-speech-idempotency-conflict' }
  | { type: 'public-speech-rate-limited'; retryAfterMs: number }
  | { type: 'invalid-public-speech' }
  | { type: 'invalid-day-action' }
  | { type: 'day-action-idempotency-conflict' }
  | { type: 'day-action-rate-limited'; retryAfterMs: number }
  | { type: 'phase-time-adjustment-idempotency-conflict' }
  | { type: 'phase-time-adjustment-rate-limited'; retryAfterMs: number }
  | { type: 'invalid-phase-time-adjustment' }
  | { type: 'stale-phase-time-adjustment' }
  | { type: 'expired-phase'; phaseDeadline: string }
  | { type: 'dead-participant'; participantId: string };

type CreatedMafiaSession = {
  holderId: string;
  projection: MafiaGameSessionProjectionEntity;
};

@Injectable()
export class GameSessionsService implements OnModuleInit, OnModuleDestroy {
  private readonly mafiaModule = new MafiaGameModule();
  private readonly sessions = new Map<string, StoredGameSessionEntity>();
  private readonly guestSessionCounts = new Map<string, number>();
  private readonly idempotencyKeys = new Map<string, IdempotencyRecord<string>>();
  private readonly cookieSecret = this.guestCookieSecret();
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(@Inject(agentSpeechGateway) private readonly speechGateway: AgentSpeechGateway) {}

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
    const holderId = this.readGuestId(cookie) ?? randomUUID();
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
      phaseDeadline: new Date(Date.now() + mafiaGameConfig.dayDiscussionDurationMs),
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
      nextPhaseTimeAdjustmentAt: undefined,
      lastAccessedAt: dayjs(),
      activeEventSubscribers: 0,
      publicSpeechIdempotencyKeys: new Map(),
      dayActionIdempotencyKeys: new Map(),
      phaseTimeAdjustmentIdempotencyKeys: new Map(),
      phaseTimer: undefined,
      agentFinalDefenceTimer: undefined,
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
    return this.activeSessionForHolder(sessionId, cookie).andThen((session) => {
      const lookup = lookupIdempotency(
        session.publicSpeechIdempotencyKeys,
        idempotencyKey,
        content,
      );
      const idempotencyResult = match(lookup)
        .with({ type: 'replayed' }, ({ result }) =>
          ok<MafiaGameSessionProjectionEntity, GameSessionError>(result),
        )
        .with({ type: 'conflict' }, () =>
          err<MafiaGameSessionProjectionEntity, GameSessionError>({
            type: 'public-speech-idempotency-conflict',
          }),
        )
        .with({ type: 'new-request' }, () => undefined)
        .exhaustive();
      if (idempotencyResult) return idempotencyResult;

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
          .with({ type: 'unknown-participant' }, () => ({ type: 'invalid-public-speech' as const }))
          .with({ type: 'invalid-phase' }, () => ({ type: 'invalid-public-speech' as const }))
          .with({ type: 'not-nominated-participant' }, () => ({
            type: 'invalid-public-speech' as const,
          }))
          .with({ type: 'invalid-target' }, () => ({ type: 'invalid-public-speech' as const }))
          .exhaustive();
        return err<MafiaGameSessionProjectionEntity, GameSessionError>(error);
      }

      return this.publishProjection(session).andTee((projection) => {
        session.nextPublicSpeechAt = now.add(
          gameSessionsConfig.humanActionCooldownMs,
          'millisecond',
        );
        recordIdempotency(session.publicSpeechIdempotencyKeys, idempotencyKey, content, projection);
        this.publishAgentReplies(session);
      });
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

  adjustPhaseTime(
    sessionId: string,
    cookie: string | undefined,
    adjustmentSeconds: 10 | -10,
    expectedPhase: Exclude<MafiaPhase, 'completed'>,
    expectedPhaseDeadline: string,
    idempotencyKey: string,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
    return this.activeSessionForHolder(sessionId, cookie).andThen((session) => {
      const fingerprint = String(adjustmentSeconds);
      const lookup = lookupIdempotency(
        session.phaseTimeAdjustmentIdempotencyKeys,
        idempotencyKey,
        fingerprint,
      );
      const idempotencyResult = match(lookup)
        .with({ type: 'replayed' }, ({ result }) =>
          ok<MafiaGameSessionProjectionEntity, GameSessionError>(result),
        )
        .with({ type: 'conflict' }, () =>
          err<MafiaGameSessionProjectionEntity, GameSessionError>({
            type: 'phase-time-adjustment-idempotency-conflict',
          }),
        )
        .with({ type: 'new-request' }, () => undefined)
        .exhaustive();
      if (idempotencyResult) return idempotencyResult;

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
      if (
        currentProjection.value.public.phase !== expectedPhase ||
        currentProjection.value.public.phaseDeadline !== expectedPhaseDeadline
      ) {
        return err<MafiaGameSessionProjectionEntity, GameSessionError>({
          type: 'stale-phase-time-adjustment',
        });
      }

      const now = dayjs();
      const retryAfterMs = cooldownRetryAfterMs(session.nextPhaseTimeAdjustmentAt, now);
      if (retryAfterMs) {
        return err<MafiaGameSessionProjectionEntity, GameSessionError>({
          type: 'phase-time-adjustment-rate-limited',
          retryAfterMs,
        });
      }

      const adjustment = session.gameSession.adjustPhaseTime(adjustmentSeconds, now.toDate());
      if (adjustment.isErr()) {
        return err<MafiaGameSessionProjectionEntity, GameSessionError>({
          type: 'invalid-phase-time-adjustment',
        });
      }

      const phaseResult = session.gameSession.advanceDayPhase(now.toDate());
      phaseResult.match(
        (result) => {
          if (result.type !== 'not-due') this.submitAgentDayActions(session);
        },
        () => undefined,
      );

      return this.publishProjection(session).andTee((projection) => {
        session.nextPhaseTimeAdjustmentAt = now.add(
          gameSessionsConfig.humanActionCooldownMs,
          'millisecond',
        );
        recordIdempotency(
          session.phaseTimeAdjustmentIdempotencyKeys,
          idempotencyKey,
          fingerprint,
          projection,
        );
        this.schedulePhaseTransition(session);
      });
    });
  }

  submitFinalDefence(
    sessionId: string,
    cookie: string | undefined,
    content: string,
    idempotencyKey: string,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
    return this.activeSessionForHolder(sessionId, cookie).andThen((session) => {
      const fingerprint = `final-defence:${content}`;
      const lookup = lookupIdempotency(
        session.dayActionIdempotencyKeys,
        idempotencyKey,
        fingerprint,
      );
      const idempotencyResult = match(lookup)
        .with({ type: 'replayed' }, ({ result }) =>
          ok<MafiaGameSessionProjectionEntity, GameSessionError>(result),
        )
        .with({ type: 'conflict' }, () =>
          err<MafiaGameSessionProjectionEntity, GameSessionError>({
            type: 'day-action-idempotency-conflict',
          }),
        )
        .with({ type: 'new-request' }, () => undefined)
        .exhaustive();
      if (idempotencyResult) return idempotencyResult;

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

      return this.publishProjection(session).map((projection) => {
        session.nextFinalDefenceAt = now.add(
          gameSessionsConfig.humanActionCooldownMs,
          'millisecond',
        );
        recordIdempotency(
          session.dayActionIdempotencyKeys,
          idempotencyKey,
          fingerprint,
          projection,
        );
        return projection;
      });
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
    return this.activeSessionForHolder(sessionId, cookie).andThen((session) => {
      const lookup = lookupIdempotency(
        session.dayActionIdempotencyKeys,
        idempotencyKey,
        fingerprint,
      );
      const idempotencyResult = match(lookup)
        .with({ type: 'replayed' }, ({ result }) =>
          ok<MafiaGameSessionProjectionEntity, GameSessionError>(result),
        )
        .with({ type: 'conflict' }, () =>
          err<MafiaGameSessionProjectionEntity, GameSessionError>({
            type: 'day-action-idempotency-conflict',
          }),
        )
        .with({ type: 'new-request' }, () => undefined)
        .exhaustive();
      if (idempotencyResult) return idempotencyResult;
      const action = submit(session);
      if (action.isErr()) {
        return err<MafiaGameSessionProjectionEntity, GameSessionError>({
          type: 'invalid-day-action',
        });
      }
      return this.publishProjection(session).andTee((projection) => {
        recordIdempotency(
          session.dayActionIdempotencyKeys,
          idempotencyKey,
          fingerprint,
          projection,
        );
      });
    });
  }

  guestCookieName() {
    return gameSessionsConfig.guestCookieName;
  }

  signGuestId(holderId: string) {
    return `${holderId}.${this.signatureFor(holderId)}`;
  }

  private readGuestId(cookie: string | undefined) {
    const value = pipe(
      cookie?.split(';') ?? [],
      map((part) => part.trim()),
      find((part) => part.startsWith(`${gameSessionsConfig.guestCookieName}=`)),
    )?.slice(gameSessionsConfig.guestCookieName.length + 1);
    if (!value) {
      return undefined;
    }

    const separator = value.lastIndexOf('.');
    if (separator < 1) {
      return undefined;
    }

    const holderId = value.slice(0, separator);
    const signature = value.slice(separator + 1);
    const expectedSignature = this.signatureFor(holderId);
    if (signature.length !== expectedSignature.length) {
      return undefined;
    }

    return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
      ? holderId
      : undefined;
  }

  private signatureFor(holderId: string) {
    return createHmac('sha256', this.cookieSecret).update(holderId).digest('base64url');
  }

  private utcDay() {
    return new Date().toISOString().slice(0, 10);
  }

  private guestCookieSecret() {
    if (process.env.GUEST_COOKIE_SECRET) {
      return process.env.GUEST_COOKIE_SECRET;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error('GUEST_COOKIE_SECRET must be configured in production.');
    }

    return 'local-development-secret';
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

  private publishAgentReplies(session: StoredGameSessionEntity) {
    for (const participantId of session.gameSession.livingAgentParticipantIds(
      session.humanParticipantId,
    )) {
      session.gameSession.agentSpeechContextFor(participantId).match(
        (context) => {
          const decision = this.speechGateway.decide(context);
          return match(decision)
            .with({ type: 'remain-silent' }, () => undefined)
            .with(
              { type: 'speak', content: P.select('content'), delayMs: P.select('delayMs') },
              ({ content, delayMs }) =>
                this.scheduleAgentReply(session, participantId, content, delayMs),
            )
            .exhaustive();
        },
        () => undefined,
      );
    }
  }

  private scheduleAgentReply(
    session: StoredGameSessionEntity,
    participantId: string,
    content: string,
    delayMs: number,
  ) {
    const timer = setTimeout(() => {
      session.gameSession.submitPublicSpeech(participantId, content).match(
        () =>
          this.publishProjection(session).match(
            () => undefined,
            () => undefined,
          ),
        () => undefined,
      );
    }, delayMs);
    timer.unref();
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
          if (result.type === 'not-due') return;
          this.submitAgentDayActions(session);
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

  private submitAgentDayActions(session: StoredGameSessionEntity) {
    const projection = session.gameSession.projectionFor(
      session.humanParticipantId,
      session.nextEventId,
    );
    if (projection.isErr()) return;
    const agentIds = session.gameSession.livingAgentParticipantIds(session.humanParticipantId);
    if (projection.value.public.phase === 'nomination') {
      const livingParticipantIds = pipe(
        projection.value.public.participants,
        filterValues(({ alive }) => alive),
        map(({ id }) => id),
      );
      if (livingParticipantIds.length === 0) return;
      for (const participantId of agentIds) {
        const targetParticipantId = livingParticipantIds[randomInt(livingParticipantIds.length)];
        if (!targetParticipantId) continue;
        session.gameSession.submitNomination(participantId, targetParticipantId);
      }
    }
    if (projection.value.public.phase === 'verdict') {
      for (const participantId of agentIds) {
        session.gameSession.submitVerdict(
          participantId,
          randomInt(2) === 0 ? 'eliminate' : 'spare',
        );
      }
    }
    if (projection.value.public.phase === 'final-defence') {
      const nominatedParticipantId = projection.value.public.nominatedParticipantId;
      if (!nominatedParticipantId || nominatedParticipantId === session.humanParticipantId) return;
      session.gameSession.agentSpeechContextFor(nominatedParticipantId).match(
        (context) => {
          const decision = this.speechGateway.decideFinalDefence(context);
          session.gameSession.submitFinalDefence(nominatedParticipantId, decision.opening).match(
            () =>
              this.scheduleAgentFinalDefenceFollowUp(
                session,
                nominatedParticipantId,
                decision.followUp,
                projection.value.public.phaseDeadline,
              ),
            () => undefined,
          );
        },
        () => undefined,
      );
    }
  }

  private scheduleAgentFinalDefenceFollowUp(
    session: StoredGameSessionEntity,
    participantId: string,
    content: string,
    phaseDeadline: string,
  ) {
    if (session.agentFinalDefenceTimer) {
      clearTimeout(session.agentFinalDefenceTimer);
    }
    const delayMs = Math.max(0, Math.floor((Date.parse(phaseDeadline) - Date.now()) / 2));
    session.agentFinalDefenceTimer = setTimeout(() => {
      session.gameSession.submitFinalDefence(participantId, content).match(
        () =>
          this.publishProjection(session).match(
            () => undefined,
            () => undefined,
          ),
        () => undefined,
      );
    }, delayMs);
    session.agentFinalDefenceTimer.unref();
  }

  private sessionForHolder(
    sessionId: string,
    cookie: string | undefined,
  ): Result<StoredGameSessionEntity, GameSessionError> {
    const session = this.sessions.get(sessionId);
    const holderId = this.readGuestId(cookie);
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

      this.submitAgentDayActions(session);
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
      if (session.agentFinalDefenceTimer) {
        clearTimeout(session.agentFinalDefenceTimer);
      }
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
