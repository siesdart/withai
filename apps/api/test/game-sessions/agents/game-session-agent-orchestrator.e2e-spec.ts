import { MafiaGameSessionProjectionEntity } from '@repo/api';
import { MafiaGameSession, type MafiaAgentContext } from '@repo/mafia';
import dayjs from 'dayjs';
import RedisMock from 'ioredis-mock';
import { err, ok } from 'neverthrow';
import { ReplaySubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentDecisionGateway,
  AgentFinalDefence,
  AgentMafiaTargetOptions,
  AgentPhaseActionDecision,
  AgentPublicSpeechDecision,
} from '../../../src/game-sessions/agents/agent-decision.gateway.js';
import { GameSessionAgentOrchestrator } from '../../../src/game-sessions/agents/game-session-agent-orchestrator.js';
import { nativeGameSessionClock } from '../../../src/game-sessions/application/game-session-clock.js';
import { GameSessionDurability } from '../../../src/game-sessions/application/game-session-durability.js';
import { GameSessionLifecycle } from '../../../src/game-sessions/application/game-session-lifecycle.js';
import { gameSessionsConfig } from '../../../src/game-sessions/application/game-sessions.config.js';
import {
  mafiaNightPhaseKey,
  type StoredGameSessionEntity,
  scheduledAgentPublicSpeechKey,
} from '../../../src/game-sessions/application/stored-game-session.entity.js';
import { RedisGameSessionAuthority } from '../../../src/game-sessions/durability/redis-game-session-authority.js';

class SequencedMafiaTargetGateway implements AgentDecisionGateway {
  private readonly targets = ['participant-3', 'participant-4', 'participant-5'];
  private targetIndex = 0;

  decidePublicSpeech(_context: MafiaAgentContext): AgentPublicSpeechDecision {
    return { type: 'remain-silent' };
  }

  decideFinalDefence(_context: MafiaAgentContext): AgentFinalDefence {
    return { opening: 'opening', followUp: 'follow-up' };
  }

  decidePhaseAction(
    _context: MafiaAgentContext,
    _candidateParticipantIds: readonly string[],
  ): AgentPhaseActionDecision | Promise<AgentPhaseActionDecision> {
    return {
      targetParticipantId: 'participant-3',
      verdict: 'eliminate',
    };
  }

  decideMafiaChatOpening(
    _context: MafiaAgentContext,
    targetName: string,
  ): string | Promise<string> {
    return `Opening target: ${targetName}`;
  }

  decideMafiaChatReply(_context: MafiaAgentContext, targetName: string): string | Promise<string> {
    return `Reply target: ${targetName}`;
  }

  selectMafiaTarget(_context: MafiaAgentContext): string | undefined | Promise<string | undefined> {
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

  override decidePublicSpeech(_context: MafiaAgentContext): AgentPublicSpeechDecision {
    this.publicSpeechDecisionCount += 1;
    return { type: 'speak', content: 'I need more evidence.' };
  }
}

class ChangingPublicSpeechGateway extends SequencedMafiaTargetGateway {
  private decisionCount = 0;

  override decidePublicSpeech(_context: MafiaAgentContext): AgentPublicSpeechDecision {
    this.decisionCount += 1;
    return {
      type: 'speak',
      content:
        this.decisionCount === 1
          ? 'This draft belongs to the old conversation.'
          : 'This reply addresses the changed conversation.',
    };
  }
}

class CountingVerdictGateway extends SequencedMafiaTargetGateway {
  phaseActionDecisionCount = 0;

  override decidePhaseAction(
    context: MafiaAgentContext,
    candidateParticipantIds: readonly string[],
  ): AgentPhaseActionDecision | Promise<AgentPhaseActionDecision> {
    this.phaseActionDecisionCount += 1;
    return super.decidePhaseAction(context, candidateParticipantIds);
  }
}

class SilentThenSpeakingGateway extends SequencedMafiaTargetGateway {
  publicSpeechDecisionCount = 0;

  override decidePublicSpeech(_context: MafiaAgentContext): AgentPublicSpeechDecision {
    this.publicSpeechDecisionCount += 1;
    return this.publicSpeechDecisionCount === 1
      ? { type: 'remain-silent' }
      : { type: 'speak', content: 'I can add one point.' };
  }
}

class NightActionGateway extends SequencedMafiaTargetGateway {
  readonly mafiaOpeningRoles: string[] = [];
  readonly phaseActionRoles: string[] = [];
  readonly phaseActionCandidates = new Map<string, readonly string[]>();
  readonly mafiaTargetRoles: string[] = [];

  override decidePhaseAction(
    context: MafiaAgentContext,
    candidateParticipantIds: readonly string[],
  ): AgentPhaseActionDecision | Promise<AgentPhaseActionDecision> {
    this.phaseActionRoles.push(context.personal.role);
    this.phaseActionCandidates.set(context.personal.role, candidateParticipantIds);
    return {
      targetParticipantId: candidateParticipantIds[0],
    };
  }

  override selectMafiaTarget(
    context: MafiaAgentContext,
  ): string | undefined | Promise<string | undefined> {
    this.mafiaTargetRoles.push(context.personal.role);
    return context.public.participants[0]?.id;
  }

  override decideMafiaChatOpening(
    context: MafiaAgentContext,
    targetName: string,
  ): string | Promise<string> {
    this.mafiaOpeningRoles.push(context.personal.role);
    return super.decideMafiaChatOpening(context, targetName);
  }
}

class DeferredDoctorNightActionGateway extends NightActionGateway {
  private markDoctorActionStarted: (() => void) | undefined;
  private resolveDoctorAction: (() => void) | undefined;
  readonly doctorActionStarted = new Promise<void>((resolve) => {
    this.markDoctorActionStarted = resolve;
  });

  override decidePhaseAction(
    context: MafiaAgentContext,
    candidateParticipantIds: readonly string[],
  ): AgentPhaseActionDecision | Promise<AgentPhaseActionDecision> {
    if (context.personal.role !== 'Doctor')
      return super.decidePhaseAction(context, candidateParticipantIds);
    this.markDoctorActionStarted?.();
    return new Promise((resolve) => {
      this.resolveDoctorAction = () =>
        resolve({
          targetParticipantId: candidateParticipantIds[0],
        });
    });
  }

  releaseDoctorAction() {
    this.resolveDoctorAction?.();
  }
}

class DeferredMafiaOpeningGateway extends NightActionGateway {
  private markOpeningStarted: (() => void) | undefined;
  private resolveOpening: ((content: string) => void) | undefined;
  readonly openingStarted = new Promise<void>((resolve) => {
    this.markOpeningStarted = resolve;
  });

  override decideMafiaChatOpening(_context: MafiaAgentContext, _targetName: string) {
    this.markOpeningStarted?.();
    return new Promise<string>((resolve) => {
      this.resolveOpening = resolve;
    });
  }

  releaseOpening(content = 'We should target the same player.') {
    this.resolveOpening?.(content);
  }
}

class ParallelMafiaChatGateway extends SequencedMafiaTargetGateway {
  readonly openingParticipantIds: string[] = [];
  readonly replyParticipantIds: string[] = [];
  private openingReleases: ((content: string) => void)[] = [];
  private replyReleases: ((content: string) => void)[] = [];
  private openingsReleased = false;
  private repliesReleased = false;

  override decideMafiaChatOpening(context: MafiaAgentContext, _targetName: string) {
    this.openingParticipantIds.push(context.participant.id);
    return new Promise<string>((resolve) => {
      this.openingReleases.push(resolve);
      if (this.openingsReleased) resolve(`Opening from ${context.participant.id}`);
    });
  }

  override decideMafiaChatReply(context: MafiaAgentContext, _targetName: string) {
    this.replyParticipantIds.push(context.participant.id);
    return new Promise<string>((resolve) => {
      this.replyReleases.push(resolve);
      if (this.repliesReleased) resolve(`Reply from ${context.participant.id}`);
    });
  }

  releaseOpenings() {
    this.openingsReleased = true;
    for (const [index, release] of this.openingReleases.entries()) release(`Opening ${index + 1}`);
  }

  releaseReplies() {
    this.repliesReleased = true;
    for (const [index, release] of this.replyReleases.entries()) release(`Reply ${index + 1}`);
  }
}

class DeferredMafiaTargetGateway extends SequencedMafiaTargetGateway {
  private markTargetSelectionStarted: (() => void) | undefined;
  private resolveTargetSelection: ((targetParticipantId: string | undefined) => void) | undefined;
  private selections = 0;
  readonly abortSignals: AbortSignal[] = [];
  readonly targetSelectionStarted = new Promise<void>((resolve) => {
    this.markTargetSelectionStarted = resolve;
  });

  override selectMafiaTarget(
    _context: MafiaAgentContext,
    options?: AgentMafiaTargetOptions,
  ): string | Promise<string | undefined> {
    this.selections += 1;
    if (options?.abortController) this.abortSignals.push(options.abortController.signal);
    this.markTargetSelectionStarted?.();
    return new Promise<string | undefined>((resolve) => {
      this.resolveTargetSelection = resolve;
    });
  }

  releaseTargetSelection(targetParticipantId: string | undefined = 'participant-3') {
    this.resolveTargetSelection?.(targetParticipantId);
  }

  selectedTargetCount() {
    return this.selections;
  }
}

class LatePrimaryMafiaTargetGateway extends NightActionGateway {
  private markPrimaryStarted: (() => void) | undefined;
  private releasePrimary: ((targetParticipantId: string) => void) | undefined;
  private selections = 0;
  readonly primaryStarted = new Promise<void>((resolve) => {
    this.markPrimaryStarted = resolve;
  });

  override selectMafiaTarget(
    _context: MafiaAgentContext,
  ): string | undefined | Promise<string | undefined> {
    this.selections += 1;
    if (this.selections > 1) return 'participant-3';
    this.markPrimaryStarted?.();
    return new Promise<string>((resolve) => {
      this.releasePrimary = resolve;
    });
  }

  releasePrimaryTarget(targetParticipantId = 'participant-4') {
    this.releasePrimary?.(targetParticipantId);
  }

  targetSelectionCount() {
    return this.selections;
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
  agentMinds: {},
  events: new ReplaySubject<MafiaGameSessionProjectionEntity>(10),
  nextEventId: 0,
  snapshotRevision: 0,
  nextPublicSpeechAt: undefined,
  nextFinalDefenceAt: undefined,
  nextDiscussionTimeAdjustmentAt: undefined,
  lastAccessedAt: dayjs(),
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
  agentActionsPending: false,
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
      nightDurationMs: 20_000,
    },
  ),
});

const createNightActionSession = (nightDurationMs = 1_000): StoredGameSessionEntity => ({
  ...createSession(),
  humanParticipantId: 'participant-1',
  gameSession: new MafiaGameSession(
    'session-night-actions',
    [
      { id: 'participant-1', name: 'You', alive: true, role: 'Citizen' },
      { id: 'participant-2', name: 'Agent Mafia', alive: true, role: 'Mafia' },
      { id: 'participant-3', name: 'Agent Doctor', alive: true, role: 'Doctor' },
      { id: 'participant-4', name: 'Agent Police', alive: true, role: 'Police' },
      { id: 'participant-5', name: 'Agent Citizen', alive: true, role: 'Citizen' },
    ],
    {
      discussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
      nightDurationMs,
    },
  ),
});

describe('GameSessionAgentOrchestrator', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-08-28T00:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits Mafia Chat replies with the held mutation lock state', async () => {
    const session = createSession();
    session.scheduledAgentMafiaChatReplies = [
      {
        id: 'reply-1',
        participantId: 'participant-2',
        content: 'I will commit my action.',
        dueAt: '2026-08-28T00:00:00.000Z',
        phaseKey: mafiaNightPhaseKey(session.gameSession.snapshot()),
      },
    ];
    const commitAgentMutation = vi.fn(
      async (
        _stale: StoredGameSessionEntity,
        mutate: (current: StoredGameSessionEntity) => boolean,
      ) => {
        mutate(session);
        return ok(undefined);
      },
    );
    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      commitAgentMutation,
    );

    await orchestrator.publishMafiaChatReplies(session, true);

    expect(commitAgentMutation).toHaveBeenCalledTimes(1);
    expect(session.scheduledAgentMafiaChatReplies).toEqual([]);
  });

  it('keeps an Agent Mafia target fixed across Mafia Chat replies', async () => {
    const session = createSession();
    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      async (_stale, mutate) => {
        mutate(session);
        return ok(undefined);
      },
    );

    await orchestrator.submitDayActions(session);
    session.gameSession.submitMafiaChat('participant-1', 'What about Hana?');
    await orchestrator.prepareMafiaChatReplies(session);
    orchestrator.resumeScheduledTasks(session);
    session.gameSession.submitMafiaChat('participant-1', 'I disagree.');
    await orchestrator.prepareMafiaChatReplies(session);
    orchestrator.resumeScheduledTasks(session);
    expect(session.scheduledAgentMafiaChatReplies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: 'participant-2',
          content: 'Reply target: Sora',
        }),
      ]),
    );
    expect(session.scheduledAgentMafiaChatReplies).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: 'participant-2',
          content: 'Reply target: Hana',
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

  it('uses one Agent Mafia coordinator to choose the shared Night target', async () => {
    const session = createAgentOnlyMafiaSession();
    const decisions = new SequencedMafiaTargetGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async (_stale, mutate) => {
      mutate(session);
      return ok(undefined);
    });

    await orchestrator.submitDayActions(session);

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

  it('commits an Agent Mafia target to the current session after rehydration', async () => {
    const staleSession = createSession();
    const currentSession = createSession();
    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      async (_stale, mutate) => {
        mutate(currentSession);
        return ok(undefined);
      },
      undefined,
      () => currentSession,
    );

    await orchestrator.submitDayActions(staleSession);

    expect(currentSession.gameSession.snapshot().mafiaTargetParticipantId).toBe('participant-3');
  });

  it('commits Agent Police and Doctor actions to the current session after rehydration', async () => {
    const staleSession = createNightActionSession();
    const currentSession = createNightActionSession();
    const orchestrator = new GameSessionAgentOrchestrator(
      new NightActionGateway(),
      async (_stale, mutate) => {
        mutate(currentSession);
        return ok(undefined);
      },
      undefined,
      () => currentSession,
    );

    await orchestrator.submitDayActions(staleSession);

    const snapshot = currentSession.gameSession.snapshot();
    expect(snapshot.doctorProtections).toContainEqual(['participant-3', 'participant-1']);
    expect(snapshot.policeInvestigations).toContainEqual(['participant-4', 'participant-1']);
  });

  it('uses a deterministic fallback for a recovered overdue Mafia target without calling the LLM', async () => {
    const session = createSession();
    const decisions = new SequencedMafiaTargetGateway();
    let persistedMafiaTargetParticipantId: string | undefined;
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async (_stale, mutate) => {
      mutate(session);
      persistedMafiaTargetParticipantId = session.gameSession.snapshot().mafiaTargetParticipantId;
      return ok(undefined);
    });
    session.scheduledMafiaTargetFallbackAt = '2026-08-28T00:00:00.000Z';
    session.scheduledMafiaTargetFallbackPhaseKey = mafiaNightPhaseKey(
      session.gameSession.snapshot(),
    );

    await expect(orchestrator.drainDueScheduledTasks(session)).resolves.toEqual(ok(undefined));

    expect(decisions.selectedTargetCount()).toBe(0);
    expect(persistedMafiaTargetParticipantId).toBeDefined();
    expect(session.gameSession.snapshot().mafiaTargetParticipantId).toBeDefined();
  });

  it('coalesces timer and recovery drains for one Mafia target fallback', async () => {
    const session = createNightActionSession();
    let markCommitStarted: (() => void) | undefined;
    let releaseCommit: (() => void) | undefined;
    const commitStarted = new Promise<void>((resolve) => {
      markCommitStarted = resolve;
    });
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const commitAgentMutation = vi.fn(
      async (
        _stale: StoredGameSessionEntity,
        mutate: (current: StoredGameSessionEntity) => boolean,
      ) => {
        markCommitStarted?.();
        await commitGate;
        mutate(session);
        return ok(undefined);
      },
    );
    const decisions = new SequencedMafiaTargetGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, commitAgentMutation);
    session.scheduledMafiaTargetFallbackAt = '2026-08-28T00:00:00.000Z';
    session.scheduledMafiaTargetFallbackPhaseKey = mafiaNightPhaseKey(
      session.gameSession.snapshot(),
    );
    orchestrator.resumeScheduledTasks(session);

    await vi.advanceTimersByTimeAsync(0);
    await commitStarted;
    const drain = orchestrator.drainDueScheduledTasks(session);

    expect(commitAgentMutation).toHaveBeenCalledOnce();
    releaseCommit?.();
    await expect(drain).resolves.toEqual(ok(undefined));

    expect(commitAgentMutation).toHaveBeenCalledOnce();
    expect(decisions.selectedTargetCount()).toBe(0);
    expect(session.gameSession.snapshot().mafiaTargetParticipantId).toBeDefined();
  });

  it('commits a deterministic legal target when the primary Mafia target request stalls', async () => {
    const session = createNightActionSession();
    const decisions = new DeferredMafiaTargetGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async (_stale, mutate) => {
      mutate(session);
      return ok(undefined);
    });
    const submission = orchestrator.submitDayActions(session);

    await decisions.targetSelectionStarted;
    await vi.advanceTimersByTimeAsync(0);

    const fallbackTarget = session.gameSession.snapshot().mafiaTargetParticipantId;
    expect(fallbackTarget).toBeDefined();
    expect(fallbackTarget).not.toBe(session.humanParticipantId);
    expect(session.gameSession.snapshot().participants).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: fallbackTarget, alive: true })]),
    );
    expect(decisions.selectedTargetCount()).toBe(1);
    expect(decisions.abortSignals[0]?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(submission).resolves.toBeUndefined();
    const transition = session.gameSession.advanceDayPhase(
      new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1),
    );
    expect(transition.isOk()).toBe(true);
    expect(session.gameSession.snapshot().phase).not.toBe('night');
    expect(session.gameSession.snapshot().mafiaTargetParticipantId).toBe(fallbackTarget);
  });

  it('does not let a late primary result overwrite the deterministic fallback', async () => {
    const session = createNightActionSession();
    const decisions = new LatePrimaryMafiaTargetGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async (_stale, mutate) => {
      mutate(session);
      return ok(undefined);
    });
    const submission = orchestrator.submitDayActions(session);

    await decisions.primaryStarted;
    await vi.advanceTimersByTimeAsync(0);
    const fallbackTarget = session.gameSession.snapshot().mafiaTargetParticipantId;
    expect(fallbackTarget).toBeDefined();

    decisions.releasePrimaryTarget('participant-4');
    await vi.advanceTimersByTimeAsync(1_000);
    await submission;

    expect(decisions.targetSelectionCount()).toBe(1);
    expect(session.gameSession.snapshot().mafiaTargetParticipantId).toBe(fallbackTarget);
  });

  it('records an Agent nomination that returns after the nomination countdown', async () => {
    const session = createSession();
    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      async (_stale, mutate) => {
        mutate(session);
        return ok(undefined);
      },
    );
    const nightEnd = new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1);
    session.gameSession.advanceDayPhase(nightEnd);
    const nominationStart = new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1);
    session.gameSession.advanceDayPhase(nominationStart);
    vi.setSystemTime(new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1_000));

    await orchestrator.submitDayActions(session);

    expect(session.gameSession.snapshot().nominations).toContainEqual([
      'participant-2',
      'participant-3',
    ]);
  });

  it('commits an Agent nomination to the latest hydrated session', async () => {
    const staleSession = createSession();
    const currentSession = createSession();
    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      async (_stale, mutate) => {
        mutate(currentSession);
        return ok(undefined);
      },
      undefined,
      () => currentSession,
    );
    const nightEnd = new Date(Date.parse(staleSession.gameSession.snapshot().phaseDeadline) + 1);
    staleSession.gameSession.advanceDayPhase(nightEnd);
    const nominationStart = new Date(
      Date.parse(staleSession.gameSession.snapshot().phaseDeadline) + 1,
    );
    staleSession.gameSession.advanceDayPhase(nominationStart);
    currentSession.gameSession.advanceDayPhase(nightEnd);
    currentSession.gameSession.advanceDayPhase(nominationStart);

    await orchestrator.submitDayActions(staleSession);

    expect(currentSession.gameSession.snapshot().nominations).toContainEqual([
      'participant-2',
      'participant-3',
    ]);
  });

  it('records an Agent verdict that returns after the verdict countdown', async () => {
    const session = createSession();
    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      async (_stale, mutate) => {
        mutate(session);
        return ok(undefined);
      },
    );
    const nightEnd = new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1);
    session.gameSession.advanceDayPhase(nightEnd);
    const nominationStart = new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1);
    session.gameSession.advanceDayPhase(nominationStart);
    const nominationEnd = new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1);
    session.gameSession.submitNomination('participant-1', 'participant-3', nominationStart);
    session.gameSession.submitNomination('participant-2', 'participant-3', nominationStart);
    session.gameSession.advanceDayPhase(nominationEnd);
    const verdictStart = new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1);
    session.gameSession.advanceDayPhase(verdictStart);
    vi.setSystemTime(new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1_000));

    await orchestrator.submitDayActions(session);

    expect(session.gameSession.snapshot().verdicts).toContainEqual(['participant-2', 'eliminate']);
  });

  it('coalesces concurrent verdict requests for the same phase', async () => {
    const session = createSession();
    for (const participantId of [
      'participant-2',
      'participant-3',
      'participant-4',
      'participant-5',
    ]) {
      session.agentMinds[participantId] = {
        persona: `${participantId} is a test Agent.`,
        memory: {
          revision: 0,
          allegianceEstimates: [],
          strategy: 'Use current evidence and allegiance estimates to make the next legal move.',
        },
      };
    }
    const decisions = new CountingVerdictGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async (_stale, mutate) => {
      mutate(session);
      return ok(undefined);
    });
    const nightEnd = new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1);
    session.gameSession.advanceDayPhase(nightEnd);
    const nominationStart = new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1);
    session.gameSession.advanceDayPhase(nominationStart);
    const nominationEnd = new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1);
    session.gameSession.submitNomination('participant-1', 'participant-3', nominationStart);
    session.gameSession.submitNomination('participant-2', 'participant-3', nominationStart);
    session.gameSession.advanceDayPhase(nominationEnd);
    const verdictStart = new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1);
    session.gameSession.advanceDayPhase(verdictStart);

    await Promise.all([
      orchestrator.submitDayActions(session),
      orchestrator.submitDayActions(session),
    ]);
    await orchestrator.submitDayActions(session);

    expect(decisions.phaseActionDecisionCount).toBe(4);
  });

  it('requests Night actions from Mafia, Doctor, and Police, but never a Citizen', async () => {
    const session = createNightActionSession();
    const decisions = new NightActionGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async (_stale, mutate) => {
      mutate(session);
      return ok(undefined);
    });

    await orchestrator.submitDayActions(session);

    expect(decisions.mafiaTargetRoles).toEqual(['Mafia']);
    expect(decisions.mafiaOpeningRoles).toEqual(['Mafia']);
    expect(decisions.phaseActionRoles).toEqual(['Doctor', 'Police']);
    expect(decisions.phaseActionCandidates.get('Doctor')).toContain('participant-3');
    expect(decisions.phaseActionCandidates.get('Police')).not.toContain('participant-4');
    for (const participantId of ['participant-2', 'participant-3', 'participant-4']) {
      const projection = session.gameSession.projectionFor(participantId, 1);
      if (projection.isErr()) throw new Error('Expected an actionable Agent projection.');
      expect(projection.value.personal.nightAction).toBeDefined();
    }
    const citizenProjection = session.gameSession.projectionFor('participant-5', 1);
    if (citizenProjection.isErr()) throw new Error('Expected an Agent Citizen projection.');
    expect(citizenProjection.value.personal.nightAction).toBeUndefined();
  });

  it('does not re-request submitted Night actions when the Night entry is replayed', async () => {
    const session = createNightActionSession();
    const decisions = new NightActionGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async (_stale, mutate) => {
      mutate(session);
      return ok(undefined);
    });

    await Promise.all([
      orchestrator.submitDayActions(session),
      orchestrator.submitDayActions(session),
    ]);
    await orchestrator.submitDayActions(session);

    expect(decisions.mafiaTargetRoles).toEqual(['Mafia']);
    expect(decisions.phaseActionRoles).toEqual(['Doctor', 'Police']);
  });

  it('starts Mafia and Police requests even while the Doctor request is pending', async () => {
    const session = createNightActionSession();
    const decisions = new DeferredDoctorNightActionGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async () => ok(undefined));
    const submission = orchestrator.submitDayActions(session);

    await decisions.doctorActionStarted;
    await Promise.resolve();
    await Promise.resolve();
    try {
      expect(decisions.mafiaTargetRoles).toEqual(['Mafia']);
      expect(decisions.phaseActionRoles).toEqual(['Police']);
    } finally {
      decisions.releaseDoctorAction();
      await submission;
    }
  });

  it('arms the Mafia target fallback while required Night decisions are still pending', async () => {
    const session = createNightActionSession();
    const decisions = new DeferredDoctorNightActionGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async (_stale, mutate) => {
      mutate(session);
      return ok(undefined);
    });
    const submission = orchestrator.submitDayActions(session);

    await decisions.doctorActionStarted;

    expect(session.scheduledMafiaTargetFallbackAt).toBe(
      dayjs(session.gameSession.snapshot().phaseDeadline).subtract(1, 'second').toISOString(),
    );
    expect(session.scheduledMafiaTargetFallbackPhaseKey).toBe(
      mafiaNightPhaseKey(session.gameSession.snapshot()),
    );
    decisions.releaseDoctorAction();
    await submission;
  });

  it('does not let an unfinished Doctor decision hold the Night barrier past its deadline', async () => {
    const session = createNightActionSession();
    const decisions = new DeferredDoctorNightActionGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async (_stale, mutate) => {
      mutate(session);
      return ok(undefined);
    });
    const submission = orchestrator.submitDayActions(session);
    await decisions.doctorActionStarted;

    const remainingMs = Math.max(
      0,
      Date.parse(session.gameSession.snapshot().phaseDeadline) - Date.now(),
    );
    await vi.advanceTimersByTimeAsync(remainingMs);
    await expect(submission).resolves.toBeUndefined();
    decisions.releaseDoctorAction();
  });

  it('preserves a fast Mafia target when hydration replaces the session before the Doctor finishes', async () => {
    const staleSession = createNightActionSession(20_000);
    let authoritativeSession = staleSession;
    let persistedSnapshot = staleSession.gameSession.snapshot();
    const decisions = new DeferredDoctorNightActionGateway();
    const orchestrator = new GameSessionAgentOrchestrator(
      decisions,
      async (_stale, mutate) => {
        if (mutate(authoritativeSession))
          persistedSnapshot = authoritativeSession.gameSession.snapshot();
        return ok(undefined);
      },
      undefined,
      () => authoritativeSession,
    );
    const submission = orchestrator.submitDayActions(staleSession);

    await decisions.doctorActionStarted;
    await vi.waitFor(() =>
      expect(staleSession.gameSession.snapshot().mafiaTargetParticipantId).toBe('participant-1'),
    );
    authoritativeSession = {
      ...staleSession,
      gameSession: MafiaGameSession.restore(persistedSnapshot),
    };
    decisions.releaseDoctorAction();
    await submission;

    expect(authoritativeSession.gameSession.snapshot().mafiaTargetParticipantId).toBe(
      'participant-1',
    );
    expect(
      authoritativeSession.gameSession.projectionFor('participant-3', 1).match(
        (projection) => projection.personal.nightAction,
        () => undefined,
      ),
    ).toEqual({ type: 'doctor-protection', targetParticipantId: 'participant-1' });
  });

  it('commits a Mafia opening to the latest session when hydration occurs during generation', async () => {
    const staleSession = createNightActionSession();
    let authoritativeSession = staleSession;
    let persistedSnapshot = staleSession.gameSession.snapshot();
    const decisions = new DeferredMafiaOpeningGateway();
    const orchestrator = new GameSessionAgentOrchestrator(
      decisions,
      async (_stale, mutate) => {
        if (mutate(authoritativeSession))
          persistedSnapshot = authoritativeSession.gameSession.snapshot();
        return ok(undefined);
      },
      undefined,
      () => authoritativeSession,
    );
    const submission = orchestrator.submitDayActions(staleSession);

    await decisions.openingStarted;
    authoritativeSession = {
      ...staleSession,
      gameSession: MafiaGameSession.restore(persistedSnapshot),
    };
    decisions.releaseOpening();
    await submission;
    await vi.advanceTimersByTimeAsync(0);

    expect(authoritativeSession.gameSession.snapshot().timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'mafia-chat',
          message: expect.objectContaining({ content: 'We should target the same player.' }),
        }),
      ]),
    );
  });

  it('lets required Night actions finish while Mafia opening generation is still pending', async () => {
    const session = createNightActionSession();
    const decisions = new DeferredMafiaOpeningGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async (_stale, mutate) => {
      mutate(session);
      return ok(undefined);
    });
    const submission = orchestrator.submitDayActions(session);

    await decisions.openingStarted;
    await expect(submission).resolves.toBeUndefined();
    decisions.releaseOpening();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('starts all independent Mafia opening decisions before any one finishes', async () => {
    const session = createAgentOnlyMafiaSession();
    const decisions = new ParallelMafiaChatGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async (_stale, mutate) => {
      mutate(session);
      return ok(undefined);
    });
    const submission = orchestrator.submitDayActions(session);

    await vi
      .waitFor(() => expect(decisions.openingParticipantIds).toHaveLength(2), { timeout: 100 })
      .catch(() => undefined);
    const startedParticipantIds = [...decisions.openingParticipantIds];
    decisions.releaseOpenings();
    await submission;
    await vi.advanceTimersByTimeAsync(0);
    expect(startedParticipantIds).toEqual(['participant-2', 'participant-3']);
  });

  it('starts all independent Mafia reply decisions before any one finishes', async () => {
    const session = createAgentOnlyMafiaSession();
    session.gameSession.submitMafiaTarget('participant-2', 'participant-4');
    const decisions = new ParallelMafiaChatGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async (_stale, mutate) => {
      mutate(session);
      return ok(undefined);
    });
    const replies = orchestrator.mafiaChatRepliesFor(session);

    await vi
      .waitFor(() => expect(decisions.replyParticipantIds).toHaveLength(2), { timeout: 100 })
      .catch(() => undefined);
    const startedParticipantIds = [...decisions.replyParticipantIds];
    decisions.releaseReplies();
    await expect(replies).resolves.toHaveLength(2);
    expect(startedParticipantIds).toEqual(['participant-2', 'participant-3']);
  });

  it('does not request public-speech decisions during Night', async () => {
    const session = createSession();
    const decisions = new CountingPublicSpeechGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async () => ok(undefined));

    await orchestrator.publishPublicSpeechReplies(session);
    expect(decisions.publicSpeechDecisionCount).toBe(0);
  });

  it('does not re-invoke the Agent gateway when a scheduled public reply is cancelled', async () => {
    const session = createSession();
    const decisions = new CountingPublicSpeechGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async () => ok(undefined));
    while (session.gameSession.snapshot().phase !== 'discussion') {
      session.gameSession.advanceDayPhase(
        new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
      );
    }

    await orchestrator.publishPublicSpeechReplies(session);
    orchestrator.clearTimers(session);
    vi.advanceTimersByTime(1_000);

    expect(decisions.publicSpeechDecisionCount).toBe(1);
  });

  it('lets every Agent reconsider only after the public snapshot changes', async () => {
    const session = createSession();
    const decisions = new CountingPublicSpeechGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async () => ok(undefined));

    while (session.gameSession.snapshot().phase !== 'discussion') {
      session.gameSession.advanceDayPhase(
        new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
      );
    }
    await orchestrator.publishPublicSpeechReplies(session);
    await orchestrator.publishPublicSpeechReplies(session);
    expect(decisions.publicSpeechDecisionCount).toBe(1);

    session.gameSession.submitPublicSpeech('participant-1', 'I want to compare the evidence.');

    await orchestrator.publishPublicSpeechReplies(session);
    expect(decisions.publicSpeechDecisionCount).toBe(2);
  });

  it('tries one shuffled Agent at a time until one chooses to speak', async () => {
    const session = createSession();
    const decisions = new SilentThenSpeakingGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async () => ok(undefined));

    while (session.gameSession.snapshot().phase !== 'discussion') {
      session.gameSession.advanceDayPhase(
        new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
      );
    }

    await orchestrator.publishPublicSpeechReplies(session);
    expect(session.scheduledAgentPublicSpeeches).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: 'I can add one point.' })]),
    );
    expect(decisions.publicSpeechDecisionCount).toBe(2);
  });

  it('stops scheduling autonomous public speeches when the discussion turn budget is spent', async () => {
    const session = createSession();
    const decisions = new CountingPublicSpeechGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async () => ok(undefined));

    while (session.gameSession.snapshot().phase !== 'discussion') {
      session.gameSession.advanceDayPhase(
        new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
      );
    }
    session.autonomousPublicSpeechTurns =
      gameSessionsConfig.maximumAutonomousPublicSpeechTurnsPerDiscussion;

    await orchestrator.publishPublicSpeechReplies(session);
    expect(decisions.publicSpeechDecisionCount).toBe(0);
  });

  it('records the spent discussion turn budget for the Human Player only once', async () => {
    const session = createSession();
    const decisions = new CountingPublicSpeechGateway();
    const orchestrator = new GameSessionAgentOrchestrator(decisions, async (_stale, mutate) => {
      mutate(session);
      return ok(undefined);
    });

    while (session.gameSession.snapshot().phase !== 'discussion') {
      session.gameSession.advanceDayPhase(
        new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
      );
    }
    session.autonomousPublicSpeechTurns =
      gameSessionsConfig.maximumAutonomousPublicSpeechTurnsPerDiscussion;

    await orchestrator.publishPublicSpeechReplies(session);
    await orchestrator.publishPublicSpeechReplies(session);

    expect(decisions.publicSpeechDecisionCount).toBe(0);
    expect(
      session.gameSession
        .projectionFor(session.humanParticipantId, 1)
        .map((projection) => projection.timeline),
    ).toEqual({
      value: expect.arrayContaining([
        expect.objectContaining({
          type: 'personal-record',
          recipientParticipantId: session.humanParticipantId,
          outcome: { type: 'autonomous-public-speech-limit-reached', dayNumber: 1 },
        }),
      ]),
    });
    expect(
      session.gameSession
        .projectionFor('participant-2', 1)
        .map((projection) => projection.timeline),
    ).toEqual({
      value: expect.not.arrayContaining([expect.objectContaining({ type: 'personal-record' })]),
    });
  });

  it('removes fired public-speech timer handles before committing', async () => {
    const session = createSession();
    const timerCountsAtCommit: number[] = [];
    const orchestrator = new GameSessionAgentOrchestrator(
      new CountingPublicSpeechGateway(),
      async (_stale, mutate) => {
        timerCountsAtCommit.push(session.publicSpeechAgentTimers.size);
        mutate(session);
        return ok(undefined);
      },
    );

    while (session.gameSession.snapshot().phase !== 'discussion') {
      session.gameSession.advanceDayPhase(
        new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
      );
    }
    await orchestrator.publishPublicSpeechReplies(session);
    expect(timerCountsAtCommit).toEqual([]);
    expect(session.autonomousPublicSpeechTurns).toBe(0);
    expect(session.publicSpeechAgentTimers.size).toBe(1);
    expect(session.scheduledAgentPublicSpeeches[0]).toEqual(
      expect.objectContaining({ content: 'I need more evidence.' }),
    );
  });

  it('does not commit a delayed Agent speech after the public conversation changes', async () => {
    const session = createSession();
    session.gameSession = new MafiaGameSession(
      'session-stale-public-speech',
      [
        { id: 'participant-1', name: 'You', alive: true, role: 'Mafia' },
        { id: 'participant-2', name: 'Agent Mafia', alive: true, role: 'Mafia' },
        { id: 'participant-3', name: 'Sora', alive: true, role: 'Citizen' },
        { id: 'participant-4', name: 'Hana', alive: true, role: 'Citizen' },
        { id: 'participant-5', name: 'Iris', alive: true, role: 'Citizen' },
      ],
      {
        discussionDurationMs: 30_000,
        nominationDurationMs: 1,
        finalDefenceDurationMs: 1,
        verdictDurationMs: 1,
        nightDurationMs: 1_000,
      },
    );
    const orchestrator = new GameSessionAgentOrchestrator(
      new ChangingPublicSpeechGateway(),
      async (_stale, mutate) => {
        mutate(session);
        return ok(undefined);
      },
    );
    while (session.gameSession.snapshot().phase !== 'discussion') {
      session.gameSession.advanceDayPhase(
        new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
      );
    }

    await orchestrator.publishPublicSpeechReplies(session);
    session.gameSession.submitPublicSpeech(
      session.humanParticipantId,
      'I changed the conversation while the Agent was typing.',
    );
    await orchestrator.publishPublicSpeechReplies(session);
    await vi.advanceTimersByTimeAsync(10_000);

    const projection = session.gameSession.projectionFor(session.humanParticipantId, 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');
    expect(projection.value.timeline).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'chat',
          message: expect.objectContaining({
            content: 'This draft belongs to the old conversation.',
          }),
        }),
      ]),
    );
    expect(projection.value.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'chat',
          message: expect.objectContaining({
            content: 'This reply addresses the changed conversation.',
          }),
        }),
      ]),
    );
  });

  it('drains overdue public speeches by due time and snapshot order', async () => {
    const session = createSession();
    const committedContents: string[] = [];
    const heldMutationLocks: boolean[] = [];
    const commitAgentMutation = vi.fn(
      async (
        _stale: StoredGameSessionEntity,
        mutate: (current: StoredGameSessionEntity) => boolean,
        _schedulePhaseTransition?: boolean,
        hydrationLocked?: boolean,
      ) => {
        const next = session.scheduledAgentPublicSpeeches[0];
        if (next) committedContents.push(next.content);
        heldMutationLocks.push(hydrationLocked ?? false);
        mutate(session);
        return ok(undefined);
      },
    );
    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      commitAgentMutation,
    );
    session.scheduledAgentPublicSpeeches = [
      { participantId: 'participant-2', content: 'first tie', dueAt: '2026-08-28T00:00:00.000Z' },
      { participantId: 'participant-3', content: 'second tie', dueAt: '2026-08-28T00:00:00.000Z' },
    ];

    await expect(orchestrator.drainDueScheduledTasks(session, true)).resolves.toEqual(
      ok(undefined),
    );

    expect(committedContents).toEqual(['first tie', 'second tie']);
    expect(session.scheduledAgentPublicSpeeches).toEqual([]);
    expect(heldMutationLocks).toEqual([true, true]);
  });

  it('applies an overdue public speech at its scheduled time', async () => {
    const session = createSession();
    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      async (_stale, mutate) => {
        mutate(session);
        return ok(undefined);
      },
    );
    const scheduledAt = new Date('2026-08-28T00:00:01.000Z');
    session.gameSession.advanceDayPhase(scheduledAt);
    session.scheduledAgentPublicSpeeches = [
      {
        participantId: 'participant-2',
        content: 'I was scheduled before the deadline.',
        dueAt: scheduledAt.toISOString(),
      },
    ];
    vi.setSystemTime(new Date('2026-08-28T00:00:02.000Z'));

    await expect(orchestrator.drainDueScheduledTasks(session)).resolves.toEqual(ok(undefined));

    const projection = session.gameSession.projectionFor('participant-1', 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');
    expect(projection.value.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'chat',
          message: expect.objectContaining({ content: 'I was scheduled before the deadline.' }),
        }),
      ]),
    );
  });

  it('applies an overdue Mafia Chat reply at its scheduled time', async () => {
    const session = createSession();
    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      async (_stale, mutate) => {
        mutate(session);
        return ok(undefined);
      },
    );
    const scheduledAt = '2026-08-28T00:00:00.000Z';
    session.scheduledAgentMafiaChatReplies = [
      {
        id: 'reply-1',
        participantId: 'participant-2',
        content: 'I was decided before the deadline.',
        dueAt: scheduledAt,
        phaseKey: mafiaNightPhaseKey(session.gameSession.snapshot()),
      },
    ];
    vi.setSystemTime(new Date('2026-08-28T00:00:02.000Z'));

    await expect(orchestrator.drainDueScheduledTasks(session)).resolves.toEqual(ok(undefined));

    const projection = session.gameSession.projectionFor('participant-1', 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');
    expect(projection.value.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'mafia-chat',
          message: expect.objectContaining({ content: 'I was decided before the deadline.' }),
        }),
      ]),
    );
    expect(session.scheduledAgentMafiaChatReplies).toEqual([]);
  });

  it('discards a Mafia Chat reply from a previous Night', async () => {
    const session = createSession();
    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      async (_stale, mutate) => {
        mutate(session);
        return ok(undefined);
      },
    );
    session.scheduledAgentMafiaChatReplies = [
      {
        id: 'reply-1',
        participantId: 'participant-2',
        content: 'This must not reach a later Night.',
        dueAt: '2026-08-28T00:00:00.000Z',
        phaseKey: mafiaNightPhaseKey(session.gameSession.snapshot()),
      },
    ];
    const deadline = session.gameSession.snapshot().phaseDeadline;
    session.gameSession.advanceDayPhase(new Date(new Date(deadline).valueOf() + 1));

    await expect(orchestrator.publishMafiaChatReplies(session)).resolves.toEqual(ok(undefined));

    expect(session.scheduledAgentMafiaChatReplies).toEqual([]);
  });

  it('persists a silent Agent decision’s Memory updates', async () => {
    const session = createSession();
    const orchestrator = new GameSessionAgentOrchestrator(
      {
        decidePublicSpeech: () => ({
          type: 'remain-silent' as const,
          allegianceEstimates: [
            {
              participantId: 'participant-3',
              mafiaProbability: 70,
              basis: 'The timing of the claim was inconsistent.',
            },
          ],
          strategy: 'Wait for a direct response before naming a suspect.',
        }),
        decideFinalDefence: () => ({ opening: 'opening', followUp: 'follow-up' }),
        decideMafiaChatOpening: () => 'opening',
        decideMafiaChatReply: () => 'reply',
        selectMafiaTarget: () => undefined,
      },
      async (_stale, mutate) => {
        mutate(session);
        return ok(undefined);
      },
    );
    const deadline = session.gameSession.snapshot().phaseDeadline;
    session.gameSession.advanceDayPhase(new Date(new Date(deadline).valueOf() + 1));

    await orchestrator.publishPublicSpeechReplies(session);

    expect(session.agentMinds['participant-2']?.memory).toMatchObject({
      allegianceEstimates: [
        {
          participantId: 'participant-3',
        },
      ],
      strategy: 'Wait for a direct response before naming a suspect.',
    });
  });

  it('retains every Mafia Chat reply when one durable commit fails', async () => {
    const session = createSession();
    session.scheduledAgentMafiaChatReplies = [
      {
        id: 'reply-1',
        participantId: 'participant-2',
        content: 'first reply',
        dueAt: '2026-08-28T00:00:00.000Z',
        phaseKey: mafiaNightPhaseKey(session.gameSession.snapshot()),
      },
      {
        id: 'reply-2',
        participantId: 'participant-2',
        content: 'second reply',
        dueAt: '2026-08-28T00:00:00.000Z',
        phaseKey: mafiaNightPhaseKey(session.gameSession.snapshot()),
      },
    ];
    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      async () => err({ type: 'durability-unavailable' }),
    );

    await expect(orchestrator.publishMafiaChatReplies(session)).resolves.toEqual(
      err({ type: 'durability-unavailable' }),
    );

    expect(session.scheduledAgentMafiaChatReplies).toHaveLength(2);
  });

  it('does not resume or drain Scheduled Agent Actions for a terminal Game Session', async () => {
    const session = createSession();
    const commitAgentMutation = vi.fn(async () => ok(undefined));
    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      commitAgentMutation,
    );
    session.status = 'abandoned';
    session.scheduledAgentPublicSpeeches = [
      { participantId: 'participant-2', content: 'late reply', dueAt: '2026-08-28T00:00:00.000Z' },
    ];

    orchestrator.resumeScheduledTasks(session);
    await expect(orchestrator.drainDueScheduledTasks(session)).resolves.toEqual(ok(undefined));

    expect(commitAgentMutation).not.toHaveBeenCalled();
    expect(session.publicSpeechAgentTimers.size).toBe(0);
  });

  it('keeps Night open while required Agent actions are pending during durable recovery', async () => {
    const session = createNightActionSession();
    const sessions = new Map([[session.gameSession.snapshot().sessionId, session]]);
    const agentActions = new GameSessionAgentOrchestrator(new NightActionGateway(), async () =>
      ok(undefined),
    );
    const lifecycle = new GameSessionLifecycle({
      state: {
        sessions,
        guestSessionCounts: new Map(),
        idempotencyKeys: new Map(),
        eventSubscriberCounts: new Map(),
      },
      persistence: {
        authorityFor: () => undefined,
        save: async () => ok(true),
        hydrate: async () => ok(undefined),
        snapshotFor: () => {
          throw new Error('A pending Night must not resolve.');
        },
        restore: () => {
          throw new Error('Unexpected restore.');
        },
      },
      phaseOperations: {
        projectionFor: () => {
          throw new Error('A pending Night must not publish a projection.');
        },
        publishProjection: () => {
          throw new Error('A pending Night must not publish a projection.');
        },
        submitAgentActions: async () => ok(undefined),
        retryAgentActions: () => undefined,
        retryMafiaChatReplies: () => undefined,
        retryPhaseTransition: () => undefined,
        retryPhaseTransitionAfterClaimLease: () => undefined,
      },
      clock: nativeGameSessionClock,
      agentActions,
      disposeSession: () => undefined,
      now: () => dayjs(),
      utcDay: () => dayjs().format('YYYY-MM-DD'),
    });
    session.agentActionsPending = true;
    vi.setSystemTime(new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1));

    await expect(lifecycle.recoverExpiredPhaseDurably(session)).resolves.toEqual(ok(undefined));

    expect(session.gameSession.snapshot().phase).toBe('night');
  });

  it('schedules a newly restored public reply while retaining a local timer', async () => {
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis, 'withai:agent-speech-timers');
    const sessions = new Map<string, StoredGameSessionEntity>();
    const session = createSession();
    const existing = {
      participantId: 'participant-2',
      content: 'I need more evidence.',
      dueAt: '2026-08-28T00:00:00.500Z',
    };
    const restored = {
      participantId: 'participant-3',
      content: 'Agent Mafia is suspicious.',
      dueAt: '2026-08-28T00:00:00.750Z',
    };
    session.scheduledAgentPublicSpeeches = [existing];

    const orchestrator = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      async () => ok(undefined),
    );
    const durability = new GameSessionDurability(
      () => authority,
      nativeGameSessionClock,
      sessions,
      (replaced) => orchestrator.clearTimers(replaced),
    );
    orchestrator.resumeScheduledTasks(session);
    session.scheduledAgentPublicSpeeches.push(restored);
    const projection = session.gameSession.projectionFor(session.humanParticipantId, 0);
    if (projection.isErr()) throw new Error('Expected a Game Session projection.');
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

    await durability.hydrate('session-1');
    const hydrated = sessions.get('session-1');
    if (!hydrated) throw new Error('Expected a hydrated Game Session.');
    orchestrator.resumeScheduledTasks(hydrated);

    expect(hydrated.publicSpeechAgentTimers.size).toBe(2);
    expect(hydrated.publicSpeechAgentTimers.has(scheduledAgentPublicSpeechKey(existing))).toBe(
      true,
    );
    expect(hydrated.publicSpeechAgentTimers.has(scheduledAgentPublicSpeechKey(restored))).toBe(
      true,
    );
    redis.disconnect();
  });

  it('cleans up an Abandoned Game Session at its retention limit', async () => {
    const now = dayjs('2026-08-28T00:00:00.000Z');
    const abandoned = createSession();
    const completed = createSession();
    abandoned.status = 'abandoned';
    abandoned.lastAccessedAt = now.subtract(
      gameSessionsConfig.abandonedSessionTtlMinutes,
      'minute',
    );
    completed.status = 'completed';
    completed.lastAccessedAt = abandoned.lastAccessedAt;
    const sessions = new Map([
      ['abandoned', abandoned],
      ['completed', completed],
    ]);
    const agentActions = new GameSessionAgentOrchestrator(
      new SequencedMafiaTargetGateway(),
      async () => ok(undefined),
    );
    const lifecycle = new GameSessionLifecycle({
      state: {
        sessions,
        guestSessionCounts: new Map(),
        idempotencyKeys: new Map(),
        eventSubscriberCounts: new Map(),
      },
      persistence: {
        authorityFor: () => undefined,
        save: async () => ok(true),
        hydrate: async () => ok(undefined),
        snapshotFor: () => {
          throw new Error('Unexpected snapshot.');
        },
        restore: () => {
          throw new Error('Unexpected restore.');
        },
      },
      phaseOperations: {
        projectionFor: () => {
          throw new Error('Unexpected projection.');
        },
        publishProjection: () => {
          throw new Error('Unexpected projection.');
        },
        submitAgentActions: async () => ok(undefined),
        retryAgentActions: () => undefined,
        retryMafiaChatReplies: () => undefined,
        retryPhaseTransition: () => undefined,
        retryPhaseTransitionAfterClaimLease: () => undefined,
      },
      clock: nativeGameSessionClock,
      agentActions,
      disposeSession: () => undefined,
      now: () => now,
      utcDay: () => now.format('YYYY-MM-DD'),
    });

    await lifecycle.cleanupExpiredSessions();

    expect(sessions.has('abandoned')).toBe(false);
    expect(sessions.has('completed')).toBe(true);
  });

  it('replaces a stale Final Defence timer with the authoritative scheduled action', async () => {
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
      async (_stale, mutate) => {
        const current = sessions.get('session-1');
        if (current && mutate(current)) committedFollowUps += 1;
        return ok(undefined);
      },
    );

    vi.setSystemTime(at(1_005));
    await orchestrator.submitDayActions(session);
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
    session.scheduledAgentFinalDefence = {
      ...session.scheduledAgentFinalDefence!,
      content: 'stale follow-up',
    };

    const hydrated = await durability.hydrate('session-1');
    expect(hydrated.isOk()).toBe(true);
    const refreshed = sessions.get('session-1');
    if (!refreshed) throw new Error('Expected a refreshed Game Session.');
    expect(refreshed.agentFinalDefenceTimer).toBeUndefined();
    orchestrator.resumeScheduledTasks(refreshed);
    vi.advanceTimersByTime(1_000);

    expect(committedFollowUps).toBe(1);
    redis.disconnect();
  });
});
