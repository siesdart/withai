import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MafiaGameSession, type MafiaAgentSpeechContext } from '@repo/mafia';
import dayjs from 'dayjs';
import RedisMock from 'ioredis-mock';
import { ok } from 'neverthrow';
import { ReplaySubject } from 'rxjs';

import type {
  AgentDecisionGateway,
  AgentFinalDefence,
  AgentPublicSpeechDecision,
} from '../src/game-sessions/agent-decision.gateway';
import { RedisGameSessionAuthority } from '../src/game-sessions/durability/redis-game-session-authority';
import { MafiaGameSessionProjectionEntity } from '../src/game-sessions/entities/mafia-game-session-projection.entity';
import type { StoredGameSessionEntity } from '../src/game-sessions/entities/stored-game-session.entity';
import { GameSessionAgentOrchestrator } from '../src/game-sessions/game-session-agent-orchestrator';
import { nativeGameSessionClock } from '../src/game-sessions/game-session-clock';
import { GameSessionDurability } from '../src/game-sessions/game-session-durability';

class SequencedMafiaTargetGateway implements AgentDecisionGateway {
  private readonly targets = ['participant-3', 'participant-4', 'participant-5'];
  private targetIndex = 0;

  decidePublicSpeech(_context: MafiaAgentSpeechContext): AgentPublicSpeechDecision {
    return { type: 'remain-silent' };
  }

  decideFinalDefence(_context: MafiaAgentSpeechContext): AgentFinalDefence {
    return { opening: 'opening', followUp: 'follow-up' };
  }

  decideMafiaChatOpening(_context: MafiaAgentSpeechContext, targetName: string) {
    return `Opening target: ${targetName}`;
  }

  decideMafiaChatReply(_context: MafiaAgentSpeechContext, targetName: string) {
    return `Reply target: ${targetName}`;
  }

  selectMafiaTarget(_context: MafiaAgentSpeechContext) {
    const target = this.targets[this.targetIndex];
    this.targetIndex += 1;
    return target;
  }

  selectedTargetCount() {
    return this.targetIndex;
  }
}

class CountingPublicSpeechGateway extends SequencedMafiaTargetGateway {
  publicSpeechDecisionCount = 0;

  override decidePublicSpeech(_context: MafiaAgentSpeechContext): AgentPublicSpeechDecision {
    this.publicSpeechDecisionCount += 1;
    return { type: 'speak', content: 'I need more evidence.', delayMs: 500 };
  }
}

const createSession = (): StoredGameSessionEntity => ({
  holderId: 'holder-1',
  humanParticipantId: 'participant-1',
  gameSession: new MafiaGameSession(
    'session-1',
    [
      { id: 'participant-1', name: 'You', alive: true, role: 'Mafia' },
      { id: 'participant-2', name: 'Agent Mafia', alive: true, role: 'Mafia' },
      { id: 'participant-3', name: 'Sora', alive: true, role: 'Citizen' },
      { id: 'participant-4', name: 'Hana', alive: true, role: 'Citizen' },
      { id: 'participant-5', name: 'Iris', alive: true, role: 'Citizen' },
    ],
    {
      discussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
      nightDurationMs: 1_000,
    },
  ),
  events: new ReplaySubject<MafiaGameSessionProjectionEntity>(10),
  nextEventId: 0,
  nextPublicSpeechAt: undefined,
  nextFinalDefenceAt: undefined,
  nextDiscussionTimeAdjustmentAt: undefined,
  lastAccessedAt: dayjs(),
  activeEventSubscribers: 0,
  status: 'in-progress',
  publicSpeechIdempotencyKeys: new Map(),
  mafiaChatIdempotencyKeys: new Map(),
  dayActionIdempotencyKeys: new Map(),
  discussionTimeAdjustmentIdempotencyKeys: new Map(),
  phaseTimer: undefined,
  agentFinalDefenceTimer: undefined,
  publicSpeechAgentTimers: new Set(),
  mafiaTargetFallbackTimer: undefined,
  scheduledAgentPublicSpeeches: [],
  scheduledAgentFinalDefence: undefined,
  scheduledMafiaTargetFallbackAt: undefined,
  reconnectGraceTimer: undefined,
  reconnectGraceDeadline: undefined,
});

const createAgentOnlyMafiaSession = (): StoredGameSessionEntity => ({
  ...createSession(),
  humanParticipantId: 'participant-1',
  gameSession: new MafiaGameSession(
    'session-agent-only-mafia',
    [
      { id: 'participant-1', name: 'You', alive: true, role: 'Citizen' },
      { id: 'participant-2', name: 'Agent Mafia One', alive: true, role: 'Mafia' },
      { id: 'participant-3', name: 'Agent Mafia Two', alive: true, role: 'Mafia' },
      { id: 'participant-4', name: 'Sora', alive: true, role: 'Citizen' },
      { id: 'participant-5', name: 'Hana', alive: true, role: 'Citizen' },
      { id: 'participant-6', name: 'Iris', alive: true, role: 'Citizen' },
      { id: 'participant-7', name: 'Jin', alive: true, role: 'Citizen' },
      { id: 'participant-8', name: 'Noa', alive: true, role: 'Citizen' },
    ],
    {
      discussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
      nightDurationMs: 1_000,
    },
  ),
});

describe('GameSessionAgentOrchestrator', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-08-28T00:00:00.000Z') });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps an Agent Mafia target fixed across Mafia Chat replies', async () => {
    const session = createSession();
    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      async () => ok(new MafiaGameSessionProjectionEntity()),
      async () => undefined,
    );

    orchestrator.submitDayActions(session);
    session.gameSession.submitMafiaChat('participant-1', 'What about Hana?');
    await orchestrator.publishMafiaChatReplies(session);
    session.gameSession.submitMafiaChat('participant-1', 'I disagree.');
    await orchestrator.publishMafiaChatReplies(session);
    jest.runOnlyPendingTimers();

    const projection = session.gameSession.projectionFor('participant-2', 1);
    if (projection.isErr()) throw new Error('Expected an Agent Mafia projection.');

    expect(projection.value.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'mafia-chat',
          message: expect.objectContaining({
            participantId: 'participant-2',
            content: 'Opening target: Sora',
          }),
        }),
        expect.objectContaining({
          type: 'mafia-chat',
          message: expect.objectContaining({
            participantId: 'participant-2',
            content: 'Reply target: Sora',
          }),
        }),
      ]),
    );
    expect(projection.value.timeline).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'mafia-chat',
          message: expect.objectContaining({
            participantId: 'participant-2',
            content: 'Reply target: Hana',
          }),
        }),
      ]),
    );

    const resolution = session.gameSession.advanceDayPhase(new Date('2026-08-28T00:00:01.001Z'));
    expect(resolution).toEqual({ value: { type: 'game-completed', winner: 'Mafia' } });
    expect(session.gameSession.projectionFor('participant-2', 1)).toMatchObject({
      value: {
        public: {
          participants: expect.arrayContaining([
            { id: 'participant-3', name: 'Sora', alive: false },
          ]),
          completedRecords: {
            nightActionRecords: [
              expect.objectContaining({ mafiaTargetParticipantId: 'participant-3' }),
            ],
          },
        },
      },
    });
  });

  it('uses one Agent Mafia coordinator to choose the shared Night target', () => {
    const session = createAgentOnlyMafiaSession();
    const decisions = new SequencedMafiaTargetGateway();
    const orchestrator = new GameSessionAgentOrchestrator(
      decisions,
      async () => ok(new MafiaGameSessionProjectionEntity()),
      async () => undefined,
    );

    orchestrator.submitDayActions(session);

    expect(decisions.selectedTargetCount()).toBe(1);
    for (const participantId of ['participant-2', 'participant-3']) {
      const projection = session.gameSession.projectionFor(participantId, 1);
      if (projection.isErr()) throw new Error('Expected an Agent Mafia projection.');
      expect(projection.value.personal.nightAction).toEqual({
        type: 'mafia-target',
        targetParticipantId: 'participant-3',
      });
    }
  });

  it('does not re-invoke the Agent gateway when a scheduled public reply is cancelled', () => {
    const session = createSession();
    const decisions = new CountingPublicSpeechGateway();
    const orchestrator = new GameSessionAgentOrchestrator(
      decisions,
      async () => ok(new MafiaGameSessionProjectionEntity()),
      async () => undefined,
    );

    orchestrator.publishPublicSpeechReplies(session);
    orchestrator.clearTimers(session);
    jest.advanceTimersByTime(1_000);

    expect(decisions.publicSpeechDecisionCount).toBe(4);
  });

  it('keeps an Agent Final Defence follow-up scheduled after a durable session refresh', async () => {
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis, 'withai:agent-timers');
    const sessions = new Map<string, StoredGameSessionEntity>();
    const session = createSession();
    const initialTime = new Date('2026-08-28T00:00:00.000Z');
    const at = (milliseconds: number) => new Date(initialTime.valueOf() + milliseconds);

    session.gameSession.advanceDayPhase(at(1_001));
    session.gameSession.advanceDayPhase(at(1_003));
    for (const participantId of [
      'participant-1',
      'participant-2',
      'participant-3',
      'participant-4',
      'participant-5',
    ]) {
      session.gameSession.submitNomination(participantId, 'participant-2', at(1_003));
    }
    session.gameSession.advanceDayPhase(at(1_005));

    let orchestrator: GameSessionAgentOrchestrator;
    const durability = new GameSessionDurability(
      () => authority,
      nativeGameSessionClock,
      sessions,
      (replaced) => orchestrator.clearTimers(replaced),
    );
    let committedFollowUps = 0;
    orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      async () => ok(new MafiaGameSessionProjectionEntity()),
      async (_stale, mutate) => {
        const current = sessions.get('session-1');
        if (current && mutate(current)) committedFollowUps += 1;
      },
    );

    jest.setSystemTime(at(1_005));
    orchestrator.submitDayActions(session);
    session.nextEventId = 1;
    const projection = session.gameSession.projectionFor(
      session.humanParticipantId,
      session.nextEventId,
    );
    if (projection.isErr()) throw new Error('Expected a Final Defence projection.');
    const created = await authority.create(
      durability.snapshotFor(session, projection.value),
      { eventId: projection.value.eventId, projection: projection.value },
      session.holderId,
      '2026-08-28',
      10,
      undefined,
    );
    if (created.isErr()) throw new Error('Expected a durable Game Session.');
    sessions.set('session-1', session);

    const hydrated = await durability.hydrate('session-1');
    expect(hydrated.isOk()).toBe(true);
    jest.advanceTimersByTime(1_000);

    expect(committedFollowUps).toBe(1);
    redis.disconnect();
  });
});
