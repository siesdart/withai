import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { MafiaGameModule } from '@repo/mafia';
import { filter, type Observable, ReplaySubject } from 'rxjs';

import type { MafiaGameSessionProjectionEntity } from './entities/mafia-game-session-projection.entity';
import type { StoredGameSessionEntity } from './entities/stored-game-session.entity';

const guestCookieName = 'withai_guest';
const guestAllowance = 10;
const dayDiscussionDurationMs = 2 * 60 * 1000;

@Injectable()
export class GameSessionsService {
  private readonly mafiaModule = new MafiaGameModule();
  private readonly sessions = new Map<string, StoredGameSessionEntity>();
  private readonly guestSessionCounts = new Map<string, number>();
  private readonly cookieSecret = this.guestCookieSecret();

  createMafiaSession(cookie: string | undefined, participantCount = 5) {
    const holderId = this.readGuestId(cookie) ?? randomUUID();
    const countKey = `${this.utcDay()}:${holderId}`;
    const count = this.guestSessionCounts.get(countKey) ?? 0;
    if (count >= guestAllowance) {
      throw new HttpException(
        'Your Guest Play Allowance is exhausted for today.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.guestSessionCounts.set(countKey, count + 1);
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
    };
    this.sessions.set(sessionId, session);

    return { holderId, projection: this.publishProjection(session) };
  }

  getProjection(sessionId: string, cookie: string | undefined): MafiaGameSessionProjectionEntity {
    const session = this.sessionForHolder(sessionId, cookie);
    return session.gameSession.projectionFor(session.humanParticipantId, session.nextEventId);
  }

  eventsFor(
    sessionId: string,
    cookie: string | undefined,
    lastEventId: number | undefined,
  ): Observable<MafiaGameSessionProjectionEntity> {
    return this.sessionForHolder(sessionId, cookie)
      .events.asObservable()
      .pipe(filter((projection) => lastEventId === undefined || projection.eventId > lastEventId));
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

    return session;
  }
}
