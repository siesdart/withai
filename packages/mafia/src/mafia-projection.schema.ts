import { map } from 'remeda';
import * as v from 'valibot';

import type { MafiaGameProjection } from './mafia-game-session';

const MafiaPhaseSchema = v.picklist([
  'day-discussion',
  'nomination',
  'final-defence',
  'verdict',
  'completed',
] as const);
const MafiaAllegianceSchema = v.picklist(['Mafia', 'Citizen'] as const);
const MafiaParticipantSchema = v.object({ id: v.string(), name: v.string(), alive: v.boolean() });
const NominationVoteCountSchema = v.object({ participantId: v.string(), voteCount: v.number() });
const VoteStatusSchema = v.variant('phase', [
  v.object({ phase: v.literal('nomination'), submittedParticipantIds: v.array(v.string()) }),
  v.object({ phase: v.literal('verdict'), submittedParticipantIds: v.array(v.string()) }),
]);
const PublicOutcomeSchema = v.variant('type', [
  v.object({
    id: v.string(),
    type: v.literal('nomination-resolved'),
    dayNumber: v.number(),
    result: v.picklist(['nominated', 'nomination-tie', 'no-nomination'] as const),
    nominatedParticipantId: v.optional(v.string()),
    leadingVoteCount: v.number(),
    voteCounts: v.array(NominationVoteCountSchema),
  }),
  v.object({
    id: v.string(),
    type: v.literal('verdict-resolved'),
    dayNumber: v.number(),
    participantId: v.string(),
    result: v.picklist(['eliminate', 'verdict-tie', 'no-majority'] as const),
    eliminateVotes: v.number(),
    spareVotes: v.number(),
    requiredEliminateVotes: v.number(),
  }),
  v.object({ id: v.string(), type: v.literal('day-changed'), dayNumber: v.number() }),
  v.object({
    id: v.string(),
    type: v.literal('phase-time-adjusted'),
    dayNumber: v.number(),
    phase: v.picklist(['day-discussion', 'nomination', 'final-defence', 'verdict'] as const),
    adjustmentSeconds: v.picklist([10, -10] as const),
  }),
  v.object({
    id: v.string(),
    type: v.literal('phase-changed'),
    dayNumber: v.number(),
    phase: MafiaPhaseSchema,
  }),
  v.object({
    id: v.string(),
    type: v.literal('allegiance-reveal'),
    participantId: v.string(),
    allegiance: MafiaAllegianceSchema,
  }),
  v.object({ id: v.string(), type: v.literal('victory'), allegiance: MafiaAllegianceSchema }),
]);
const PublicTimelineItemSchema = v.variant('type', [
  v.object({
    id: v.string(),
    type: v.literal('chat'),
    message: v.object({ id: v.string(), participantId: v.string(), content: v.string() }),
  }),
  v.object({ id: v.string(), type: v.literal('record'), outcome: PublicOutcomeSchema }),
]);
const CompletedVoteRecordSchema = v.object({
  id: v.string(),
  dayNumber: v.number(),
  phase: v.picklist(['nomination', 'verdict'] as const),
  votes: v.array(
    v.union([
      v.object({ participantId: v.string(), targetParticipantId: v.string() }),
      v.object({ participantId: v.string(), vote: v.picklist(['eliminate', 'spare'] as const) }),
    ]),
  ),
});

const MafiaGameProjectionPayloadSchema = v.object({
  eventId: v.number(),
  sessionId: v.string(),
  public: v.object({
    dayNumber: v.number(),
    phase: MafiaPhaseSchema,
    phaseDeadline: v.string(),
    participants: v.array(MafiaParticipantSchema),
    nominatedParticipantId: v.optional(v.string()),
    voteStatus: v.optional(VoteStatusSchema),
    timeline: v.array(PublicTimelineItemSchema),
    completedVoteRecords: v.array(CompletedVoteRecordSchema),
  }),
  personal: v.object({
    participantId: v.string(),
    role: v.picklist(['Mafia', 'Detective', 'Doctor', 'Citizen'] as const),
    allegiance: MafiaAllegianceSchema,
    vote: v.optional(
      v.variant('phase', [
        v.object({ phase: v.literal('nomination'), targetParticipantId: v.string() }),
        v.object({
          phase: v.literal('verdict'),
          vote: v.picklist(['eliminate', 'spare'] as const),
        }),
      ]),
    ),
  }),
});

type ParsedMafiaGameProjection = v.InferOutput<typeof MafiaGameProjectionPayloadSchema>;
type MafiaPublicOutcome = Extract<
  MafiaGameProjection['public']['timeline'][number],
  { type: 'record' }
>['outcome'];

function normalizePublicOutcome(
  outcome: v.InferOutput<typeof PublicOutcomeSchema>,
): MafiaPublicOutcome {
  return outcome.type === 'nomination-resolved'
    ? { ...outcome, nominatedParticipantId: outcome.nominatedParticipantId }
    : outcome;
}

function normalizeMafiaGameProjection(projection: ParsedMafiaGameProjection): MafiaGameProjection {
  return {
    ...projection,
    public: {
      ...projection.public,
      nominatedParticipantId: projection.public.nominatedParticipantId,
      voteStatus: projection.public.voteStatus,
      timeline: map(projection.public.timeline, (item) =>
        item.type === 'record' ? { ...item, outcome: normalizePublicOutcome(item.outcome) } : item,
      ),
    },
    personal: { ...projection.personal, vote: projection.personal.vote },
  };
}

export const MafiaGameProjectionSchema: v.GenericSchema<unknown, MafiaGameProjection> = v.pipe(
  MafiaGameProjectionPayloadSchema,
  v.transform(normalizeMafiaGameProjection),
);
