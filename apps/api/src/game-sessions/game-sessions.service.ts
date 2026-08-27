import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  MafiaGameModule,
  mafiaGameConfig,
  type MafiaProjectionError,
  type MafiaSessionInputError,
} from '@repo/mafia';
import dayjs from 'dayjs';
import { err, ok, type Result } from 'neverthrow';
import { find, map, pipe } from 'remeda';
import { defer, filter, finalize, type Observable, ReplaySubject } from 'rxjs';
import { match, P } from 'ts-pattern';

import { agentSpeechGateway, type AgentSpeechGateway } from './agent-speech.gateway';
import type { MafiaGameSessionProjectionEntity } from './entities/mafia-game-session-projection.entity';
import type { StoredGameSessionEntity } from './entities/stored-game-session.entity';
import { gameSessionsConfig } from './game-sessions.config';

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
  private readonly idempotencyKeys = new Map<
    string,
    { sessionId: string; participantCount: number }
  >();
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
    const idempotencyRecord =
      scopedIdempotencyKey && this.idempotencyKeys.get(scopedIdempotencyKey);
    if (idempotencyRecord) {
      if (idempotencyRecord.participantCount !== participantCount) {
        return err({ type: 'idempotency-conflict' });
      }

      const existingSession = this.sessions.get(idempotencyRecord.sessionId);
      if (existingSession) {
        this.touch(existingSession);
        return this.projectionFor(existingSession).map((projection) => ({ holderId, projection }));
      }

      this.idempotencyKeys.delete(scopedIdempotencyKey);
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
      lastAccessedAt: dayjs(),
      activeEventSubscribers: 0,
      publicSpeechIdempotencyKeys: new Map(),
    };
    this.sessions.set(sessionId, session);
    if (scopedIdempotencyKey) {
      this.idempotencyKeys.set(scopedIdempotencyKey, { sessionId, participantCount });
    }
    this.guestSessionCounts.set(countKey, count + 1);

    return this.publishProjection(session).map((projection) => ({ holderId, projection }));
  }

  getProjection(
    sessionId: string,
    cookie: string | undefined,
  ): Result<MafiaGameSessionProjectionEntity, GameSessionError> {
    this.cleanupExpiredSessions();
    return this.sessionForHolder(sessionId, cookie).andThen((session) =>
      this.projectionFor(session),
    );
  }

  eventsFor(
    sessionId: string,
    cookie: string | undefined,
    lastEventId: number | undefined,
  ): Result<Observable<MafiaGameSessionProjectionEntity>, GameSessionError> {
    this.cleanupExpiredSessions();
    return this.sessionForHolder(sessionId, cookie).map((session) =>
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
    return this.sessionForHolder(sessionId, cookie).andThen((session) => {
      const previous = session.publicSpeechIdempotencyKeys.get(idempotencyKey);
      if (previous) {
        return previous.content === content
          ? ok<MafiaGameSessionProjectionEntity, GameSessionError>(previous.projection)
          : err<MafiaGameSessionProjectionEntity, GameSessionError>({
              type: 'public-speech-idempotency-conflict',
            });
      }

      const now = dayjs();
      if (session.nextPublicSpeechAt?.isAfter(now)) {
        return err<MafiaGameSessionProjectionEntity, GameSessionError>({
          type: 'public-speech-rate-limited',
          retryAfterMs: session.nextPublicSpeechAt.diff(now),
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
          .exhaustive();
        return err<MafiaGameSessionProjectionEntity, GameSessionError>(error);
      }

      return this.publishProjection(session).andTee((projection) => {
        session.nextPublicSpeechAt = now.add(
          gameSessionsConfig.publicSpeechCooldownMs,
          'millisecond',
        );
        session.publicSpeechIdempotencyKeys.set(idempotencyKey, { content, projection });
        this.publishAgentReplies(session);
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
      this.sessions.delete(sessionId);
      for (const [key, record] of this.idempotencyKeys) {
        if (record.sessionId === sessionId) {
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
