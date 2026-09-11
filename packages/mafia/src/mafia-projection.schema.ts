import { map } from 'remeda';
import * as v from 'valibot';

import type { MafiaGameProjection, MafiaGameSessionSnapshot } from './mafia-game-session';

const MafiaPhaseSchema = v.picklist([
  'discussion',
  'nomination',
  'final-defence',
  'verdict',
  'night',
  'completed',
] as const);
const MafiaRoleSchema = v.picklist(['Mafia', 'Detective', 'Doctor', 'Citizen'] as const);
const MafiaAllegianceSchema = v.picklist(['Mafia', 'Citizen'] as const);
const MafiaParticipantSchema = v.object({ id: v.string(), name: v.string(), alive: v.boolean() });
const MafiaChatMessageSchema = v.object({
  dayNumber: v.number(),
  participantId: v.string(),
  content: v.string(),
});
const NominationVoteCountSchema = v.object({ participantId: v.string(), voteCount: v.number() });
const PublicOutcomeSchema = v.variant('type', [
  v.object({
    type: v.literal('nomination-resolved'),
    dayNumber: v.number(),
    result: v.picklist(['nominated', 'nomination-tie', 'no-nomination'] as const),
    nominatedParticipantId: v.optional(v.string()),
    leadingVoteCount: v.number(),
    voteCounts: v.array(NominationVoteCountSchema),
  }),
  v.object({
    type: v.literal('verdict-resolved'),
    dayNumber: v.number(),
    participantId: v.string(),
    result: v.picklist(['eliminate', 'verdict-tie', 'no-majority'] as const),
    eliminateVotes: v.number(),
    spareVotes: v.number(),
    requiredEliminateVotes: v.number(),
  }),
  v.object({ type: v.literal('day-changed'), dayNumber: v.number() }),
  v.object({
    type: v.literal('discussion-time-adjusted'),
    dayNumber: v.number(),
    adjustmentSeconds: v.picklist([10, -10] as const),
  }),
  v.object({
    type: v.literal('phase-changed'),
    dayNumber: v.number(),
    phase: MafiaPhaseSchema,
  }),
  v.object({
    type: v.literal('allegiance-reveal'),
    participantId: v.string(),
    allegiance: MafiaAllegianceSchema,
  }),
  v.object({ type: v.literal('victory'), allegiance: MafiaAllegianceSchema }),
  v.object({
    type: v.literal('night-resolved'),
    dayNumber: v.number(),
    result: v.picklist(['no-death', 'protected', 'participant-eliminated'] as const),
    participantId: v.optional(v.string()),
  }),
]);
const PublicTimelineItemVariants = [
  v.object({
    id: v.string(),
    type: v.literal('chat'),
    message: v.object({ participantId: v.string(), content: v.string() }),
  }),
  v.object({ id: v.string(), type: v.literal('record'), outcome: PublicOutcomeSchema }),
];
const PersonalTimelineItemSchema = v.variant('type', [
  ...PublicTimelineItemVariants,
  v.object({
    id: v.string(),
    type: v.literal('mafia-chat'),
    message: MafiaChatMessageSchema,
  }),
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
const CompletedNightActionSchema = v.object({
  participantId: v.string(),
  targetParticipantId: v.optional(v.string()),
});
const CompletedNightActionRecordSchema = v.object({
  id: v.string(),
  dayNumber: v.number(),
  mafiaTargetParticipantId: v.optional(v.string()),
  doctorActions: v.array(CompletedNightActionSchema),
  detectiveActions: v.array(CompletedNightActionSchema),
});

const SnapshotParticipantSchema = v.object({
  id: v.string(),
  name: v.string(),
  alive: v.boolean(),
  role: MafiaRoleSchema,
});

export const MafiaGameSessionSnapshotSchema: v.GenericSchema<unknown, MafiaGameSessionSnapshot> =
  v.pipe(
    v.object({
      sessionId: v.string(),
      participants: v.array(SnapshotParticipantSchema),
      dayDurations: v.object({
        discussionDurationMs: v.number(),
        nominationDurationMs: v.number(),
        finalDefenceDurationMs: v.number(),
        verdictDurationMs: v.number(),
        nightDurationMs: v.number(),
      }),
      timeline: v.array(PersonalTimelineItemSchema),
      timelineItemCounts: v.array(
        v.tuple([v.picklist(['chat', 'record', 'mafia-chat'] as const), v.number()]),
      ),
      nominations: v.array(v.tuple([v.string(), v.string()])),
      verdicts: v.array(v.tuple([v.string(), v.picklist(['eliminate', 'spare'] as const)])),
      mafiaTargetParticipantId: v.optional(v.string()),
      doctorProtections: v.array(v.tuple([v.string(), v.string()])),
      detectiveInvestigations: v.array(v.tuple([v.string(), v.string()])),
      detectiveInvestigationHistory: v.array(
        v.tuple([v.string(), v.array(v.tuple([v.string(), MafiaAllegianceSchema]))]),
      ),
      completedVoteRecords: v.array(CompletedVoteRecordSchema),
      completedNightActionRecords: v.array(CompletedNightActionRecordSchema),
      phase: MafiaPhaseSchema,
      phaseDeadline: v.string(),
      nominatedParticipantId: v.optional(v.string()),
      dayNumber: v.number(),
    }),
    v.transform((snapshot): MafiaGameSessionSnapshot => ({
      ...snapshot,
      timeline: normalizeSnapshotTimeline(snapshot.timeline),
      completedNightActionRecords: normalizeCompletedNightActionRecords(
        snapshot.completedNightActionRecords,
      ),
      mafiaTargetParticipantId: snapshot.mafiaTargetParticipantId,
      nominatedParticipantId: snapshot.nominatedParticipantId,
    })),
  );

const MafiaGameProjectionPayloadSchema = v.object({
  eventId: v.number(),
  sessionId: v.string(),
  timeline: v.array(PersonalTimelineItemSchema),
  public: v.object({
    dayNumber: v.number(),
    phase: MafiaPhaseSchema,
    phaseDeadline: v.string(),
    participants: v.array(MafiaParticipantSchema),
    nominatedParticipantId: v.optional(v.string()),
    completedRecords: v.object({
      voteRecords: v.array(CompletedVoteRecordSchema),
      nightActionRecords: v.array(CompletedNightActionRecordSchema),
    }),
  }),
  personal: v.object({
    participantId: v.string(),
    role: MafiaRoleSchema,
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
    nightAction: v.optional(
      v.variant('type', [
        v.object({ type: v.literal('mafia-target'), targetParticipantId: v.string() }),
        v.object({ type: v.literal('doctor-protection'), targetParticipantId: v.string() }),
        v.object({
          type: v.literal('detective-investigation'),
          targetParticipantId: v.string(),
        }),
      ]),
    ),
    knownRoles: v.array(v.object({ participantId: v.string(), role: MafiaRoleSchema })),
  }),
});

type ParsedMafiaGameProjection = v.InferOutput<typeof MafiaGameProjectionPayloadSchema>;
type MafiaPublicOutcome = Extract<
  MafiaGameProjection['timeline'][number],
  { type: 'record' }
>['outcome'];

function normalizePublicOutcome(
  outcome: v.InferOutput<typeof PublicOutcomeSchema>,
): MafiaPublicOutcome {
  return outcome.type === 'nomination-resolved'
    ? { ...outcome, nominatedParticipantId: outcome.nominatedParticipantId }
    : outcome;
}

function normalizeSnapshotTimeline(
  timeline: v.InferOutput<typeof PersonalTimelineItemSchema>[],
): MafiaGameSessionSnapshot['timeline'] {
  return map(timeline, (item) =>
    item.type === 'record' ? { ...item, outcome: normalizePublicOutcome(item.outcome) } : item,
  );
}

function normalizeCompletedNightActionRecords(
  records: v.InferOutput<typeof CompletedNightActionRecordSchema>[],
): MafiaGameSessionSnapshot['completedNightActionRecords'] {
  return map(records, (record) => ({
    ...record,
    mafiaTargetParticipantId: record.mafiaTargetParticipantId,
    doctorActions: map(record.doctorActions, (action) => ({
      ...action,
      targetParticipantId: action.targetParticipantId,
    })),
    detectiveActions: map(record.detectiveActions, (action) => ({
      ...action,
      targetParticipantId: action.targetParticipantId,
    })),
  }));
}

function normalizeMafiaGameProjection(projection: ParsedMafiaGameProjection): MafiaGameProjection {
  return {
    ...projection,
    timeline: map(projection.timeline, (item) =>
      item.type === 'record' ? { ...item, outcome: normalizePublicOutcome(item.outcome) } : item,
    ),
    public: {
      ...projection.public,
      nominatedParticipantId: projection.public.nominatedParticipantId,
      completedRecords: {
        voteRecords: projection.public.completedRecords.voteRecords,
        nightActionRecords: map(
          projection.public.completedRecords.nightActionRecords,
          (record) => ({
            ...record,
            mafiaTargetParticipantId: record.mafiaTargetParticipantId,
            doctorActions: map(record.doctorActions, (action) => ({
              ...action,
              targetParticipantId: action.targetParticipantId,
            })),
            detectiveActions: map(record.detectiveActions, (action) => ({
              ...action,
              targetParticipantId: action.targetParticipantId,
            })),
          }),
        ),
      },
    },
    personal: {
      ...projection.personal,
      vote: projection.personal.vote,
      nightAction: projection.personal.nightAction,
      knownRoles: projection.personal.knownRoles,
    },
  };
}

export const MafiaGameProjectionSchema: v.GenericSchema<unknown, MafiaGameProjection> = v.pipe(
  MafiaGameProjectionPayloadSchema,
  v.transform(normalizeMafiaGameProjection),
);
