import { MafiaGameSession } from '@repo/mafia';
import dayjs from 'dayjs';
import { err, ok, type Result } from 'neverthrow';
import { ReplaySubject } from 'rxjs';

import {
  type DurableSessionSnapshot,
  RedisGameSessionAuthority,
} from './durability/redis-game-session-authority';
import type { MafiaGameSessionProjectionEntity } from './entities/mafia-game-session-projection.entity';
import {
  scheduledAgentPublicSpeechKey,
  sameScheduledAgentFinalDefence,
  type StoredGameSessionEntity,
} from './entities/stored-game-session.entity';
import type { GameSessionClock } from './game-session-clock';
import type { GameSessionError } from './game-session-error';
import { gameSessionsConfig } from './game-sessions.config';

type SessionDisposer = (session: StoredGameSessionEntity) => void;

export class GameSessionDurability {
  constructor(
    private readonly authorityFor: () => RedisGameSessionAuthority | undefined,
    private readonly clock: GameSessionClock,
    private readonly sessions: Map<string, StoredGameSessionEntity>,
    private readonly disposeSession: SessionDisposer,
  ) {}

  async save(
    session: StoredGameSessionEntity,
    projection: MafiaGameSessionProjectionEntity,
  ): Promise<Result<boolean, GameSessionError>> {
    const authority = this.authorityFor();
    if (!authority) {
      session.events.next(projection);
      return Promise.resolve(ok(true));
    }
    const saved = await authority.save(this.snapshotFor(session, projection), {
      eventId: projection.eventId,
      projection,
    });
    return saved
      .mapErr((): GameSessionError => ({ type: 'durability-unavailable' }))
      .map((wasSaved) => {
        if (wasSaved) session.events.next(projection);
        return wasSaved;
      });
  }

  async saveSnapshot(session: StoredGameSessionEntity): Promise<Result<boolean, GameSessionError>> {
    const authority = this.authorityFor();
    if (!authority) return ok(true);
    const projection = session.gameSession.projectionFor(
      session.humanParticipantId,
      session.nextEventId,
    );
    if (projection.isErr())
      return err({ type: 'invalid-mafia-projection', cause: projection.error });
    const saved = await authority.saveSnapshot(this.snapshotFor(session, projection.value));
    return saved.mapErr((): GameSessionError => ({ type: 'durability-unavailable' }));
  }

  async touch(session: StoredGameSessionEntity): Promise<Result<void, GameSessionError>> {
    const authority = this.authorityFor();
    const now = dayjs(this.clock.now());
    if (!authority) {
      session.lastAccessedAt = now;
      return ok(undefined);
    }
    const touched = await authority.touch(
      session.gameSession.snapshot().sessionId,
      now.toISOString(),
    );
    if (touched.isErr()) return err({ type: 'durability-unavailable' });
    if (!touched.value)
      return err({
        type: 'unavailable-to-guest',
        sessionId: session.gameSession.snapshot().sessionId,
      });
    session.lastAccessedAt = now;
    return ok(undefined);
  }

  async hydrate(sessionId: string): Promise<Result<void, GameSessionError>> {
    const authority = this.authorityFor();
    if (!authority) return ok(undefined);
    const loaded = await authority.load(sessionId);
    if (loaded.isErr()) return err({ type: 'durability-unavailable' });
    if (!loaded.value) return err({ type: 'session-not-found', sessionId });
    const session = this.restore(loaded.value);
    const events = await authority.eventsAfter(sessionId, 0);
    if (events.isErr()) return err({ type: 'durability-unavailable' });
    for (const event of events.value) session.events.next(event.projection);
    this.replace(sessionId, session);
    return ok(undefined);
  }

  snapshotFor(
    session: StoredGameSessionEntity,
    projection: MafiaGameSessionProjectionEntity,
  ): DurableSessionSnapshot {
    return {
      sessionId: projection.sessionId,
      holderId: session.holderId,
      humanParticipantId: session.humanParticipantId,
      gameSession: session.gameSession.snapshot(),
      nextEventId: session.nextEventId,
      phaseDeadline: projection.public.phaseDeadline,
      lastActivityAt: session.lastAccessedAt.toISOString(),
      status: projection.public.phase === 'completed' ? 'completed' : session.status,
      reconnectGraceDeadline: session.reconnectGraceDeadline?.toISOString(),
      cooldowns: {
        publicSpeech: session.nextPublicSpeechAt?.toISOString(),
        finalDefence: session.nextFinalDefenceAt?.toISOString(),
        discussionTimeAdjustment: session.nextDiscussionTimeAdjustmentAt?.toISOString(),
      },
      idempotency: {
        publicSpeech: [...session.publicSpeechIdempotencyKeys],
        mafiaChat: [...session.mafiaChatIdempotencyKeys],
        dayAction: [...session.dayActionIdempotencyKeys],
        discussionTimeAdjustment: [...session.discussionTimeAdjustmentIdempotencyKeys],
      },
      scheduledAgentPublicSpeeches: session.scheduledAgentPublicSpeeches,
      scheduledAgentFinalDefence: session.scheduledAgentFinalDefence,
      scheduledMafiaTargetFallbackAt: session.scheduledMafiaTargetFallbackAt,
      agentActionsPending: session.agentActionsPending,
    };
  }

  restore(snapshot: DurableSessionSnapshot): StoredGameSessionEntity {
    return {
      holderId: snapshot.holderId,
      humanParticipantId: snapshot.humanParticipantId,
      gameSession: MafiaGameSession.restore(snapshot.gameSession, () => this.clock.now()),
      events: new ReplaySubject<MafiaGameSessionProjectionEntity>(
        gameSessionsConfig.eventReplayBufferSize,
      ),
      nextEventId: snapshot.nextEventId,
      nextPublicSpeechAt: snapshot.cooldowns?.publicSpeech
        ? dayjs(snapshot.cooldowns.publicSpeech)
        : undefined,
      nextFinalDefenceAt: snapshot.cooldowns?.finalDefence
        ? dayjs(snapshot.cooldowns.finalDefence)
        : undefined,
      nextDiscussionTimeAdjustmentAt: snapshot.cooldowns?.discussionTimeAdjustment
        ? dayjs(snapshot.cooldowns.discussionTimeAdjustment)
        : undefined,
      lastAccessedAt: dayjs(snapshot.lastActivityAt),
      activeEventSubscribers: 0,
      status: snapshot.status,
      publicSpeechIdempotencyKeys: new Map(snapshot.idempotency?.publicSpeech),
      mafiaChatIdempotencyKeys: new Map(snapshot.idempotency?.mafiaChat),
      dayActionIdempotencyKeys: new Map(snapshot.idempotency?.dayAction),
      discussionTimeAdjustmentIdempotencyKeys: new Map(
        snapshot.idempotency?.discussionTimeAdjustment,
      ),
      phaseTimer: undefined,
      agentFinalDefenceTimer: undefined,
      publicSpeechAgentTimers: new Map(),
      mafiaTargetFallbackTimer: undefined,
      scheduledAgentPublicSpeeches: snapshot.scheduledAgentPublicSpeeches ?? [],
      scheduledAgentFinalDefence: snapshot.scheduledAgentFinalDefence,
      scheduledMafiaTargetFallbackAt: snapshot.scheduledMafiaTargetFallbackAt,
      agentActionsPending: snapshot.agentActionsPending ?? false,
      reconnectGraceTimer: undefined,
      reconnectGraceDeadline: snapshot.reconnectGraceDeadline
        ? dayjs(snapshot.reconnectGraceDeadline)
        : undefined,
    };
  }

  private replace(sessionId: string, next: StoredGameSessionEntity) {
    const previous = this.sessions.get(sessionId);
    if (previous) {
      this.transferPendingAgentTimers(previous, next);
      this.disposeSession(previous);
    }
    this.sessions.set(sessionId, next);
  }

  private transferPendingAgentTimers(
    previous: StoredGameSessionEntity,
    next: StoredGameSessionEntity,
  ) {
    if (
      next.scheduledAgentFinalDefence &&
      previous.scheduledAgentFinalDefence &&
      previous.agentFinalDefenceTimer &&
      sameScheduledAgentFinalDefence(
        previous.scheduledAgentFinalDefence,
        next.scheduledAgentFinalDefence,
      )
    ) {
      next.agentFinalDefenceTimer = previous.agentFinalDefenceTimer;
      previous.agentFinalDefenceTimer = undefined;
    }
    for (const speech of next.scheduledAgentPublicSpeeches) {
      const key = scheduledAgentPublicSpeechKey(speech);
      if (
        !previous.scheduledAgentPublicSpeeches.some(
          (candidate) => scheduledAgentPublicSpeechKey(candidate) === key,
        )
      )
        continue;
      const timer = previous.publicSpeechAgentTimers.get(key);
      if (!timer) continue;
      next.publicSpeechAgentTimers.set(key, timer);
      previous.publicSpeechAgentTimers.delete(key);
    }
    if (
      next.scheduledMafiaTargetFallbackAt &&
      next.scheduledMafiaTargetFallbackAt === previous.scheduledMafiaTargetFallbackAt &&
      previous.mafiaTargetFallbackTimer
    ) {
      next.mafiaTargetFallbackTimer = previous.mafiaTargetFallbackTimer;
      previous.mafiaTargetFallbackTimer = undefined;
    }
  }
}
