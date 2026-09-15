import type { MafiaAgentContext } from '@repo/mafia';
import { toJsonSchema } from '@valibot/to-json-schema';
import { describe, expect, it, vi } from 'vitest';

import {
  type AgentDecisionRunner,
  agentDecisionAttemptTimeoutMs,
  DeterministicAgentDecisionGateway,
  LLMAgentDecisionGateway,
} from '../../../src/game-sessions/agents/agent-decision.gateway.js';

describe('DeterministicAgentDecisionGateway', () => {
  it('always supplies an opening and follow-up for an Agent Final Defence', () => {
    const context: MafiaAgentContext = {
      participant: { id: 'participant-2', name: 'Mina' },
      persona: 'Mina is observant and concise.',
      timeline: [],
      public: {
        dayNumber: 1,
        phase: 'final-defence',
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [],
        nominatedParticipantId: 'participant-2',
        completedRecords: { voteRecords: [], nightActionRecords: [] },
      },
      personal: {
        participantId: 'participant-2',
        role: 'Citizen',
        allegiance: 'Citizen',
        vote: undefined,
        nightAction: undefined,
        knownRoles: [],
      },
    };

    expect(new DeterministicAgentDecisionGateway().decideFinalDefence(context)).toEqual({
      opening: '저 말고 근거부터 봐줘요.',
      followUp: '제 입장은 같아요.',
    });
  });
});

describe('LLMAgentDecisionGateway', () => {
  it('keeps a concrete reasoning move and a changed allegiance estimate from public speech', async () => {
    const gateway = new LLMAgentDecisionGateway(
      async () =>
        ({
          type: 'speak',
          content: 'Mina가 바로 지명 얘길 꺼낸 이유부터 듣고 싶어요.',
          reasoningMove: 'ask-question',
          allegianceEstimates: [
            {
              participantId: 'participant-1',
              mafiaProbability: 65,
              basis: 'Mina raised a nomination without an explanation.',
            },
          ],
          strategy: 'Ask Mina to explain the nomination before voting.',
        }) as const,
    );
    const context = {
      participant: { id: 'participant-2', name: 'Joon' },
      persona: 'Joon is observant and concise.',
      memory: {
        revision: 1,
        allegianceEstimates: [],
        strategy: 'Compare claims with the public timeline.',
      },
      timeline: [],
      public: {
        dayNumber: 1,
        phase: 'discussion' as const,
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [],
        nominatedParticipantId: undefined,
        completedRecords: { voteRecords: [], nightActionRecords: [] },
      },
      personal: {
        participantId: 'participant-2',
        role: 'Citizen' as const,
        allegiance: 'Citizen' as const,
        vote: undefined,
        nightAction: undefined,
        knownRoles: [],
      },
    } satisfies MafiaAgentContext;

    await expect(gateway.decidePublicSpeech(context)).resolves.toMatchObject({
      type: 'speak',
      reasoningMove: 'ask-question',
      allegianceEstimates: [{ participantId: 'participant-1', mafiaProbability: 65 }],
      strategy: 'Ask Mina to explain the nomination before voting.',
    });
  });

  it('allows a public speech with a concrete reasoning move without duplicating a text memory summary', async () => {
    const gateway = new LLMAgentDecisionGateway(async () => ({
      type: 'speak',
      content: '일단 신중히 보죠.',
      reasoningMove: 'conditional-read',
    }));
    const context = {
      participant: { id: 'participant-2', name: 'Joon' },
      persona: 'Joon is observant and concise.',
      timeline: [],
      public: {
        dayNumber: 1,
        phase: 'discussion' as const,
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [],
        nominatedParticipantId: undefined,
        completedRecords: { voteRecords: [], nightActionRecords: [] },
      },
      personal: {
        participantId: 'participant-2',
        role: 'Citizen' as const,
        allegiance: 'Citizen' as const,
        vote: undefined,
        nightAction: undefined,
        knownRoles: [],
      },
    } satisfies MafiaAgentContext;

    await expect(gateway.decidePublicSpeech(context)).resolves.toMatchObject({
      type: 'speak',
      reasoningMove: 'conditional-read',
    });
  });

  it('sends a LLM request when an Agent Mafia must select the Night target', async () => {
    const gateway = new LLMAgentDecisionGateway(async () => ({
      targetParticipantId: 'participant-3',
    }));
    const context = {
      participant: { id: 'participant-2', name: 'Joon' },
      persona: 'Joon is observant and concise.',
      timeline: [],
      public: {
        dayNumber: 1,
        phase: 'night' as const,
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [
          { id: 'participant-1', name: 'You', alive: true },
          { id: 'participant-2', name: 'Joon', alive: true },
          { id: 'participant-3', name: 'Sora', alive: true },
        ],
        nominatedParticipantId: undefined,
        completedRecords: { voteRecords: [], nightActionRecords: [] },
      },
      personal: {
        participantId: 'participant-2',
        role: 'Mafia' as const,
        allegiance: 'Mafia' as const,
        vote: undefined,
        nightAction: undefined,
        knownRoles: [],
      },
    } satisfies MafiaAgentContext;

    await expect(gateway.selectMafiaTarget(context)).resolves.toBe('participant-3');
  });

  it('returns a Mafia Night Chat opening from the decision runner', async () => {
    const gateway = new LLMAgentDecisionGateway(async () => ({
      content: '첫날이라 정보는 없지만 Sora로 갈까요?',
    }));
    const context = {
      participant: { id: 'participant-2', name: 'Joon' },
      persona: 'Joon is observant and concise.',
      timeline: [],
      public: {
        dayNumber: 1,
        phase: 'night' as const,
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [
          { id: 'participant-1', name: 'You', alive: true },
          { id: 'participant-2', name: 'Joon', alive: true },
          { id: 'participant-3', name: 'Sora', alive: true },
        ],
        nominatedParticipantId: undefined,
        completedRecords: { voteRecords: [], nightActionRecords: [] },
      },
      personal: {
        participantId: 'participant-2',
        role: 'Mafia' as const,
        allegiance: 'Mafia' as const,
        vote: undefined,
        nightAction: undefined,
        knownRoles: [],
      },
    } satisfies MafiaAgentContext;

    await expect(gateway.decideMafiaChatOpening(context, 'Sora')).resolves.toBe(
      '첫날이라 정보는 없지만 Sora로 갈까요?',
    );
  });

  it('uses only LLM-supported keywords for public-speech output', async () => {
    let providerSchema: Parameters<AgentDecisionRunner>[1] | undefined;
    const gateway = new LLMAgentDecisionGateway(async (_prompt, outputSchema) => {
      providerSchema = outputSchema;
      return { type: 'remain-silent', content: '' };
    });
    const context = {
      participant: { id: 'participant-2', name: 'Mina' },
      persona: 'Mina is observant and concise.',
      timeline: [],
      public: {
        dayNumber: 1,
        phase: 'discussion' as const,
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [],
        nominatedParticipantId: undefined,
        completedRecords: { voteRecords: [], nightActionRecords: [] },
      },
      personal: {
        participantId: 'participant-2',
        role: 'Citizen' as const,
        allegiance: 'Citizen' as const,
        vote: undefined,
        nightAction: undefined,
        knownRoles: [],
      },
    } satisfies MafiaAgentContext;

    await expect(gateway.decidePublicSpeech(context)).resolves.toEqual({ type: 'remain-silent' });

    if (!providerSchema)
      throw new Error('Expected the decision runner to receive an output schema.');
    const jsonSchema = toJsonSchema(providerSchema, { target: 'openapi-3.0' });
    expect(JSON.stringify(jsonSchema)).not.toContain('"const"');
    expect(JSON.stringify(jsonSchema)).not.toContain('"oneOf"');
    expect(JSON.stringify(jsonSchema)).toContain('"enum"');
    expect(JSON.stringify(jsonSchema)).toContain('"maxLength":160');
  });

  it('uses a deterministic legal phase-action fallback after bounded failures', async () => {
    const gateway = new LLMAgentDecisionGateway(async () => {
      throw new Error('provider unavailable');
    });
    const context = {
      participant: { id: 'participant-2', name: 'Mina' },
      persona: 'Mina is observant and concise.',
      memory: {
        revision: 3,
        allegianceEstimates: [],
        strategy: 'Wait for evidence.',
      },
      timeline: [],
      public: {
        dayNumber: 1,
        phase: 'nomination' as const,
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [],
        nominatedParticipantId: undefined,
        completedRecords: { voteRecords: [], nightActionRecords: [] },
      },
      personal: {
        participantId: 'participant-2',
        role: 'Citizen' as const,
        allegiance: 'Citizen' as const,
        vote: undefined,
        nightAction: undefined,
        knownRoles: [],
      },
    } satisfies MafiaAgentContext;

    await expect(
      gateway.decidePhaseAction(context, ['participant-3', 'participant-4']),
    ).resolves.toMatchObject({
      targetParticipantId: expect.stringMatching(/^participant-[34]$/),
    });
  });

  it('retries and falls back when a provider returns a candidate outside the advertised set', async () => {
    const gateway = new LLMAgentDecisionGateway(async () => ({
      targetParticipantId: 'participant-999',
    }));
    const context = {
      participant: { id: 'participant-2', name: 'Mina' },
      persona: 'Mina is observant and concise.',
      timeline: [],
      public: {
        dayNumber: 1,
        phase: 'nomination' as const,
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [],
        nominatedParticipantId: undefined,
        completedRecords: { voteRecords: [], nightActionRecords: [] },
      },
      personal: {
        participantId: 'participant-2',
        role: 'Citizen' as const,
        allegiance: 'Citizen' as const,
        vote: undefined,
        nightAction: undefined,
        knownRoles: [],
      },
    } satisfies MafiaAgentContext;

    await expect(gateway.decidePhaseAction(context, ['participant-3'])).resolves.toMatchObject({
      targetParticipantId: 'participant-3',
    });
  });

  it('bounds a stalled provider attempt and continues with the next attempt', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const gateway = new LLMAgentDecisionGateway(async (_prompt, _schema, abortController) => {
      calls += 1;
      if (calls > 1)
        return { opening: 'fallback-safe opening', followUp: 'fallback-safe follow-up' };
      return new Promise((_, reject) => {
        abortController?.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const context = {
      participant: { id: 'participant-2', name: 'Mina' },
      persona: 'Mina is observant and concise.',
      timeline: [],
      public: {
        dayNumber: 1,
        phase: 'final-defence' as const,
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [],
        nominatedParticipantId: 'participant-2',
        completedRecords: { voteRecords: [], nightActionRecords: [] },
      },
      personal: {
        participantId: 'participant-2',
        role: 'Citizen' as const,
        allegiance: 'Citizen' as const,
        vote: undefined,
        nightAction: undefined,
        knownRoles: [],
      },
    } satisfies MafiaAgentContext;

    const decision = gateway.decideFinalDefence(context);
    await vi.advanceTimersByTimeAsync(agentDecisionAttemptTimeoutMs);
    await expect(decision).resolves.toEqual({
      opening: 'fallback-safe opening',
      followUp: 'fallback-safe follow-up',
    });
    vi.useRealTimers();
  });

  it('uses separate schema contracts for targets and verdicts', async () => {
    const schemas: Parameters<AgentDecisionRunner>[1][] = [];
    const gateway = new LLMAgentDecisionGateway(async (_prompt, schema) => {
      schemas.push(schema);
      return schemas.length === 2 ? { verdict: 'spare' } : { targetParticipantId: 'participant-3' };
    });
    const context = {
      participant: { id: 'participant-2', name: 'Mina' },
      persona: 'Mina is observant and concise.',
      timeline: [],
      public: {
        dayNumber: 1,
        phase: 'nomination' as const,
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [],
        nominatedParticipantId: undefined,
        completedRecords: { voteRecords: [], nightActionRecords: [] },
      },
      personal: {
        participantId: 'participant-2',
        role: 'Citizen' as const,
        allegiance: 'Citizen' as const,
        vote: undefined,
        nightAction: undefined,
        knownRoles: [],
      },
    } satisfies MafiaAgentContext;

    await expect(gateway.decidePhaseAction(context, ['participant-3'])).resolves.toMatchObject({
      targetParticipantId: 'participant-3',
    });
    await expect(
      gateway.decidePhaseAction(
        {
          ...context,
          public: { ...context.public, phase: 'verdict', nominatedParticipantId: 'participant-3' },
        },
        [],
      ),
    ).resolves.toMatchObject({ verdict: 'spare' });

    expect(JSON.stringify(toJsonSchema(schemas[0], { target: 'openapi-3.0' }))).toContain(
      '"targetParticipantId"',
    );
    expect(JSON.stringify(toJsonSchema(schemas[0], { target: 'openapi-3.0' }))).not.toContain(
      '"verdict"',
    );
    expect(JSON.stringify(toJsonSchema(schemas[1], { target: 'openapi-3.0' }))).toContain(
      '"verdict"',
    );
    expect(JSON.stringify(toJsonSchema(schemas[1], { target: 'openapi-3.0' }))).not.toContain(
      '"targetParticipantId"',
    );
  });

  it('uses the bounded fallback for malformed decisions', async () => {
    let decisionCount = 0;
    const gateway = new LLMAgentDecisionGateway(async () => {
      decisionCount += 1;
      return decisionCount === 1 ? { type: 'speak', content: '' } : { type: 'remain-silent' };
    });
    const context: MafiaAgentContext = {
      participant: { id: 'participant-2', name: 'Mina' },
      persona: 'Mina is observant and concise.',
      public: {
        dayNumber: 1,
        phase: 'discussion',
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [],
        nominatedParticipantId: undefined,
        completedRecords: { voteRecords: [], nightActionRecords: [] },
      },
      personal: {
        participantId: 'participant-2',
        role: 'Mafia',
        allegiance: 'Mafia',
        vote: undefined,
        nightAction: undefined,
        knownRoles: [],
      },
      timeline: [
        {
          id: 'public-1',
          type: 'chat',
          message: { participantId: 'participant-1', content: 'hello' },
        },
        {
          id: 'private-1',
          type: 'mafia-chat',
          message: {
            dayNumber: 1,
            participantId: 'participant-3',
            content: 'shared Mafia Night Chat',
          },
        },
      ],
    };

    await expect(gateway.decidePublicSpeech(context)).resolves.toEqual({ type: 'remain-silent' });
  });

  it('falls back safely after the bounded provider retry budget is exhausted', async () => {
    const gateway = new LLMAgentDecisionGateway(async () => {
      throw new Error('provider unavailable');
    });
    const context = {
      participant: { id: 'participant-2', name: 'Mina' },
      persona: 'Mina is observant and concise.',
      timeline: [],
      public: {
        dayNumber: 1,
        phase: 'discussion' as const,
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [],
        nominatedParticipantId: undefined,
        completedRecords: { voteRecords: [], nightActionRecords: [] },
      },
      personal: {
        participantId: 'participant-2',
        role: 'Citizen' as const,
        allegiance: 'Citizen' as const,
        vote: undefined,
        nightAction: undefined,
        knownRoles: [],
      },
    } satisfies MafiaAgentContext;

    await expect(gateway.decidePublicSpeech(context)).resolves.toEqual({ type: 'remain-silent' });
  });
});
