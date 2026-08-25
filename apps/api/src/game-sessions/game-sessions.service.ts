import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { MafiaGameModule } from '@repo/mafia';
import dayjs from 'dayjs';
import { defer, filter, finalize, type Observable, ReplaySubject } from 'rxjs';

import type { MafiaGameSessionProjectionEntity } from './entities/mafia-game-session-projection.entity';
import type { StoredGameSessionEntity } from './entities/stored-game-session.entity';

const guestCookieName = 'withai_guest';
const guestAllowance = 10;
const dayDiscussionDurationMs = 2 * 60 * 1000;
const sessionIdleTtlHours = 24;
const cleanupIntervalMs = 60 * 60 * 1000;

@Injectable()
export class GameSessionsService implements OnModuleInit, OnModuleDestroy {
  private readonly mafiaModule = new MafiaGameModule();
  private readonly sessions = new Map<string, StoredGameSessionEntity>();
  private readonly guestSessionCounts = new Map<string, number>();
  private readonly idempotencyKeys = new Map<string, string>();
  private readonly cookieSecret = this.guestCookieSecret();
  private cleanupTimer: NodeJS.Timeout | undefined;

  onModuleInit() {
    this.cleanupTimer = setInterval(() => this.cleanupExpiredSessions(), cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  createMafiaSession(
    cookie: string | undefined,
    participantCount = 5,
    idempotencyKey: string | undefined,
  ) {
    this.cleanupExpiredSessions();
    const existingSessionId = idempotencyKey && this.idempotencyKeys.get(idempotencyKey);
    if (existingSessionId) {
      const existingSession = this.sessions.get(existingSessionId);
      if (existingSession) {
        this.touch(existingSession);
        return {
          holderId: existingSession.holderId,
          projection: this.projectionFor(existingSession),
        };
      }

      this.idempotencyKeys.delete(idempotencyKey);
    }

    const holderId = this.readGuestId(cookie) ?? randomUUID();
    const countKey = `${this.utcDay()}:${holderId}`;
    const count = this.guestSessionCounts.get(countKey) ?? 0;
    if (count >= guestAllowance) {
      throw new HttpException(
        'Your Guest Play Allowance is exhausted for today.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const sessionId = randomUUID();
    const gameSession = this.mafiaModule.create({
      sessionId,
      participantCount,
      phaseDeadline: new Date(Date.now() + dayDiscussionDurationMs),
    });
    const session: StoredGameSessionEntity = {
      holderId,
      humanParticipantId: 'participant-1',
      gameSession,
      events: new ReplaySubject<MafiaGameSessionProjectionEntity>(100),
      nextEventId: 0,
      lastAccessedAt: dayjs(),
      activeEventSubscribers: 0,
    };
    this.sessions.set(sessionId, session);
    if (idempotencyKey) {
      this.idempotencyKeys.set(idempotencyKey, sessionId);
    }
    this.guestSessionCounts.set(countKey, count + 1);

    return { holderId, projection: this.publishProjection(session) };
  }

  getProjection(sessionId: string, cookie: string | undefined): MafiaGameSessionProjectionEntity {
    this.cleanupExpiredSessions();
    const session = this.sessionForHolder(sessionId, cookie);
    return this.projectionFor(session);
  }

  eventsFor(
    sessionId: string,
    cookie: string | undefined,
    lastEventId: number | undefined,
  ): Observable<MafiaGameSessionProjectionEntity> {
    this.cleanupExpiredSessions();
    const session = this.sessionForHolder(sessionId, cookie);
    return defer(() => {
      session.activeEventSubscribers += 1;
      this.touch(session);
      return session.events.asObservable().pipe(
        filter((projection) => lastEventId === undefined || projection.eventId > lastEventId),
        finalize(() => {
          session.activeEventSubscribers -= 1;
          this.touch(session);
        }),
      );
    });
  }

  publishSessionProjection(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Game Session is not available.');
    }

    return this.publishProjection(session);
  }

  guestCookieName() {
    return guestCookieName;
  }

  signGuestId(holderId: string) {
    return `${holderId}.${this.signatureFor(holderId)}`;
  }

  private readGuestId(cookie: string | undefined) {
    const value = cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${guestCookieName}=`))
      ?.slice(guestCookieName.length + 1);
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

  private publishProjection(session: StoredGameSessionEntity): MafiaGameSessionProjectionEntity {
    this.touch(session);
    session.nextEventId += 1;
    const projection = session.gameSession.projectionFor(
      session.humanParticipantId,
      session.nextEventId,
    );
    session.events.next(projection);
    return projection;
  }

  private sessionForHolder(sessionId: string, cookie: string | undefined) {
    const session = this.sessions.get(sessionId);
    const holderId = this.readGuestId(cookie);
    if (!session || !holderId || session.holderId !== holderId) {
      throw new Error('Game Session is not available to this guest.');
    }

    this.touch(session);
    return session;
  }

  private projectionFor(session: StoredGameSessionEntity): MafiaGameSessionProjectionEntity {
    return session.gameSession.projectionFor(session.humanParticipantId, session.nextEventId);
  }

  private touch(session: StoredGameSessionEntity) {
    session.lastAccessedAt = dayjs();
  }

  private cleanupExpiredSessions() {
    const now = dayjs();
    for (const [sessionId, session] of this.sessions) {
      if (
        session.activeEventSubscribers > 0 ||
        now.diff(session.lastAccessedAt, 'hour', true) < sessionIdleTtlHours
      ) {
        continue;
      }

      session.events.complete();
      this.sessions.delete(sessionId);
      for (const [key, storedSessionId] of this.idempotencyKeys) {
        if (storedSessionId === sessionId) {
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
