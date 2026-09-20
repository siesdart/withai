import * as v from 'valibot';

export const allegianceEstimateSchema = v.object({
  participantId: v.string(),
  mafiaProbability: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)),
  roleProbabilities: v.optional(
    v.object({
      policeProbability: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)),
      doctorProbability: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)),
    }),
  ),
  basis: v.pipe(v.string(), v.maxLength(160)),
});

/**
 * Keep provider-facing output schemas within Gemini's OpenAPI subset. In
 * particular, `v.literal` and `v.variant` serialize as `const` and `oneOf`,
 * which Gemini rejects. Conditional requirements are restored after parsing.
 */
export const publicSpeechDecisionSchema = v.object({
  type: v.picklist(['speak', 'remain-silent'] as const),
  content: v.pipe(v.string(), v.maxLength(160)),
  reasoningMove: v.picklist([
    'cite-evidence',
    'challenge-claim',
    'conditional-read',
    'ask-question',
    'none',
  ] as const),
  nextSpeakerParticipantId: v.optional(v.string()),
  allegianceEstimates: v.optional(v.array(allegianceEstimateSchema)),
  strategy: v.optional(v.pipe(v.string(), v.maxLength(240))),
});

export const finalDefenceSchema = v.object({
  opening: v.pipe(v.string(), v.minLength(1), v.maxLength(160)),
  followUp: v.pipe(v.string(), v.minLength(1), v.maxLength(160)),
});

export const contentSchema = v.object({
  content: v.pipe(v.string(), v.minLength(1), v.maxLength(160)),
});

export const mafiaTargetSchema = v.object({ targetParticipantId: v.optional(v.string()) });

export const participantActionSchema = v.object({
  targetParticipantId: v.optional(v.string()),
  allegianceEstimates: v.optional(v.array(allegianceEstimateSchema)),
  strategy: v.optional(v.pipe(v.string(), v.maxLength(240))),
});

export const verdictSchema = v.object({
  verdict: v.picklist(['eliminate', 'spare'] as const),
  allegianceEstimates: v.optional(v.array(allegianceEstimateSchema)),
  strategy: v.optional(v.pipe(v.string(), v.maxLength(240))),
});

export type PublicSpeechDecisionOutput = v.InferOutput<typeof publicSpeechDecisionSchema>;
