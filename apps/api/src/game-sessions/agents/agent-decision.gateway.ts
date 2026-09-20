import type { MafiaAgentContext } from '@repo/mafia';
import { chat } from '@tanstack/ai';
import { geminiText } from '@tanstack/ai-gemini';
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import { filter, findLast } from 'remeda';
import * as v from 'valibot';

import {
  buildAgentDecisionPrompt,
  type AgentDecisionPrompt,
  type AgentOutputLanguage,
  publicSpeechConversationProgressPolicy,
} from './agent-decision-prompt.js';
import {
  contentSchema,
  finalDefenceSchema,
  mafiaTargetSchema,
  participantActionSchema,
  publicSpeechDecisionSchema,
  type PublicSpeechDecisionOutput,
  verdictSchema,
} from './agent-decision.schemas.js';
import type { AgentAllegianceEstimate } from './agent-mind.js';

export type { AgentOutputLanguage } from './agent-decision-prompt.js';

export type AgentPublicSpeechDecision =
  | {
      type: 'speak';
      content: string;
      reasoningMove?: AgentReasoningMove;
      allegianceEstimates?: AgentAllegianceEstimate[];
      strategy?: string;
    }
  | {
      type: 'remain-silent';
      nextSpeakerParticipantId?: string;
      allegianceEstimates?: AgentAllegianceEstimate[];
      strategy?: string;
    };

type AgentReasoningMove = 'cite-evidence' | 'challenge-claim' | 'conditional-read' | 'ask-question';
type PublicSpeechReasoningOutput = PublicSpeechDecisionOutput & {
  reasoningMove: AgentReasoningMove;
};

export type AgentPublicSpeechOptions = {
  abortController?: AbortController;
  candidateParticipantIds?: readonly string[];
};

export type AgentFinalDefence = {
  opening: string;
  followUp: string;
};

export type AgentPhaseActionDecision = {
  targetParticipantId?: string;
  verdict?: 'eliminate' | 'spare';
  allegianceEstimates?: AgentAllegianceEstimate[];
  strategy?: string;
};

type AgentParticipantActionDecision = Pick<AgentPhaseActionDecision, 'targetParticipantId'>;
type AgentVerdictDecision = AgentPhaseActionDecision & { verdict: 'eliminate' | 'spare' };

type MaybePromise<T> = T | Promise<T>;

export type AgentDecisionGateway = {
  readonly outputLanguage?: AgentOutputLanguage;
  forLanguage?(outputLanguage: AgentOutputLanguage): AgentDecisionGateway;
  decidePublicSpeech(
    context: MafiaAgentContext,
    options?: AgentPublicSpeechOptions,
  ): MaybePromise<AgentPublicSpeechDecision>;
  decideFinalDefence(context: MafiaAgentContext): MaybePromise<AgentFinalDefence>;
  decidePhaseAction?(
    context: MafiaAgentContext,
    candidateParticipantIds: readonly string[],
  ): MaybePromise<AgentPhaseActionDecision>;
  decideMafiaChatOpening(context: MafiaAgentContext, targetName: string): MaybePromise<string>;
  decideMafiaChatReply(context: MafiaAgentContext, targetName: string): MaybePromise<string>;
  selectMafiaTarget(context: MafiaAgentContext): MaybePromise<string | undefined>;
};

export const agentDecisionGateway = Symbol('agent-decision-gateway');

export type AgentDecisionRunner = (
  prompt: AgentDecisionPrompt,
  outputSchema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
  abortController?: AbortController,
) => Promise<unknown>;

const maximumDecisionAttempts = 3;
export const agentDecisionAttemptTimeoutMs = 10_000;

const tanstackRunner: AgentDecisionRunner = async (
  { systemPrompts, userPrompt },
  outputSchema,
  abortController,
) => {
  return chat({
    adapter: geminiText(
      process.env.NODE_ENV === 'production' ? 'gemini-3.8-flash' : 'gemini-3.1-flash-lite',
    ),
    systemPrompts,
    messages: [{ role: 'user', content: userPrompt }],
    outputSchema: toStandardJsonSchema(outputSchema),
    modelOptions: {
      thinkingConfig: {
        thinkingLevel: 'LOW',
      },
    },
    stream: false,
    abortController,
  });
};

export class LLMAgentDecisionGateway implements AgentDecisionGateway {
  readonly outputLanguage: AgentOutputLanguage;

  constructor(
    private readonly runDecision: AgentDecisionRunner = tanstackRunner,
    outputLanguage: AgentOutputLanguage = 'ko',
  ) {
    this.outputLanguage = outputLanguage;
  }

  forLanguage(outputLanguage: AgentOutputLanguage): AgentDecisionGateway {
    return new LLMAgentDecisionGateway(this.runDecision, outputLanguage);
  }

  decidePublicSpeech(
    context: MafiaAgentContext,
    options?: AgentPublicSpeechOptions,
  ): Promise<AgentPublicSpeechDecision> {
    return this.withFallback(
      buildAgentDecisionPrompt(
        'Choose whether to send short public chat now. For remain-silent, set content to empty string and set nextSpeakerParticipantId.',
        context,
        this.outputLanguage,
        {
          additionalSystemPrompts: [
            publicSpeechConversationProgressPolicy,
            publicSpeechRoutingPolicy(options?.candidateParticipantIds ?? []),
          ],
        },
      ),
      publicSpeechDecisionSchema,
      {
        type: 'remain-silent',
        content: '',
        reasoningMove: 'none',
      },
      options?.abortController,
    ).then(toPublicSpeechDecision);
  }

  decideFinalDefence(context: MafiaAgentContext): Promise<AgentFinalDefence> {
    return this.withFallback(
      buildAgentDecisionPrompt(
        'Write this Agent Final Defence opening and follow-up.',
        context,
        this.outputLanguage,
      ),
      finalDefenceSchema,
      {
        opening: fallbackText(this.outputLanguage, 'finalDefenceOpening'),
        followUp: fallbackText(this.outputLanguage, 'finalDefenceFollowUp'),
      },
    );
  }

  decidePhaseAction(
    context: MafiaAgentContext,
    candidateParticipantIds: readonly string[],
  ): Promise<AgentPhaseActionDecision> {
    if (context.public.phase === 'verdict') return this.decideVerdict(context);
    return this.withFallback(
      buildAgentDecisionPrompt(
        participantActionInstructionFor(context, candidateParticipantIds),
        context,
        this.outputLanguage,
      ),
      participantActionSchema,
      fallbackParticipantAction(context, candidateParticipantIds),
      undefined,
      (decision) =>
        candidateParticipantIds.length === 0 ||
        (decision.targetParticipantId !== undefined &&
          candidateParticipantIds.includes(decision.targetParticipantId)),
    ).then(toPhaseActionDecision);
  }

  private decideVerdict(context: MafiaAgentContext): Promise<AgentPhaseActionDecision> {
    return this.withFallback(
      buildAgentDecisionPrompt(
        'Choose verdict for current nominee. Return eliminate or spare only.',
        context,
        this.outputLanguage,
      ),
      verdictSchema,
      fallbackVerdict(context),
    ).then(toPhaseActionDecision);
  }

  async decideMafiaChatOpening(context: MafiaAgentContext, targetName: string): Promise<string> {
    const decision = await this.withFallback(
      buildAgentDecisionPrompt(
        `Write short private Mafia Night Chat opening to coordinate a Night-target choice involving ${targetName}.`,
        context,
        this.outputLanguage,
      ),
      contentSchema,
      { content: fallbackText(this.outputLanguage, 'mafiaWait') },
    );
    return decision.content;
  }

  async decideMafiaChatReply(context: MafiaAgentContext, targetName: string): Promise<string> {
    const decision = await this.withFallback(
      buildAgentDecisionPrompt(
        `Write short private Mafia Night Chat reply to coordinate a Night-target choice involving ${targetName}.`,
        context,
        this.outputLanguage,
      ),
      contentSchema,
      { content: fallbackText(this.outputLanguage, 'mafiaWait') },
    );
    return decision.content;
  }

  async selectMafiaTarget(context: MafiaAgentContext): Promise<string | undefined> {
    const decision = await this.withFallback(
      buildAgentDecisionPrompt(
        'Choose living Mafia Night target by participant id.',
        context,
        this.outputLanguage,
      ),
      mafiaTargetSchema,
      { targetParticipantId: undefined },
    );
    return filter(
      context.public.participants,
      ({ alive, id }) => alive && id === decision.targetParticipantId,
    )[0]?.id;
  }

  private async withFallback<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
    prompt: AgentDecisionPrompt,
    schema: TSchema,
    fallback: v.InferOutput<TSchema>,
    abortController?: AbortController,
    isValidOutput: (output: v.InferOutput<TSchema>) => boolean = () => true,
  ): Promise<v.InferOutput<TSchema>> {
    for (let attempt = 1; attempt <= maximumDecisionAttempts; attempt += 1) {
      if (abortController?.signal.aborted) return fallback;
      try {
        const start = new Date();
        // oxlint-disable-next-line no-await-in-loop -- retries are intentionally sequential.
        const response = await this.runDecisionForAttempt(prompt, schema, abortController);
        const end = new Date();
        console.log(
          `Agent decision attempt ${attempt} response (${(end.getTime() - start.getTime()) / 1000} s) :`,
          response,
        );
        const parsed = v.safeParse(schema, response);
        if (parsed.success && isValidOutput(parsed.output)) return parsed.output;
      } catch {
        if (abortController?.signal.aborted) return fallback;
        // A transient provider failure is retried within the bounded decision budget.
      }
    }
    return fallback;
  }

  private async runDecisionForAttempt(
    prompt: AgentDecisionPrompt,
    schema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
    abortController: AbortController | undefined,
  ) {
    const attemptAbortController = new AbortController();
    const abortAttempt = () => attemptAbortController.abort();
    abortController?.signal.addEventListener('abort', abortAttempt, { once: true });
    if (abortController?.signal.aborted) abortAttempt();
    const timeout = setTimeout(abortAttempt, agentDecisionAttemptTimeoutMs);
    try {
      return await this.runDecision(prompt, schema, attemptAbortController);
    } finally {
      clearTimeout(timeout);
      abortController?.signal.removeEventListener('abort', abortAttempt);
    }
  }
}

const toPublicSpeechDecision = (
  decision: PublicSpeechDecisionOutput,
): AgentPublicSpeechDecision => {
  const allegianceEstimates = decision.allegianceEstimates;
  if (
    decision.type === 'speak' &&
    decision.content.length > 0 &&
    hasPublicReasoningMove(decision)
  ) {
    return {
      type: 'speak',
      content: decision.content,
      reasoningMove: decision.reasoningMove,
      ...(allegianceEstimates ? { allegianceEstimates } : {}),
      ...(decision.strategy ? { strategy: decision.strategy } : {}),
    };
  }
  return {
    type: 'remain-silent',
    ...(decision.nextSpeakerParticipantId
      ? { nextSpeakerParticipantId: decision.nextSpeakerParticipantId }
      : {}),
    ...(allegianceEstimates ? { allegianceEstimates } : {}),
    ...(decision.strategy ? { strategy: decision.strategy } : {}),
  };
};

const publicSpeechRoutingPolicy = (candidateParticipantIds: readonly string[]) =>
  `# Next Agent routing
If you choose remain-silent, set nextSpeakerParticipantId to one ID from this list who you think should speak next: ${JSON.stringify(candidateParticipantIds)}. This field is internal routing data; do not mention it in player-visible content.`;

const hasPublicReasoningMove = (
  decision: PublicSpeechDecisionOutput,
): decision is PublicSpeechReasoningOutput => decision.reasoningMove !== 'none';

const toPhaseActionDecision = (
  decision: v.InferOutput<typeof participantActionSchema> | v.InferOutput<typeof verdictSchema>,
): AgentPhaseActionDecision => ({
  ...decision,
  ...(decision.allegianceEstimates ? { allegianceEstimates: decision.allegianceEstimates } : {}),
  ...(decision.strategy ? { strategy: decision.strategy } : {}),
});

export class DeterministicAgentDecisionGateway implements AgentDecisionGateway {
  constructor(readonly outputLanguage: AgentOutputLanguage = 'ko') {}

  decidePublicSpeech(context: MafiaAgentContext): AgentPublicSpeechDecision {
    const latestChat = findLast(context.timeline, (item) => item.type === 'chat');
    if (
      (latestChat && latestChat.message.participantId === context.participant.id) ||
      stableIndex(context, 2) === 0
    ) {
      return { type: 'remain-silent' };
    }

    return {
      type: 'speak',
      content: fallbackText(
        this.outputLanguage,
        context.personal.allegiance === 'Mafia' ? 'mafiaPublicSpeech' : 'citizenPublicSpeech',
      ),
    };
  }

  decideFinalDefence(_context: MafiaAgentContext): AgentFinalDefence {
    return {
      opening: fallbackText(this.outputLanguage, 'finalDefenceOpening'),
      followUp: fallbackText(this.outputLanguage, 'finalDefenceFollowUp'),
    };
  }

  decidePhaseAction(
    context: MafiaAgentContext,
    candidateParticipantIds: readonly string[],
  ): AgentPhaseActionDecision {
    return context.public.phase === 'verdict'
      ? fallbackVerdict(context)
      : fallbackParticipantAction(context, candidateParticipantIds);
  }

  decideMafiaChatOpening(_context: MafiaAgentContext, targetName: string): string {
    return fallbackText(this.outputLanguage, 'mafiaOpening', targetName);
  }

  decideMafiaChatReply(_context: MafiaAgentContext, targetName: string): string {
    return fallbackText(this.outputLanguage, 'mafiaReply', targetName);
  }

  selectMafiaTarget(context: MafiaAgentContext): string | undefined {
    const targetParticipants = filter(context.public.participants, ({ alive }) => alive);
    return targetParticipants[stableIndex(context, targetParticipants.length)]?.id;
  }
}

const participantActionInstructionFor = (
  context: MafiaAgentContext,
  candidateParticipantIds: readonly string[],
) =>
  context.public.phase === 'nomination'
    ? `Choose nomination target. Valid participant ids: ${JSON.stringify(candidateParticipantIds)}. Return targetParticipantId only.`
    : `Choose ${context.personal.role} Night-action target. Valid participant ids: ${JSON.stringify(candidateParticipantIds)}. Return targetParticipantId only.`;

const fallbackParticipantAction = (
  context: MafiaAgentContext,
  candidateParticipantIds: readonly string[],
): AgentParticipantActionDecision => ({
  targetParticipantId:
    candidateParticipantIds[stableIndex(context, candidateParticipantIds.length)],
});

const fallbackVerdict = (context: MafiaAgentContext): AgentVerdictDecision => ({
  verdict: stableIndex(context, 2) === 0 ? 'eliminate' : 'spare',
});

const stableIndex = (context: MafiaAgentContext, length: number) => {
  if (length === 0) return 0;
  const seed = `${context.participant.id}:${context.persona}:${context.memory?.revision ?? 0}`;
  let value = 0;
  for (const character of seed) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return value % length;
};

type FallbackTextKey =
  | 'citizenPublicSpeech'
  | 'finalDefenceFollowUp'
  | 'finalDefenceOpening'
  | 'mafiaOpening'
  | 'mafiaPublicSpeech'
  | 'mafiaReply'
  | 'mafiaWait';

const fallbackText = (
  outputLanguage: AgentOutputLanguage,
  key: FallbackTextKey,
  targetName?: string,
) => {
  const korean: Record<FallbackTextKey, string> = {
    citizenPublicSpeech: '일단 근거 더 보고 가죠.',
    finalDefenceFollowUp: '제 입장은 같아요.',
    finalDefenceOpening: '저 말고 근거부터 봐줘요.',
    mafiaOpening: `오늘 밤 ${targetName} 쪽 볼까요?`,
    mafiaPublicSpeech: '지명은 좀 더 보고 하죠.',
    mafiaReply: `${targetName} 쪽으로 가죠.`,
    mafiaWait: '좀 더 보죠.',
  };
  const english: Record<FallbackTextKey, string> = {
    citizenPublicSpeech: 'Let’s get more evidence first.',
    finalDefenceFollowUp: 'My read hasn’t changed.',
    finalDefenceOpening: 'Look at the evidence, not guesses.',
    mafiaOpening: `How about ${targetName} tonight?`,
    mafiaPublicSpeech: 'Let’s not rush the nomination.',
    mafiaReply: `Let’s go with ${targetName}.`,
    mafiaWait: 'Let’s wait for more.',
  };
  return (outputLanguage === 'ko' ? korean : english)[key];
};
