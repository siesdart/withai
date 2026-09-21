import type { MafiaAgentContext } from '@repo/mafia';
import { chat } from '@tanstack/ai';
import { geminiText, GeminiThinkingOptions } from '@tanstack/ai-gemini';
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import { filter, findLast } from 'remeda';
import * as v from 'valibot';

import { createStructuredLogger, type StructuredLogger } from '../../logging/structured-logger.js';
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
      nextSpeakerParticipantId?: string;
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

export type AgentMafiaTargetOptions = {
  abortController?: AbortController;
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
  selectMafiaTarget(
    context: MafiaAgentContext,
    options?: AgentMafiaTargetOptions,
  ): MaybePromise<string | undefined>;
};

export const agentDecisionGateway = Symbol('agent-decision-gateway');

export type AgentDecisionRunner = (
  prompt: AgentDecisionPrompt,
  outputSchema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
  thinkingConfig?: GeminiThinkingOptions['thinkingConfig'],
  abortController?: AbortController,
) => Promise<unknown>;

const maximumDecisionAttempts = 3;
export const agentDecisionAttemptTimeoutMs = 10_000;

const tanstackRunner: AgentDecisionRunner = async (
  { systemPrompts, userPrompt },
  outputSchema,
  thinkingConfig,
  abortController,
) => {
  return chat({
    adapter: geminiText(
      process.env.NODE_ENV === 'production' ? 'gemini-3.8-flash' : 'gemini-3.1-flash-lite',
    ),
    systemPrompts,
    messages: [{ role: 'user', content: userPrompt }],
    outputSchema: toStandardJsonSchema(outputSchema),
    modelOptions: process.env.NODE_ENV === 'production' ? { thinkingConfig } : undefined,
    stream: false,
    abortController,
  });
};

export class LLMAgentDecisionGateway implements AgentDecisionGateway {
  readonly outputLanguage: AgentOutputLanguage;

  constructor(
    private readonly runDecision: AgentDecisionRunner = tanstackRunner,
    outputLanguage: AgentOutputLanguage = 'ko',
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {
    this.outputLanguage = outputLanguage;
  }

  forLanguage(outputLanguage: AgentOutputLanguage): AgentDecisionGateway {
    return new LLMAgentDecisionGateway(this.runDecision, outputLanguage, this.logger);
  }

  decidePublicSpeech(
    context: MafiaAgentContext,
    options?: AgentPublicSpeechOptions,
  ): Promise<AgentPublicSpeechDecision> {
    return this.withFallback(
      'public-speech',
      context,
      buildAgentDecisionPrompt(
        'Choose whether to send short public chat now. For either outcome, choose nextSpeakerParticipantId from the supplied eligible IDs. For remain-silent, set content to empty string.',
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
      { thinkingLevel: 'MEDIUM' },
      options?.abortController,
    ).then(toPublicSpeechDecision);
  }

  decideFinalDefence(context: MafiaAgentContext): Promise<AgentFinalDefence> {
    return this.withFallback(
      'final-defence',
      context,
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
      { thinkingLevel: 'LOW' },
    );
  }

  decidePhaseAction(
    context: MafiaAgentContext,
    candidateParticipantIds: readonly string[],
  ): Promise<AgentPhaseActionDecision> {
    if (context.public.phase === 'verdict') return this.decideVerdict(context);
    return this.withFallback(
      'phase-action',
      context,
      buildAgentDecisionPrompt(
        participantActionInstructionFor(context, candidateParticipantIds),
        context,
        this.outputLanguage,
      ),
      participantActionSchema,
      fallbackParticipantAction(context, candidateParticipantIds),
      { thinkingLevel: 'MEDIUM' },
      undefined,
      (decision) =>
        candidateParticipantIds.length === 0 ||
        (decision.targetParticipantId !== undefined &&
          candidateParticipantIds.includes(decision.targetParticipantId)),
    ).then(toPhaseActionDecision);
  }

  private decideVerdict(context: MafiaAgentContext): Promise<AgentPhaseActionDecision> {
    return this.withFallback(
      'verdict',
      context,
      buildAgentDecisionPrompt(
        'Choose verdict for current nominee. Return eliminate or spare only.',
        context,
        this.outputLanguage,
      ),
      verdictSchema,
      fallbackVerdict(context),
      { thinkingLevel: 'LOW' },
    ).then(toPhaseActionDecision);
  }

  async decideMafiaChatOpening(context: MafiaAgentContext, targetName: string): Promise<string> {
    const decision = await this.withFallback(
      'mafia-chat-opening',
      context,
      buildAgentDecisionPrompt(
        `Write short private Mafia Night Chat opening to coordinate a Night-target choice involving ${targetName}.`,
        context,
        this.outputLanguage,
      ),
      contentSchema,
      { content: fallbackText(this.outputLanguage, 'mafiaWait') },
      { thinkingLevel: 'LOW' },
    );
    return decision.content;
  }

  async decideMafiaChatReply(context: MafiaAgentContext, targetName: string): Promise<string> {
    const decision = await this.withFallback(
      'mafia-chat-reply',
      context,
      buildAgentDecisionPrompt(
        `Write short private Mafia Night Chat reply to coordinate a Night-target choice involving ${targetName}.`,
        context,
        this.outputLanguage,
      ),
      contentSchema,
      { content: fallbackText(this.outputLanguage, 'mafiaWait') },
      { thinkingLevel: 'LOW' },
    );
    return decision.content;
  }

  async selectMafiaTarget(
    context: MafiaAgentContext,
    options?: AgentMafiaTargetOptions,
  ): Promise<string | undefined> {
    const decision = await this.withFallback(
      'mafia-target',
      context,
      buildAgentDecisionPrompt(
        'Choose living Mafia Night target by participant id.',
        context,
        this.outputLanguage,
      ),
      mafiaTargetSchema,
      { targetParticipantId: undefined },
      { thinkingLevel: 'MEDIUM' },
      options?.abortController,
    );
    return filter(
      context.public.participants,
      ({ alive, id }) => alive && id === decision.targetParticipantId,
    )[0]?.id;
  }

  private async withFallback<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
    operation: string,
    context: MafiaAgentContext,
    prompt: AgentDecisionPrompt,
    schema: TSchema,
    fallback: v.InferOutput<TSchema>,
    thinkingConfig?: GeminiThinkingOptions['thinkingConfig'],
    abortController?: AbortController,
    isValidOutput: (output: v.InferOutput<TSchema>) => boolean = () => true,
  ): Promise<v.InferOutput<TSchema>> {
    let lastFailure: unknown = { type: 'no-valid-output' };
    for (let attempt = 1; attempt <= maximumDecisionAttempts; attempt += 1) {
      if (abortController?.signal.aborted) return fallback;
      try {
        // oxlint-disable-next-line no-await-in-loop -- retries are intentionally sequential.
        const response = await this.runDecisionForAttempt(
          prompt,
          schema,
          thinkingConfig,
          abortController,
        );
        const parsed = v.safeParse(schema, response);
        if (parsed.success && isValidOutput(parsed.output)) {
          if (attempt > 1) {
            this.logger.warn(
              {
                operation,
                phase: context.public.phase,
                agentRole: context.personal.role,
                attempt,
                maximumAttempts: maximumDecisionAttempts,
              },
              'Agent decision recovered after retry',
            );
          }
          return parsed.output;
        }
        lastFailure = parsed.success
          ? { type: 'domain-validation-failed' }
          : { type: 'schema-validation-failed', issueCount: parsed.issues.length };
      } catch (cause) {
        if (abortController?.signal.aborted) return fallback;
        lastFailure = cause;
        // A transient provider failure is retried within the bounded decision budget.
      }
    }
    this.logger.warn(
      {
        operation,
        phase: context.public.phase,
        agentRole: context.personal.role,
        attempts: maximumDecisionAttempts,
        ...(lastFailure instanceof Error ? { err: lastFailure } : { failure: lastFailure }),
      },
      'Agent decision retries exhausted; using fallback response',
    );
    return fallback;
  }

  private async runDecisionForAttempt(
    prompt: AgentDecisionPrompt,
    schema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
    thinkingConfig: GeminiThinkingOptions['thinkingConfig'],
    abortController: AbortController | undefined,
  ) {
    const attemptAbortController = new AbortController();
    const abortAttempt = () => attemptAbortController.abort();
    abortController?.signal.addEventListener('abort', abortAttempt, { once: true });
    if (abortController?.signal.aborted) abortAttempt();
    let timeout: NodeJS.Timeout | undefined;
    let rejectAbort: (() => void) | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => {
        const cause = new Error('Agent decision attempt was aborted');
        cause.name = 'AbortError';
        reject(cause);
      };
      const rejectTimeout = () => {
        abortAttempt();
        reject(new Error('Agent decision attempt timed out'));
      };
      abortController?.signal.addEventListener('abort', rejectAbort, { once: true });
      if (abortController?.signal.aborted) rejectAbort();
      timeout = setTimeout(rejectTimeout, agentDecisionAttemptTimeoutMs);
    });
    try {
      return await Promise.race([
        this.runDecision(prompt, schema, thinkingConfig, attemptAbortController),
        interrupted,
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (rejectAbort) abortController?.signal.removeEventListener('abort', rejectAbort);
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
      ...(decision.nextSpeakerParticipantId
        ? { nextSpeakerParticipantId: decision.nextSpeakerParticipantId }
        : {}),
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
Set nextSpeakerParticipantId to one ID from this list who you think should speak next: ${JSON.stringify(candidateParticipantIds)}. If you don't have a clear and strict person to think should speak next, choose to be silent based on recent conversations or omit it.`;

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

  selectMafiaTarget(
    context: MafiaAgentContext,
    _options?: AgentMafiaTargetOptions,
  ): string | undefined {
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
