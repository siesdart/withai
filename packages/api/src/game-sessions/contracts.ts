import {
  MafiaGameProjectionSchema,
  type MafiaGameProjection,
  type MafiaOutputLanguage,
} from '@repo/mafia/client';
import * as v from 'valibot';

export { MafiaGameProjectionSchema };
export type { MafiaGameProjection, MafiaOutputLanguage };

export type CreateMafiaGameSessionRequest = {
  participantCount?: number;
  humanName?: string;
  outputLanguage?: MafiaOutputLanguage;
};
export type CreatePublicSpeechRequest = { content: string };
export type CreateMafiaChatRequest = { content: string };
export type CreateNominationRequest = { targetParticipantId: string };
export type CreateVerdictRequest = { vote: 'eliminate' | 'spare' };
export type CreateDiscussionTimeAdjustmentRequest = {
  adjustmentSeconds: 10 | -10;
  expectedDeadline: string;
};

export const ActiveMafiaGameSessionSchema = v.object({
  projection: MafiaGameProjectionSchema,
  outputLanguage: v.picklist(['ko', 'en']),
});
export type ActiveMafiaGameSession = {
  projection: MafiaGameProjection;
  outputLanguage: MafiaOutputLanguage;
};

export const GuestPlayAllowanceSchema = v.object({
  remaining: v.pipe(v.number(), v.integer(), v.minValue(0)),
  limit: v.pipe(v.number(), v.integer(), v.minValue(1)),
  resetsAt: v.pipe(v.string(), v.isoTimestamp()),
});
export type GuestPlayAllowance = v.InferOutput<typeof GuestPlayAllowanceSchema>;

export const GameSessionApiErrorSchema = v.variant('type', [
  v.object({ type: v.literal('holder-token-invalid') }),
  v.object({ type: v.literal('unavailable'), status: v.picklist([403, 404] as const) }),
  v.object({ type: v.literal('action-rejected'), status: v.picklist([400, 409] as const) }),
  v.object({ type: v.literal('rate-limited'), retryAfterMs: v.number() }),
  v.object({ type: v.literal('aborted') }),
  v.object({ type: v.literal('invalid-event'), cause: v.unknown() }),
  v.object({ type: v.literal('request-failed'), cause: v.unknown() }),
]);
export type GameSessionApiError = v.InferOutput<typeof GameSessionApiErrorSchema>;
