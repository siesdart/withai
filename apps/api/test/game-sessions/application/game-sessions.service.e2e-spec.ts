/* oxlint-disable typescript/no-unsafe-type-assertion -- The controller is exercised with the narrow HTTP surface it uses. */
import { EventEmitter } from 'node:events';

import { MafiaGameModule, MafiaGameSession } from '@repo/mafia';
import type { Request, Response } from 'express';
import RedisMock from 'ioredis-mock';
import { errAsync, ok, okAsync, type Result } from 'neverthrow';
import { Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentDecisionGateway } from '../../../src/game-sessions/agents/agent-decision.gateway.js';
import type { GameSessionError } from '../../../src/game-sessions/application/game-session-error.js';
import { GameSessionsService } from '../../../src/game-sessions/application/game-sessions.service.js';
import { RedisGameSessionAuthority } from '../../../src/game-sessions/durability/redis-game-session-authority.js';
import { GameSessionsController } from '../../../src/game-sessions/transport/game-sessions.controller.js';
import { MafiaGameSessionProjectionEntity } from '../../../src/game-sessions/transport/mafia-game-session-projection.entity.js';

const createDeferred = <Value>() => {
  let resolve: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve: (value: Value) => resolve(value) };
};

const flushMicrotasks = async (remaining = 10): Promise<void> => {
  if (remaining === 0) return;
  await Promise.resolve();
  return flushMicrotasks(remaining - 1);
};

describe('GameSessionsService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces concurrent Agent action submissions for one session', async () => {
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(undefined, 5, 'coalesce-agent-actions-key');
    if (created.isErr()) throw new Error('Expected an in-memory session.');
    const state = service as unknown as {
      sessions: Map<string, { agentActionsPending: boolean }>;
      agentActions: { submitDayActions(session: unknown): Promise<void> };
      submitAndCommitAgentActions(session: unknown): Promise<Result<void, GameSessionError>>;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    session.agentActionsPending = true;
    const submitDayActions = vi
      .spyOn(state.agentActions, 'submitDayActions')
      .mockResolvedValue(undefined);

    await Promise.all([
      state.submitAndCommitAgentActions(session),
      state.submitAndCommitAgentActions(session),
    ]);

    expect(submitDayActions).toHaveBeenCalledOnce();
    service.onModuleDestroy();
  });

  it('submits nomination actions after an in-flight Agent action crosses into Nomination', async () => {
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(
      undefined,
      5,
      'phase-change-agent-actions-key',
    );
    if (created.isErr()) throw new Error('Expected an in-memory session.');
    const state = service as unknown as {
      sessions: Map<string, { agentActionsPending: boolean; gameSession: MafiaGameSession }>;
      agentActions: { submitDayActions(session: unknown): Promise<void> };
      submitAndCommitAgentActions(session: unknown): Promise<Result<void, GameSessionError>>;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    while (session.gameSession.snapshot().phase !== 'discussion') {
      session.gameSession.advanceDayPhase(
        new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1),
      );
    }
    session.agentActionsPending = true;

    let submissions = 0;
    vi.spyOn(state.agentActions, 'submitDayActions').mockImplementation(async () => {
      submissions += 1;
      if (submissions === 1) {
        session.gameSession.advanceDayPhase(
          new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1),
        );
        return;
      }
      session.gameSession.submitNomination('participant-2', 'participant-3', new Date());
    });

    await state.submitAndCommitAgentActions(session);

    expect(submissions).toBe(2);
    expect(session.gameSession.snapshot().nominations).toContainEqual([
      'participant-2',
      'participant-3',
    ]);
    service.onModuleDestroy();
  });

  it('rehydrates a committed session in a new service instance', async () => {
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const firstService = new GameSessionsService(agentDecisions);
    Object.assign(firstService, { authority });
    const created = await firstService.createMafiaSession(undefined, 5, 'restart-key');
    if (created.isErr()) throw new Error('Expected a durable session.');

    const restartedService = new GameSessionsService(agentDecisions);
    Object.assign(restartedService, { authority });
    const holderId = created.value.holderId;
    await expect(
      restartedService.getProjection(created.value.projection.sessionId, holderId),
    ).resolves.toMatchObject({ value: { sessionId: created.value.projection.sessionId } });
    redis.disconnect();
  });

  it('returns a Mafia Chat projection before Agent LLM replies complete', async () => {
    const deferredReply = createDeferred<string>();
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => deferredReply.promise,
      selectMafiaTarget: () => 'participant-2',
    });
    Object.assign(service, {
      mafiaModule: new MafiaGameModule(() => 0),
    });
    const created = await service.createMafiaSession(undefined, 8, 'async-mafia-chat-key');
    if (created.isErr()) throw new Error('Expected an in-memory session.');
    const state = service as unknown as {
      sessions: Map<
        string,
        {
          gameSession: MafiaGameSession;
          scheduledAgentMafiaChatReplies: { content: string; dueAt: string }[];
        }
      >;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    while (session.gameSession.snapshot().phase !== 'night') {
      session.gameSession.advanceDayPhase(
        new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
      );
    }

    let settled = false;
    const submission = service
      .submitMafiaChat(
        created.value.projection.sessionId,
        created.value.holderId,
        'Let us focus on Hana.',
        'async-mafia-chat-action-key',
      )
      .then((result) => {
        settled = true;
        return result;
      });

    await flushMicrotasks();
    expect(settled).toBe(true);
    await expect(submission).resolves.toMatchObject({ value: expect.any(Object) });

    deferredReply.resolve('Hana is the strongest target.');
    await flushMicrotasks();
    expect(session.scheduledAgentMafiaChatReplies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: 'Hana is the strongest target.',
          dueAt: expect.any(String),
        }),
      ]),
    );
    service.onModuleDestroy();
  });

  it('returns a Public Speech projection before Agent LLM replies complete', async () => {
    const deferredSpeech = createDeferred<{
      type: 'speak';
      content: string;
    }>();
    let decisions = 0;
    const service = new GameSessionsService({
      decidePublicSpeech: () => {
        decisions += 1;
        return decisions === 1 ? deferredSpeech.promise : { type: 'remain-silent' as const };
      },
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(undefined, 5, 'async-public-speech-key');
    if (created.isErr()) throw new Error('Expected an in-memory session.');
    const state = service as unknown as {
      sessions: Map<
        string,
        { gameSession: MafiaGameSession; scheduledAgentPublicSpeeches: { content: string }[] }
      >;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    while (session.gameSession.snapshot().phase !== 'discussion') {
      session.gameSession.advanceDayPhase(
        new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
      );
    }

    let settled = false;
    const submission = service
      .submitPublicSpeech(
        created.value.projection.sessionId,
        created.value.holderId,
        'I want to hear everyone before deciding.',
        'async-public-speech-action-key',
      )
      .then((result) => {
        settled = true;
        return result;
      });

    await flushMicrotasks();
    expect(settled).toBe(true);
    await expect(submission).resolves.toMatchObject({ value: expect.any(Object) });

    deferredSpeech.resolve({
      type: 'speak',
      content: 'Let us assess the facts first.',
    });
    await flushMicrotasks();
    expect(session.scheduledAgentPublicSpeeches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: 'Let us assess the facts first.' }),
      ]),
    );
    service.onModuleDestroy();
  });

  it('applies a Discussion Time Adjustment while an Agent public-speech decision is in flight', async () => {
    const deferredSpeech = createDeferred<{ type: 'speak'; content: string }>();
    const decisionStarted = createDeferred<void>();
    let decisions = 0;
    const service = new GameSessionsService({
      decidePublicSpeech: () => {
        decisions += 1;
        if (decisions > 1) return { type: 'remain-silent' as const };
        decisionStarted.resolve(undefined);
        return deferredSpeech.promise;
      },
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(undefined, 5, 'adjustment-during-speech-key');
    if (created.isErr()) throw new Error('Expected an in-memory session.');
    const state = service as unknown as {
      sessions: Map<string, { gameSession: MafiaGameSession }>;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    while (session.gameSession.snapshot().phase !== 'discussion') {
      session.gameSession.advanceDayPhase(
        new Date(Date.parse(session.gameSession.snapshot().phaseDeadline) + 1),
      );
    }
    const expectedDeadline = session.gameSession.snapshot().phaseDeadline;

    await service.submitPublicSpeech(
      created.value.projection.sessionId,
      created.value.holderId,
      'I want to hear everyone before deciding.',
      'speech-before-adjustment-key',
    );
    await decisionStarted.promise;

    let settled = false;
    const adjustment = service
      .adjustDiscussionTime(
        created.value.projection.sessionId,
        created.value.holderId,
        10,
        expectedDeadline,
        'adjustment-during-speech-key',
      )
      .then((result) => {
        settled = true;
        return result;
      });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(true);
    await expect(adjustment).resolves.toMatchObject({
      value: { public: { phaseDeadline: expect.not.stringMatching(expectedDeadline) } },
    });

    deferredSpeech.resolve({
      type: 'speak',
      content: 'This response was not needed to adjust time.',
    });
    await flushMicrotasks();
    service.onModuleDestroy();
  });

  it('commits an Agent public speech when a snapshot read hydrates during its decision', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-13T00:00:00.000Z') });
    const deferredSpeech = createDeferred<{ type: 'speak'; content: string }>();
    let publicSpeechDecisions = 0;
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis, 'withai:public-speech-hydration');
    const service = new GameSessionsService({
      decidePublicSpeech: () => {
        publicSpeechDecisions += 1;
        return publicSpeechDecisions <= 4
          ? { type: 'remain-silent' as const }
          : deferredSpeech.promise;
      },
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    Object.assign(service, { authority });
    const created = await service.createMafiaSession(undefined, 5, 'public-speech-hydration-key');
    if (created.isErr()) throw new Error('Expected a durable session.');

    await vi.advanceTimersByTimeAsync(30_001);
    await flushMicrotasks();
    await service.submitPublicSpeech(
      created.value.projection.sessionId,
      created.value.holderId,
      'I want to compare the evidence.',
      'public-speech-hydration-action-key',
    );
    await flushMicrotasks();
    expect(publicSpeechDecisions).toBe(5);

    const readingSnapshot = service.getProjection(
      created.value.projection.sessionId,
      created.value.holderId,
    );
    deferredSpeech.resolve({ type: 'speak', content: 'I want to hear another perspective.' });

    await readingSnapshot;
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(
      service.getProjection(created.value.projection.sessionId, created.value.holderId),
    ).resolves.toMatchObject({
      value: {
        timeline: expect.arrayContaining([
          expect.objectContaining({
            type: 'chat',
            message: expect.objectContaining({ content: 'I want to hear another perspective.' }),
          }),
        ]),
      },
    });

    service.onModuleDestroy();
    redis.disconnect();
  });

  it('commits a newer Human public speech while an obsolete Agent decision is aborted', async () => {
    vi.useFakeTimers();
    const deferredSpeech = createDeferred<{ type: 'speak'; content: string }>();
    let publicSpeechDecisions = 0;
    let firstAbortController: AbortController | undefined;
    const service = new GameSessionsService({
      decidePublicSpeech: (_context, options) => {
        publicSpeechDecisions += 1;
        if (publicSpeechDecisions > 1) return { type: 'remain-silent' as const };
        firstAbortController = options?.abortController;
        return deferredSpeech.promise;
      },
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(
      undefined,
      5,
      'cancel-stale-public-speech-key',
    );
    if (created.isErr()) throw new Error('Expected an in-memory session.');
    const state = service as unknown as {
      sessions: Map<
        string,
        { gameSession: MafiaGameSession; scheduledAgentPublicSpeeches: { content: string }[] }
      >;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    while (session.gameSession.snapshot().phase !== 'discussion') {
      session.gameSession.advanceDayPhase(
        new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
      );
    }

    await service.submitPublicSpeech(
      created.value.projection.sessionId,
      created.value.holderId,
      'I want to hear everyone before deciding.',
      'first-public-speech-action-key',
    );
    await flushMicrotasks();
    expect(firstAbortController).toBeDefined();

    vi.advanceTimersByTime(1_001);
    let settled = false;
    const newerSpeech = service
      .submitPublicSpeech(
        created.value.projection.sessionId,
        created.value.holderId,
        'One more point before we decide.',
        'newer-public-speech-action-key',
      )
      .then((result) => {
        settled = true;
        return result;
      });

    await flushMicrotasks();
    expect(settled).toBe(true);
    await expect(newerSpeech).resolves.toMatchObject({ value: expect.any(Object) });
    expect(firstAbortController?.signal.aborted).toBe(true);

    deferredSpeech.resolve({ type: 'speak', content: 'This stale message must not be scheduled.' });
    await flushMicrotasks();
    expect(session.gameSession.snapshot().timeline).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'chat',
          message: expect.objectContaining({
            content: 'This stale message must not be scheduled.',
          }),
        }),
      ]),
    );
    expect(session.scheduledAgentPublicSpeeches).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: 'This stale message must not be scheduled.' }),
      ]),
    );
    service.onModuleDestroy();
  });

  it('aborts an in-flight Agent public-speech decision when Discussion advances to Nomination', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-12T00:00:00.000Z') });
    const deferredSpeech = createDeferred<{ type: 'speak'; content: string }>();
    let abortController: AbortController | undefined;
    const service = new GameSessionsService({
      decidePublicSpeech: (_context, options) => {
        abortController = options?.abortController;
        return deferredSpeech.promise;
      },
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decidePhaseAction: () => ({ targetParticipantId: 'participant-2' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(undefined, 5, 'abort-on-nomination-key');
    if (created.isErr()) throw new Error('Expected an in-memory session.');
    const state = service as unknown as {
      sessions: Map<
        string,
        { gameSession: MafiaGameSession; scheduledAgentPublicSpeeches: { content: string }[] }
      >;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');

    vi.clearAllTimers();
    let discussionStart: Date | undefined;
    for (
      let transitionCount = 0;
      session.gameSession.snapshot().phase !== 'discussion' && transitionCount < 10;
      transitionCount += 1
    ) {
      const nextPhaseAt = new Date(
        new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1,
      );
      session.gameSession.advanceDayPhase(nextPhaseAt);
      if (session.gameSession.snapshot().phase === 'discussion') discussionStart = nextPhaseAt;
    }
    if (!discussionStart) throw new Error('Expected Discussion to begin.');
    vi.setSystemTime(discussionStart);
    let publicSpeechSubmitted = false;
    const publicSpeech = service
      .submitPublicSpeech(
        created.value.projection.sessionId,
        created.value.holderId,
        'I want to hear everyone before deciding.',
        'discussion-speech-trigger-key',
      )
      .then((result) => {
        publicSpeechSubmitted = true;
        return result;
      });
    await flushMicrotasks();
    expect(publicSpeechSubmitted).toBe(true);
    await expect(publicSpeech).resolves.toMatchObject({ value: expect.any(Object) });
    expect(session.gameSession.snapshot().phase).toBe('discussion');
    expect(abortController).toBeDefined();

    const lifecycle = (
      service as unknown as {
        lifecycle: { schedulePhaseTransition(current: typeof session): void };
      }
    ).lifecycle;
    lifecycle.schedulePhaseTransition(session);
    await vi.advanceTimersByTimeAsync(120_001);
    await flushMicrotasks();
    expect(session.gameSession.snapshot().phase).toBe('nomination');
    expect(abortController?.signal.aborted).toBe(true);
    deferredSpeech.resolve({ type: 'speak', content: 'This stale message must not be scheduled.' });
    await flushMicrotasks();
    expect(session.scheduledAgentPublicSpeeches).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: 'This stale message must not be scheduled.' }),
      ]),
    );
    service.onModuleDestroy();
  });

  it('submits pending Agent nominations after a Human nomination', async () => {
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decidePhaseAction: () => ({
        targetParticipantId: 'participant-2',
      }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const service = new GameSessionsService(agentDecisions);
    const created = await service.createMafiaSession(undefined, 5, 'human-nomination-key');
    if (created.isErr()) throw new Error('Expected an in-memory session.');
    const state = service as unknown as {
      sessions: Map<string, { agentActionsPending: boolean; gameSession: MafiaGameSession }>;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    const nightEnd = new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1);
    session.gameSession.advanceDayPhase(nightEnd);
    const nominationStart = new Date(
      new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1,
    );
    expect(session.gameSession.advanceDayPhase(nominationStart)).toEqual({
      value: { type: 'phase-advanced', phase: 'nomination' },
    });
    session.agentActionsPending = true;

    await expect(
      service.submitNomination(
        created.value.projection.sessionId,
        created.value.holderId,
        'participant-4',
        'human-nomination-action-key',
      ),
    ).resolves.toMatchObject({ value: expect.any(Object) });

    await flushMicrotasks();

    expect(session.gameSession.snapshot().nominations).toEqual(
      expect.arrayContaining([
        ['participant-1', 'participant-4'],
        ['participant-2', 'participant-2'],
        ['participant-3', 'participant-2'],
        ['participant-4', 'participant-2'],
        ['participant-5', 'participant-2'],
      ]),
    );
    expect(session.agentActionsPending).toBe(false);
    service.onModuleDestroy();
  });

  it('returns a Human nomination projection before pending Agent LLM decisions complete', async () => {
    const deferredDecision = createDeferred<{ targetParticipantId: string }>();
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions: AgentDecisionGateway = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decidePhaseAction: (context) =>
        context.public.phase === 'nomination'
          ? deferredDecision.promise
          : {
              targetParticipantId: 'participant-2',
            },
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const firstService = new GameSessionsService(agentDecisions);
    Object.assign(firstService, { authority });
    const created = await firstService.createMafiaSession(
      undefined,
      5,
      'async-human-nomination-key',
    );
    if (created.isErr()) throw new Error('Expected an in-memory session.');
    const state = firstService as unknown as {
      sessions: Map<string, { agentActionsPending: boolean; gameSession: MafiaGameSession }>;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    session.gameSession.advanceDayPhase(
      new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
    );
    session.gameSession.advanceDayPhase(
      new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
    );
    session.agentActionsPending = true;
    const stored = await authority.load(created.value.projection.sessionId);
    if (stored.isErr() || !stored.value) throw new Error('Expected an authoritative snapshot.');
    await authority.saveSnapshot({
      ...stored.value,
      gameSession: session.gameSession.snapshot(),
      agentActionsPending: true,
    });

    const service = new GameSessionsService(agentDecisions);
    Object.assign(service, { authority });

    let settled = false;
    const submission = service
      .submitNomination(
        created.value.projection.sessionId,
        created.value.holderId,
        'participant-4',
        'async-human-nomination-action-key',
      )
      .then((result) => {
        settled = true;
        return result;
      });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(true);
    await expect(submission).resolves.toMatchObject({
      value: { personal: { vote: { phase: 'nomination', targetParticipantId: 'participant-4' } } },
    });

    deferredDecision.resolve({
      targetParticipantId: 'participant-2',
    });
    await flushMicrotasks();

    firstService.onModuleDestroy();
    service.onModuleDestroy();
    redis.disconnect();
  });

  it('does not block a Human nomination behind an Agent LLM decision already in flight', async () => {
    const deferredDecision = createDeferred<{ targetParticipantId: string }>();
    const decisionStarted = createDeferred<void>();
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions: AgentDecisionGateway = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decidePhaseAction: (context) => {
        if (context.public.phase !== 'nomination') {
          return {
            targetParticipantId: 'participant-2',
          };
        }
        decisionStarted.resolve(undefined);
        return deferredDecision.promise;
      },
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const firstService = new GameSessionsService(agentDecisions);
    Object.assign(firstService, { authority });
    const created = await firstService.createMafiaSession(
      undefined,
      5,
      'in-flight-agent-nomination-key',
    );
    if (created.isErr()) throw new Error('Expected a durable session.');
    const state = firstService as unknown as {
      sessions: Map<string, { agentActionsPending: boolean; gameSession: MafiaGameSession }>;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    session.gameSession.advanceDayPhase(
      new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
    );
    session.gameSession.advanceDayPhase(
      new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
    );
    session.agentActionsPending = true;
    const stored = await authority.load(created.value.projection.sessionId);
    if (stored.isErr() || !stored.value) throw new Error('Expected an authoritative snapshot.');
    await authority.saveSnapshot({
      ...stored.value,
      gameSession: session.gameSession.snapshot(),
      agentActionsPending: true,
    });

    const service = new GameSessionsService(agentDecisions);
    Object.assign(service, { authority });
    await service.getProjection(created.value.projection.sessionId, created.value.holderId);
    await decisionStarted.promise;

    let settled = false;
    const submission = service
      .submitNomination(
        created.value.projection.sessionId,
        created.value.holderId,
        'participant-4',
        'human-nomination-while-agent-is-thinking-key',
      )
      .then((result) => {
        settled = true;
        return result;
      });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(true);
    await expect(submission).resolves.toMatchObject({
      value: { personal: { vote: { phase: 'nomination', targetParticipantId: 'participant-4' } } },
    });

    deferredDecision.resolve({
      targetParticipantId: 'participant-2',
    });
    await flushMicrotasks();
    firstService.onModuleDestroy();
    service.onModuleDestroy();
    redis.disconnect();
  });

  it('preserves Agent nominations when a Human nomination hydrates a pending durable session', async () => {
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decidePhaseAction: () => ({
        targetParticipantId: 'participant-2',
      }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const firstService = new GameSessionsService(agentDecisions);
    Object.assign(firstService, { authority });
    const created = await firstService.createMafiaSession(
      undefined,
      5,
      'durable-human-nomination-key',
    );
    if (created.isErr()) throw new Error('Expected a durable session.');
    const state = firstService as unknown as {
      sessions: Map<string, { agentActionsPending: boolean; gameSession: MafiaGameSession }>;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    session.gameSession.advanceDayPhase(
      new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
    );
    session.gameSession.advanceDayPhase(
      new Date(new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1),
    );
    session.agentActionsPending = true;
    const stored = await authority.load(created.value.projection.sessionId);
    if (stored.isErr() || !stored.value) throw new Error('Expected an authoritative snapshot.');
    await authority.saveSnapshot({
      ...stored.value,
      gameSession: session.gameSession.snapshot(),
      agentActionsPending: true,
    });

    const secondService = new GameSessionsService(agentDecisions);
    Object.assign(secondService, { authority });
    await expect(
      secondService.submitNomination(
        created.value.projection.sessionId,
        created.value.holderId,
        'participant-4',
        'durable-human-nomination-action-key',
      ),
    ).resolves.toMatchObject({ value: expect.any(Object) });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await expect(authority.load(created.value.projection.sessionId)).resolves.toMatchObject({
      value: {
        agentActionsPending: false,
        gameSession: {
          nominations: expect.arrayContaining([
            ['participant-1', 'participant-4'],
            ['participant-2', 'participant-2'],
            ['participant-3', 'participant-2'],
            ['participant-4', 'participant-2'],
            ['participant-5', 'participant-2'],
          ]),
        },
      },
    });
    firstService.onModuleDestroy();
    secondService.onModuleDestroy();
    redis.disconnect();
  });

  it('persists Agent verdicts alongside a Human verdict in a pending durable session', async () => {
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decidePhaseAction: () => ({ verdict: 'eliminate' as const }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const firstService = new GameSessionsService(agentDecisions);
    Object.assign(firstService, { authority });
    const created = await firstService.createMafiaSession(
      undefined,
      5,
      'durable-human-verdict-key',
    );
    if (created.isErr()) throw new Error('Expected a durable session.');
    const state = firstService as unknown as {
      sessions: Map<string, { agentActionsPending: boolean; gameSession: MafiaGameSession }>;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    const afterNight = new Date(
      new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1,
    );
    session.gameSession.advanceDayPhase(afterNight);
    const afterDiscussion = new Date(
      new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1,
    );
    session.gameSession.advanceDayPhase(afterDiscussion);
    session.gameSession.submitNomination('participant-1', 'participant-2', afterDiscussion);
    session.gameSession.submitNomination('participant-2', 'participant-2', afterDiscussion);
    const afterNomination = new Date(
      new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1,
    );
    session.gameSession.advanceDayPhase(afterNomination);
    const afterFinalDefence = new Date(
      new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1,
    );
    session.gameSession.advanceDayPhase(afterFinalDefence);
    session.agentActionsPending = true;
    const stored = await authority.load(created.value.projection.sessionId);
    if (stored.isErr() || !stored.value) throw new Error('Expected an authoritative snapshot.');
    await authority.saveSnapshot({
      ...stored.value,
      gameSession: session.gameSession.snapshot(),
      agentActionsPending: true,
    });

    const secondService = new GameSessionsService(agentDecisions);
    Object.assign(secondService, { authority });
    await expect(
      secondService.submitVerdict(
        created.value.projection.sessionId,
        created.value.holderId,
        'spare',
        'durable-human-verdict-action-key',
      ),
    ).resolves.toMatchObject({ value: expect.any(Object) });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await expect(authority.load(created.value.projection.sessionId)).resolves.toMatchObject({
      value: {
        agentActionsPending: false,
        gameSession: {
          verdicts: expect.arrayContaining([
            ['participant-1', 'spare'],
            ['participant-2', 'eliminate'],
            ['participant-3', 'eliminate'],
            ['participant-4', 'eliminate'],
            ['participant-5', 'eliminate'],
          ]),
        },
      },
    });
    firstService.onModuleDestroy();
    secondService.onModuleDestroy();
    redis.disconnect();
  });

  it('waits for pending Agent verdicts before resolving the verdict deadline after hydration', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-13T00:00:00.000Z') });
    const deferredVerdict = createDeferred<{ verdict: 'eliminate' }>();
    const verdictStarted = createDeferred<void>();
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis, undefined, () => new Date());
    const agentDecisions: AgentDecisionGateway = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decidePhaseAction: (context) => {
        if (context.public.phase !== 'verdict') return { targetParticipantId: 'participant-2' };
        verdictStarted.resolve(undefined);
        return deferredVerdict.promise;
      },
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const firstService = new GameSessionsService(agentDecisions);
    Object.assign(firstService, { authority });
    const created = await firstService.createMafiaSession(
      undefined,
      5,
      'pending-verdict-deadline-key',
    );
    if (created.isErr()) throw new Error('Expected a durable session.');
    const state = firstService as unknown as {
      sessions: Map<string, { agentActionsPending: boolean; gameSession: MafiaGameSession }>;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    const afterNight = new Date(
      new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1,
    );
    session.gameSession.advanceDayPhase(afterNight);
    const afterDiscussion = new Date(
      new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1,
    );
    session.gameSession.advanceDayPhase(afterDiscussion);
    session.gameSession.submitNomination('participant-1', 'participant-2', afterDiscussion);
    session.gameSession.submitNomination('participant-2', 'participant-2', afterDiscussion);
    const afterNomination = new Date(
      new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1,
    );
    session.gameSession.advanceDayPhase(afterNomination);
    const afterFinalDefence = new Date(
      new Date(session.gameSession.snapshot().phaseDeadline).valueOf() + 1,
    );
    session.gameSession.advanceDayPhase(afterFinalDefence);
    session.agentActionsPending = true;
    const stored = await authority.load(created.value.projection.sessionId);
    if (stored.isErr() || !stored.value) throw new Error('Expected an authoritative snapshot.');
    await authority.saveSnapshot({
      ...stored.value,
      gameSession: session.gameSession.snapshot(),
      agentActionsPending: true,
    });

    const secondService = new GameSessionsService(agentDecisions);
    Object.assign(secondService, { authority });
    await secondService.getProjection(created.value.projection.sessionId, created.value.holderId);
    await verdictStarted.promise;
    await secondService.submitVerdict(
      created.value.projection.sessionId,
      created.value.holderId,
      'spare',
      'human-verdict-during-agent-thinking-key',
    );
    await vi.advanceTimersByTimeAsync(10_001);

    await expect(authority.load(created.value.projection.sessionId)).resolves.toMatchObject({
      value: { gameSession: { phase: 'verdict' } },
    });

    deferredVerdict.resolve({ verdict: 'eliminate' });
    await flushMicrotasks();
    firstService.onModuleDestroy();
    secondService.onModuleDestroy();
    redis.disconnect();
  });

  it('persists Agent nominations when a Discussion Time Adjustment starts nomination', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-12T00:00:00.000Z') });
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decidePhaseAction: () => ({
        targetParticipantId: 'participant-2',
      }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const service = new GameSessionsService(agentDecisions);
    const created = await service.createMafiaSession(undefined, 5, 'adjustment-nomination-key');
    if (created.isErr()) throw new Error('Expected an in-memory session.');
    const state = service as unknown as {
      sessions: Map<string, { gameSession: MafiaGameSession }>;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    vi.clearAllTimers();
    vi.setSystemTime(new Date(Date.parse(created.value.projection.public.phaseDeadline) + 1));
    const discussion = await service.getProjection(
      created.value.projection.sessionId,
      created.value.holderId,
    );
    if (discussion.isErr()) throw new Error('Expected the initial Night to resolve.');
    for (let index = 0; index < 11; index += 1) {
      session.gameSession.adjustDiscussionTime('participant-1', -10, new Date());
    }
    const expectedDeadline = session.gameSession.snapshot().phaseDeadline;

    await expect(
      service.adjustDiscussionTime(
        created.value.projection.sessionId,
        created.value.holderId,
        -10,
        expectedDeadline,
        'adjustment-starts-nomination-key',
      ),
    ).resolves.toMatchObject({ value: { public: { phase: 'nomination' } } });

    await flushMicrotasks();

    expect(session.gameSession.snapshot().nominations).toEqual(
      expect.arrayContaining([
        ['participant-2', 'participant-2'],
        ['participant-3', 'participant-2'],
        ['participant-4', 'participant-2'],
        ['participant-5', 'participant-2'],
      ]),
    );
    service.onModuleDestroy();
  });

  it('waits for pending Agent nominations before resolving a shortened Discussion', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-12T00:00:00.000Z') });
    const deferredNomination = createDeferred<{ targetParticipantId: string }>();
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decidePhaseAction: (context) =>
        context.public.phase === 'nomination'
          ? deferredNomination.promise
          : { targetParticipantId: 'participant-2' },
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(undefined, 5, 'delayed-adjustment-key');
    if (created.isErr()) throw new Error('Expected an in-memory session.');
    const state = service as unknown as {
      sessions: Map<string, { gameSession: MafiaGameSession }>;
    };
    const session = state.sessions.get(created.value.projection.sessionId);
    if (!session) throw new Error('Expected a stored session.');
    vi.clearAllTimers();
    vi.setSystemTime(new Date(Date.parse(created.value.projection.public.phaseDeadline) + 1));
    const discussion = await service.getProjection(
      created.value.projection.sessionId,
      created.value.holderId,
    );
    if (discussion.isErr()) throw new Error('Expected the initial Night to resolve.');
    for (let index = 0; index < 11; index += 1) {
      session.gameSession.adjustDiscussionTime('participant-1', -10, new Date());
    }
    const expectedDeadline = session.gameSession.snapshot().phaseDeadline;

    await service.adjustDiscussionTime(
      created.value.projection.sessionId,
      created.value.holderId,
      -10,
      expectedDeadline,
      'delayed-adjustment-starts-nomination-key',
    );
    await service.submitNomination(
      created.value.projection.sessionId,
      created.value.holderId,
      'participant-3',
      'human-nomination-during-agent-thinking-key',
    );
    vi.advanceTimersByTime(15_000);
    await flushMicrotasks();

    expect(session.gameSession.snapshot().phase).toBe('nomination');

    deferredNomination.resolve({ targetParticipantId: 'participant-2' });
    await flushMicrotasks();

    expect(session.gameSession.snapshot().nominations).toEqual(
      expect.arrayContaining([
        ['participant-1', 'participant-3'],
        ['participant-2', 'participant-2'],
        ['participant-3', 'participant-2'],
        ['participant-4', 'participant-2'],
        ['participant-5', 'participant-2'],
      ]),
    );
    service.onModuleDestroy();
  });

  it('consumes pending phase-entry actions when request hydration restores a session', async () => {
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const firstService = new GameSessionsService(agentDecisions);
    Object.assign(firstService, { authority });
    const created = await firstService.createMafiaSession(undefined, 5, 'pending-actions-key');
    if (created.isErr()) throw new Error('Expected a durable session.');
    const stored = await authority.load(created.value.projection.sessionId);
    if (stored.isErr() || !stored.value) throw new Error('Expected an authoritative snapshot.');
    await authority.saveSnapshot({ ...stored.value, agentActionsPending: true });

    const restartedService = new GameSessionsService(agentDecisions);
    Object.assign(restartedService, { authority });
    const holderId = created.value.holderId;
    await expect(
      restartedService.getProjection(created.value.projection.sessionId, holderId),
    ).resolves.toMatchObject({ value: { sessionId: created.value.projection.sessionId } });
    await expect(authority.load(created.value.projection.sessionId)).resolves.toMatchObject({
      value: { agentActionsPending: false },
    });
    redis.disconnect();
  });

  it('does not fail request hydration when a queued pending-action save fails', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-11T00:00:00.000Z') });
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const firstService = new GameSessionsService(agentDecisions);
    Object.assign(firstService, { authority });
    const created = await firstService.createMafiaSession(undefined, 5, 'pending-save-failure-key');
    if (created.isErr()) throw new Error('Expected a durable session.');
    const stored = await authority.load(created.value.projection.sessionId);
    if (stored.isErr() || !stored.value) throw new Error('Expected an authoritative snapshot.');
    await authority.saveSnapshot({
      ...stored.value,
      gameSession: { ...stored.value.gameSession, phase: 'nomination' },
      agentActionsPending: true,
    });

    const restartedService = new GameSessionsService(agentDecisions);
    Object.assign(restartedService, { authority });
    const save = vi
      .spyOn(authority, 'save')
      .mockImplementationOnce(() =>
        errAsync({ type: 'authority-unavailable', cause: 'write failed' }),
      );
    const holderId = created.value.holderId;

    await expect(
      restartedService.getProjection(created.value.projection.sessionId, holderId),
    ).resolves.toMatchObject({ value: { sessionId: created.value.projection.sessionId } });
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);

    await expect(authority.load(created.value.projection.sessionId)).resolves.toMatchObject({
      value: { agentActionsPending: true },
    });

    firstService.onModuleDestroy();
    restartedService.onModuleDestroy();
    redis.disconnect();
  });

  it('retains a pending Agent Mafia Night Chat reply after request hydration', async () => {
    vi.useFakeTimers();
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const firstService = new GameSessionsService(agentDecisions);
    Object.assign(firstService, { authority });
    const created = await firstService.createMafiaSession(undefined, 5, 'pending-mafia-chat-key');
    if (created.isErr()) throw new Error('Expected a durable session.');
    const stored = await authority.load(created.value.projection.sessionId);
    if (stored.isErr() || !stored.value) throw new Error('Expected an authoritative snapshot.');
    await authority.saveSnapshot({
      ...stored.value,
      scheduledAgentMafiaChatReplies: [
        {
          id: 'pending-reply',
          participantId: 'participant-1',
          content: 'I will commit my action.',
          dueAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    });

    const restartedService = new GameSessionsService(agentDecisions);
    Object.assign(restartedService, { authority });
    const holderId = created.value.holderId;
    await restartedService.getProjection(created.value.projection.sessionId, holderId);

    await expect(authority.load(created.value.projection.sessionId)).resolves.toMatchObject({
      value: {
        scheduledAgentMafiaChatReplies: [expect.objectContaining({ id: 'pending-reply' })],
      },
    });
    redis.disconnect();
  });

  it('retries durable Phase recovery after a transient startup failure', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-11T00:00:00.000Z') });
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const firstService = new GameSessionsService(agentDecisions);
    Object.assign(firstService, { authority });
    const created = await firstService.createMafiaSession(undefined, 5, 'startup-recovery-key');
    if (created.isErr()) throw new Error('Expected a durable session.');

    vi.clearAllTimers();
    vi.setSystemTime(new Date('2026-09-11T00:10:00.000Z'));
    const resolveExpiredPhase = vi
      .spyOn(authority, 'resolveExpiredPhase')
      .mockImplementationOnce(() =>
        errAsync({ type: 'authority-unavailable', cause: 'temporary' }),
      );
    const restartedService = new GameSessionsService(agentDecisions);
    Object.assign(restartedService, { authority });

    await restartedService.onModuleInit();
    await vi.advanceTimersByTimeAsync(1001);
    await vi.advanceTimersByTimeAsync(1);

    expect(resolveExpiredPhase).toHaveBeenCalledTimes(1);
    const recoveredEvents = await authority.eventsAfter(created.value.projection.sessionId, 1);
    if (recoveredEvents.isErr()) throw new Error('Expected recovered Phase events.');
    expect(recoveredEvents.value).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventId: 2 })]),
    );
    restartedService.onModuleDestroy();
    redis.disconnect();
  });

  it('does not treat an autonomous projection as Human Player activity', async () => {
    let now = new Date('2026-09-11T00:00:00.000Z');
    const service = new GameSessionsService(
      {
        decidePublicSpeech: () => ({ type: 'remain-silent' }),
        decideFinalDefence: () => ({
          opening: 'I will defend myself.',
          followUp: 'Please listen.',
        }),
        decideMafiaChatOpening: () => 'I propose a target.',
        decideMafiaChatReply: () => 'I will commit my action.',
        selectMafiaTarget: () => undefined,
      },
      {
        now: () => now,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
      },
    );
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a Game Session.');
    const sessions = (
      service as unknown as {
        sessions: Map<string, { lastAccessedAt: { toISOString(): string } }>;
      }
    ).sessions;

    now = new Date('2026-09-11T00:16:00.000Z');
    expect(service.publishSessionProjection(created.value.projection.sessionId)).toMatchObject({
      value: { sessionId: created.value.projection.sessionId },
    });
    expect(sessions.get(created.value.projection.sessionId)?.lastAccessedAt.toISOString()).toBe(
      '2026-09-11T00:00:00.000Z',
    );
  });

  it('converges concurrent idempotent creation requests on one Redis session', async () => {
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const left = new GameSessionsService(agentDecisions);
    const right = new GameSessionsService(agentDecisions);
    Object.assign(left, { authority });
    Object.assign(right, { authority });
    const holderId = 'holder-race';
    const [first, second] = await Promise.all([
      left.createMafiaSession(holderId, 5, 'same-request'),
      right.createMafiaSession(holderId, 5, 'same-request'),
    ]);
    expect(first).toMatchObject({ value: { projection: { sessionId: expect.any(String) } } });
    expect(second).toMatchObject({ value: { projection: { sessionId: expect.any(String) } } });
    if (first.isErr() || second.isErr()) throw new Error('Expected idempotent creation results.');
    expect(second.value.projection.sessionId).toBe(first.value.projection.sessionId);
    redis.disconnect();
  });

  it('converges concurrent creation requests from separate tabs on the active session', async () => {
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const firstTab = new GameSessionsService(agentDecisions);
    const secondTab = new GameSessionsService(agentDecisions);
    Object.assign(firstTab, { authority });
    Object.assign(secondTab, { authority });
    const holderId = 'holder-multi-tab';

    const [first, second] = await Promise.all([
      firstTab.createMafiaSession(holderId, 5, 'first-tab-request'),
      secondTab.createMafiaSession(holderId, 5, 'second-tab-request'),
    ]);

    if (first.isErr() || second.isErr()) throw new Error('Expected a shared active session.');
    expect(first.value.projection.sessionId).toBe(second.value.projection.sessionId);
    redis.disconnect();
  });

  it('returns session-not-found when a Creation Idempotency Key refers to an expired session', async () => {
    let now = new Date();
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(
      redis,
      'withai:expired-creation-key-test',
      () => now,
    );
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    Object.assign(service, { authority });
    const created = await service.createMafiaSession(undefined, 5, 'expired-creation-key');
    if (created.isErr()) throw new Error('Expected a durable session.');

    now = new Date(now.valueOf() + 16 * 60 * 1000);
    await expect(authority.expireInactiveSessions()).resolves.toEqual({ value: undefined });

    await expect(
      service.createMafiaSession(created.value.holderId, 6, 'expired-creation-key'),
    ).resolves.toEqual({
      error: { type: 'session-not-found', sessionId: created.value.projection.sessionId },
    });
    redis.disconnect();
  });

  it('recovers an expired phase when its timer was missed before a snapshot is read', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(undefined, 5, undefined);

    expect(created.isOk()).toBe(true);
    if (created.isErr()) throw new Error('Expected a session.');

    vi.clearAllTimers();
    vi.setSystemTime(new Date('2026-08-27T17:13:51.001Z'));

    const holderId = created.value.holderId;
    expect(await service.getProjection(created.value.projection.sessionId, holderId)).toMatchObject(
      {
        value: {
          eventId: 3,
          public: { dayNumber: 1, phase: 'discussion' },
        },
      },
    );
  });

  it('recovers an expired phase when another replica still holds its deadline claim', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis, 'withai:stale-claim-read-test');
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const service = new GameSessionsService(agentDecisions);
    Object.assign(service, { authority });
    const created = await service.createMafiaSession(undefined, 5, 'stale-claim-read-key');
    if (created.isErr()) throw new Error('Expected a durable session.');

    vi.clearAllTimers();
    vi.setSystemTime(new Date('2026-08-27T17:13:51.001Z'));
    const holderId = created.value.holderId;
    const discussion = await service.getProjection(created.value.projection.sessionId, holderId);
    if (discussion.isErr()) throw new Error('Expected the night phase to recover.');

    vi.clearAllTimers();
    vi.setSystemTime(new Date(Date.parse(discussion.value.public.phaseDeadline) + 1));
    vi.spyOn(authority, 'claimPhaseDeadline').mockReturnValueOnce(okAsync(false));

    await expect(
      service.getProjection(created.value.projection.sessionId, holderId),
    ).resolves.toMatchObject({ value: { public: { phase: 'nomination' } } });
    redis.disconnect();
  });

  it('retries a phase timer that fires before its deadline', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a session.');

    vi.spyOn(MafiaGameSession.prototype, 'advanceDayPhase').mockImplementationOnce(() =>
      ok({ type: 'not-due' }),
    );

    const deadlineMs = Date.parse(created.value.projection.public.phaseDeadline) - Date.now();
    await vi.advanceTimersByTimeAsync(deadlineMs);
    await vi.advanceTimersByTimeAsync(1);

    expect(service.publishSessionProjection(created.value.projection.sessionId)).toMatchObject({
      value: { public: { phase: 'discussion' } },
    });
  });

  it('retries a phase timer after an authority claim failure', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis, 'withai:claim-retry-test');
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    Object.assign(service, { authority });
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a durable session.');
    const claimPhaseDeadline = vi
      .spyOn(authority, 'claimPhaseDeadline')
      .mockReturnValueOnce(
        errAsync({ type: 'authority-unavailable', cause: new Error('offline') }),
      );

    const deadlineMs = Date.parse(created.value.projection.public.phaseDeadline) - Date.now();
    await vi.advanceTimersByTimeAsync(deadlineMs);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.runOnlyPendingTimersAsync();

    expect(claimPhaseDeadline).toHaveBeenCalledTimes(2);
    redis.disconnect();
  });

  it('retries a phase timer after another replica holds its deadline claim', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis, 'withai:claim-lease-retry-test');
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    Object.assign(service, { authority });
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a durable session.');
    const claimPhaseDeadline = vi
      .spyOn(authority, 'claimPhaseDeadline')
      .mockReturnValueOnce(okAsync(false));

    const deadlineMs = Date.parse(created.value.projection.public.phaseDeadline) - Date.now();
    await vi.advanceTimersByTimeAsync(deadlineMs);
    await vi.advanceTimersByTimeAsync(0);
    expect(claimPhaseDeadline).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(claimPhaseDeadline).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.runOnlyPendingTimersAsync();

    expect(claimPhaseDeadline).toHaveBeenCalledTimes(2);
    redis.disconnect();
  });

  it('does not subscribe to SSE after the client disconnects during hydration', async () => {
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const controller = new GameSessionsController(service);
    type EventsResult = Result<Observable<MafiaGameSessionProjectionEntity>, GameSessionError>;
    const eventsFor = createDeferred<EventsResult>();
    vi.spyOn(service, 'eventsFor').mockReturnValue(eventsFor.promise);
    const request = Object.assign(new EventEmitter(), {
      destroyed: false,
      headers: {},
    }) as unknown as Request;
    const flushHeaders = vi.fn();
    const write = vi.fn();
    const response = {
      end: vi.fn(),
      flushHeaders,
      set: vi.fn(),
      write,
    } as unknown as Response;
    let subscribed = false;
    const events = new Observable<MafiaGameSessionProjectionEntity>(() => {
      subscribed = true;
    });

    const handling = controller.events('session-id', request, response);
    request.emit('close');
    eventsFor.resolve(ok(events));
    await handling;

    expect(subscribed).toBe(false);
    expect(flushHeaders).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps a durable SSE session alive during local idle cleanup', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-11T00:00:00.000Z') });
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    Object.assign(service, { authority });
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a durable session.');
    const holderId = created.value.holderId;
    const events = await service.eventsFor(created.value.projection.sessionId, holderId, undefined);
    if (events.isErr()) throw new Error('Expected a durable SSE stream.');
    const subscription = events.value.subscribe();
    await expect(
      service.getProjection(created.value.projection.sessionId, holderId),
    ).resolves.toMatchObject({
      value: { sessionId: created.value.projection.sessionId },
    });
    const state = service as unknown as {
      lifecycle: { cleanupExpiredSessions(): Promise<void> };
      eventSubscriberCounts: Map<string, number>;
      sessions: Map<string, unknown>;
    };

    vi.setSystemTime(new Date('2026-09-11T00:15:01.000Z'));
    await state.lifecycle.cleanupExpiredSessions();

    expect(state.eventSubscriberCounts.get(created.value.projection.sessionId)).toBe(1);
    expect(state.sessions.has(created.value.projection.sessionId)).toBe(true);

    subscription.unsubscribe();

    expect(state.eventSubscriberCounts.has(created.value.projection.sessionId)).toBe(false);
    redis.disconnect();
  });

  it('retains a durable phase timer after a request hydrates the session', async () => {
    let now = new Date('2026-08-27T17:11:51.000Z');
    type TestTimer = {
      callback: () => void;
      deadline: number;
      cancelled: boolean;
    };
    const timerMetadata = new Map<NodeJS.Timeout, TestTimer>();
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const clock = {
      now: () => now,
      setTimeout: (callback: () => void, delayMs: number) => {
        const metadata = {
          callback,
          deadline: now.valueOf() + delayMs,
          cancelled: false,
        };
        const timer = setTimeout(() => undefined, delayMs);
        timer.unref();
        timerMetadata.set(timer, metadata);
        return timer;
      },
      clearTimeout: (timer: NodeJS.Timeout) => {
        const metadata = timerMetadata.get(timer);
        if (metadata) metadata.cancelled = true;
        clearTimeout(timer);
      },
      setInterval: (callback: () => void, delayMs: number) => setInterval(callback, delayMs),
      clearInterval: (timer: NodeJS.Timeout) => clearInterval(timer),
    };
    const service = new GameSessionsService(
      {
        decidePublicSpeech: () => ({ type: 'remain-silent' }),
        decideFinalDefence: () => ({
          opening: 'I will defend myself.',
          followUp: 'Please listen.',
        }),
        decideMafiaChatOpening: () => 'I propose a target.',
        decideMafiaChatReply: () => 'I will commit my action.',
        selectMafiaTarget: () => undefined,
      },
      clock,
    );
    Object.assign(service, { authority });
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a durable session.');
    const claimPhaseDeadline = vi.spyOn(authority, 'claimPhaseDeadline');
    const state = service as unknown as {
      sessions: Map<string, { phaseTimer: NodeJS.Timeout | undefined }>;
    };
    const holderId = created.value.holderId;
    const projection = await service.getProjection(created.value.projection.sessionId, holderId);
    expect(projection.isOk()).toBe(true);
    now = new Date(new Date(created.value.projection.public.phaseDeadline).valueOf() + 1);
    const session = state.sessions.get(created.value.projection.sessionId);
    const phaseTimer = session?.phaseTimer;
    if (!phaseTimer) throw new Error('Expected a phase timer.');
    const phaseTimerMetadata = timerMetadata.get(phaseTimer);
    if (!phaseTimerMetadata) throw new Error('Expected phase timer metadata.');
    phaseTimerMetadata.cancelled = true;
    phaseTimerMetadata.callback();
    await vi.waitFor(() => expect(claimPhaseDeadline).toHaveBeenCalledTimes(1), {
      timeout: 1_000,
      interval: 10,
    });

    await vi.waitFor(async () => {
      await expect(
        authority.eventsAfter(created.value.projection.sessionId, 0),
      ).resolves.toMatchObject({
        value: expect.arrayContaining([
          expect.objectContaining({
            projection: expect.objectContaining({
              public: expect.objectContaining({ phase: 'discussion' }),
            }),
          }),
        ]),
      });
    });
    redis.disconnect();
  });

  it('throttles Discussion Time Adjustments while allowing an idempotent retry', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a session.');

    const holderId = created.value.holderId;
    vi.clearAllTimers();
    vi.setSystemTime(new Date(Date.parse(created.value.projection.public.phaseDeadline) + 1));
    const discussion = await service.getProjection(created.value.projection.sessionId, holderId);
    if (discussion.isErr()) throw new Error('Expected the initial Night to resolve.');
    const { phaseDeadline } = discussion.value.public;
    const first = await service.adjustDiscussionTime(
      created.value.projection.sessionId,
      holderId,
      10,
      phaseDeadline,
      'first-discussion-time-adjustment-key',
    );
    expect(first.isOk()).toBe(true);
    if (first.isErr()) throw new Error('Expected a Discussion Time Adjustment.');
    const { phaseDeadline: adjustedDeadline } = first.value.public;

    expect(
      await service.adjustDiscussionTime(
        created.value.projection.sessionId,
        holderId,
        -10,
        adjustedDeadline,
        'second-discussion-time-adjustment-key',
      ),
    ).toEqual({
      error: { type: 'discussion-time-adjustment-rate-limited', retryAfterMs: 1000 },
    });
    expect(
      await service.adjustDiscussionTime(
        created.value.projection.sessionId,
        holderId,
        10,
        phaseDeadline,
        'first-discussion-time-adjustment-key',
      ),
    ).toEqual(first);
    expect(
      await service.adjustDiscussionTime(
        created.value.projection.sessionId,
        holderId,
        10,
        adjustedDeadline,
        'first-discussion-time-adjustment-key',
      ),
    ).toEqual({ error: { type: 'discussion-time-adjustment-idempotency-conflict' } });
  });

  it('rejects a Discussion Time Adjustment for a stale Phase deadline', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a session.');

    const holderId = created.value.holderId;
    vi.clearAllTimers();
    vi.setSystemTime(new Date(Date.parse(created.value.projection.public.phaseDeadline) + 1));
    const discussion = await service.getProjection(created.value.projection.sessionId, holderId);
    if (discussion.isErr()) throw new Error('Expected the initial Night to resolve.');
    expect(
      await service.adjustDiscussionTime(
        created.value.projection.sessionId,
        holderId,
        10,
        '2026-08-27T17:11:50.000Z',
        'stale-discussion-time-adjustment-key',
      ),
    ).toEqual({ error: { type: 'stale-discussion-time-adjustment' } });
  });
});
