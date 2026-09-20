import type { AuthorizedGameProjection, GameModuleSession } from '@repo/game-contract';
import dayjs from 'dayjs';
import { err, ok, type Result } from 'neverthrow';
import { filter, find, flatMap, map, pipe } from 'remeda';
import { match } from 'ts-pattern';

import { mafiaGameConfig, type MafiaDayDurations } from './config';
import { resolveNomination, resolveVerdict } from './day-resolution';
import {
  allegianceFor,
  toPersonalInformation,
  type MafiaAllegiance,
  type MafiaParticipant,
  type MafiaPersonalInformation,
} from './participants';
import type { MafiaPersonalTimelineItem, MafiaPhase, MafiaPublicOutcome } from './timeline';

export { mafiaGameConfig } from './config';

export type MafiaCompletedVoteRecord = {
  id: string;
  dayNumber: number;
  phase: 'nomination' | 'verdict';
  votes: ReadonlyArray<
    | { participantId: string; targetParticipantId: string }
    | { participantId: string; vote: 'eliminate' | 'spare' }
  >;
};
export type MafiaCompletedNightAction = {
  participantId: string;
  targetParticipantId: string | undefined;
};
export type MafiaCompletedNightActionRecord = {
  id: string;
  dayNumber: number;
  mafiaTargetParticipantId: string | undefined;
  doctorActions: ReadonlyArray<MafiaCompletedNightAction>;
  policeActions: ReadonlyArray<MafiaCompletedNightAction>;
};
export type MafiaCompletedRecords = {
  voteRecords: ReadonlyArray<MafiaCompletedVoteRecord>;
  nightActionRecords: ReadonlyArray<MafiaCompletedNightActionRecord>;
};
export type {
  MafiaPhase,
  MafiaPublicChatMessage,
  MafiaPublicOutcome,
  MafiaPublicTimelineItem,
} from './timeline';
export type MafiaPublicInformation = {
  dayNumber: number;
  phase: MafiaPhase;
  phaseDeadline: string;
  participants: ReadonlyArray<Omit<MafiaParticipant, 'role'>>;
  nominatedParticipantId: string | undefined;
  completedRecords: MafiaCompletedRecords;
};
export type MafiaProjectionError = { type: 'unknown-participant'; participantId: string };
export type MafiaActionError =
  | { type: 'unknown-participant'; participantId: string }
  | { type: 'dead-participant'; participantId: string }
  | { type: 'expired-phase'; phaseDeadline: string }
  | { type: 'invalid-phase'; phase: MafiaPhase }
  | { type: 'not-nominated-participant'; participantId: string }
  | { type: 'invalid-target'; participantId: string }
  | { type: 'invalid-night-action'; participantId: string }
  | { type: 'night-action-already-submitted'; participantId: string }
  | { type: 'invalid-public-speech' };
export type MafiaAgentContext = {
  participant: Pick<MafiaParticipant, 'id' | 'name'>;
  persona: string;
  memory?: {
    revision: number;
    allegianceEstimates: Array<{
      participantId: string;
      mafiaProbability: number;
      roleProbabilities?: {
        policeProbability: number;
        doctorProbability: number;
      };
      basis: string;
    }>;
    strategy: string;
    lastSnapshotKey?: string;
  };
  snapshotKey?: string;
  public: MafiaPublicInformation;
  personal: MafiaPersonalInformation;
  timeline: ReadonlyArray<MafiaPersonalTimelineItem>;
};
export type MafiaDayPhaseResult =
  | { type: 'not-due' }
  | { type: 'phase-advanced'; phase: 'nomination' | 'final-defence' | 'verdict' }
  | {
      type: 'day-restarted';
      reason: 'nomination-tie' | 'no-nomination' | 'verdict-tie' | 'no-majority';
    }
  | { type: 'participant-eliminated'; participantId: string }
  | { type: 'night-resolved'; result: 'protected' | 'no-death' | 'participant-eliminated' }
  | { type: 'game-completed'; winner: MafiaAllegiance };
export type MafiaGameSessionSnapshot = {
  sessionId: string;
  participants: MafiaParticipant[];
  dayDurations: MafiaDayDurations;
  timeline: MafiaPersonalTimelineItem[];
  timelineItemCounts: Array<[MafiaPersonalTimelineItem['type'], number]>;
  nominations: Array<[string, string]>;
  verdicts: Array<[string, 'eliminate' | 'spare']>;
  mafiaTargetParticipantId: string | undefined;
  doctorProtections: Array<[string, string]>;
  policeInvestigations: Array<[string, string]>;
  policeInvestigationHistory: Array<[string, Array<[string, MafiaAllegiance]>]>;
  completedVoteRecords: MafiaCompletedVoteRecord[];
  completedNightActionRecords: MafiaCompletedNightActionRecord[];
  phase: MafiaPhase;
  phaseDeadline: string;
  nominatedParticipantId: string | undefined;
  dayNumber: number;
};
export class MafiaGameSession implements GameModuleSession<
  MafiaPublicInformation,
  MafiaPersonalInformation,
  MafiaProjectionError
> {
  private readonly timeline: MafiaPersonalTimelineItem[] = [];
  private readonly timelineItemCounts = new Map<MafiaPersonalTimelineItem['type'], number>();
  private readonly nominations = new Map<string, string>();
  private readonly verdicts = new Map<string, 'eliminate' | 'spare'>();
  private mafiaTargetParticipantId: string | undefined;
  private readonly doctorProtections = new Map<string, string>();
  private readonly policeInvestigations = new Map<string, string>();
  private readonly policeInvestigationHistory = new Map<string, Map<string, MafiaAllegiance>>();
  private readonly completedVoteRecords: MafiaCompletedVoteRecord[] = [];
  private readonly completedNightActionRecords: MafiaCompletedNightActionRecord[] = [];
  private phase: MafiaPhase = 'night';
  private phaseDeadline: Date;
  private nominatedParticipantId: string | undefined;
  private dayNumber = 1;
  constructor(
    private readonly sessionId: string,
    private readonly participants: MafiaParticipant[],
    private readonly dayDurations: MafiaDayDurations,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.changePhase('night');
    this.phaseDeadline = new Date(this.now().valueOf() + dayDurations.nightDurationMs);
  }
  snapshot(): MafiaGameSessionSnapshot {
    return {
      sessionId: this.sessionId,
      participants: structuredClone(this.participants),
      dayDurations: { ...this.dayDurations },
      timeline: structuredClone(this.timeline),
      timelineItemCounts: [...this.timelineItemCounts],
      nominations: [...this.nominations],
      verdicts: [...this.verdicts],
      mafiaTargetParticipantId: this.mafiaTargetParticipantId,
      doctorProtections: [...this.doctorProtections],
      policeInvestigations: [...this.policeInvestigations],
      policeInvestigationHistory: map([...this.policeInvestigationHistory], ([id, values]) => [
        id,
        [...values],
      ]),
      completedVoteRecords: structuredClone(this.completedVoteRecords),
      completedNightActionRecords: structuredClone(this.completedNightActionRecords),
      phase: this.phase,
      phaseDeadline: this.phaseDeadline.toISOString(),
      nominatedParticipantId: this.nominatedParticipantId,
      dayNumber: this.dayNumber,
    };
  }
  static restore(
    snapshot: MafiaGameSessionSnapshot,
    now: () => Date = () => new Date(),
  ): MafiaGameSession {
    const session = new MafiaGameSession(
      snapshot.sessionId,
      structuredClone(snapshot.participants),
      snapshot.dayDurations,
      now,
    );
    session.timeline.splice(0, session.timeline.length, ...structuredClone(snapshot.timeline));
    session.timelineItemCounts.clear();
    for (const [type, count] of snapshot.timelineItemCounts)
      session.timelineItemCounts.set(type, count);
    session.nominations.clear();
    for (const [id, target] of snapshot.nominations) session.nominations.set(id, target);
    session.verdicts.clear();
    for (const [id, vote] of snapshot.verdicts) session.verdicts.set(id, vote);
    session.mafiaTargetParticipantId = snapshot.mafiaTargetParticipantId;
    session.doctorProtections.clear();
    for (const [id, target] of snapshot.doctorProtections)
      session.doctorProtections.set(id, target);
    session.policeInvestigations.clear();
    for (const [id, target] of snapshot.policeInvestigations)
      session.policeInvestigations.set(id, target);
    session.policeInvestigationHistory.clear();
    for (const [id, values] of snapshot.policeInvestigationHistory)
      session.policeInvestigationHistory.set(id, new Map(values));
    session.completedVoteRecords.splice(
      0,
      session.completedVoteRecords.length,
      ...structuredClone(snapshot.completedVoteRecords),
    );
    session.completedNightActionRecords.splice(
      0,
      session.completedNightActionRecords.length,
      ...structuredClone(snapshot.completedNightActionRecords),
    );
    session.phase = snapshot.phase;
    session.phaseDeadline = dayjs(snapshot.phaseDeadline).toDate();
    session.nominatedParticipantId = snapshot.nominatedParticipantId;
    session.dayNumber = snapshot.dayNumber;
    return session;
  }

  submitPublicSpeech(
    participantId: string,
    content: string,
    now = new Date(),
  ): Result<void, MafiaActionError> {
    return this.phase === 'discussion'
      ? this.submitSpeech(participantId, content, now)
      : err({ type: 'invalid-phase', phase: this.phase });
  }
  recordAutonomousPublicSpeechLimitReached(
    participantId: string,
  ): Result<void, MafiaProjectionError> {
    const participant = find(this.participants, ({ id }) => id === participantId);
    if (!participant) return err({ type: 'unknown-participant', participantId });
    this.timeline.push({
      id: this.nextTimelineItemId('personal-record'),
      type: 'personal-record',
      recipientParticipantId: participantId,
      outcome: { type: 'autonomous-public-speech-limit-reached', dayNumber: this.dayNumber },
    });
    return ok(undefined);
  }
  submitFinalDefence(
    participantId: string,
    content: string,
    now = new Date(),
  ): Result<void, MafiaActionError> {
    if (this.phase !== 'final-defence') return err({ type: 'invalid-phase', phase: this.phase });
    return participantId === this.nominatedParticipantId
      ? this.submitSpeech(participantId, content, now)
      : err({ type: 'not-nominated-participant', participantId });
  }
  submitNomination(
    participantId: string,
    targetParticipantId: string,
    now = new Date(),
  ): Result<void, MafiaActionError> {
    if (this.phase !== 'nomination') return err({ type: 'invalid-phase', phase: this.phase });
    return this.livingParticipant(participantId, now)
      .andThen(() => this.livingParticipant(targetParticipantId, now))
      .map(() => {
        this.nominations.set(participantId, targetParticipantId);
      });
  }
  submitVerdict(
    participantId: string,
    vote: 'eliminate' | 'spare',
    now = new Date(),
  ): Result<void, MafiaActionError> {
    if (this.phase !== 'verdict') return err({ type: 'invalid-phase', phase: this.phase });
    return this.livingParticipant(participantId, now).map(() => {
      this.verdicts.set(participantId, vote);
    });
  }
  submitMafiaTarget(
    participantId: string,
    targetParticipantId: string,
    now = new Date(),
  ): Result<void, MafiaActionError> {
    return this.submitNightAction(
      participantId,
      targetParticipantId,
      'Mafia',
      () => {
        this.mafiaTargetParticipantId = targetParticipantId;
      },
      false,
      now,
    );
  }
  submitMafiaChat(
    participantId: string,
    content: string,
    now = new Date(),
  ): Result<void, MafiaActionError> {
    if (this.phase !== 'night') return err({ type: 'invalid-phase', phase: this.phase });
    return this.livingParticipant(participantId, now)
      .andThen((participant) =>
        participant.role === 'Mafia'
          ? ok(participant)
          : err({ type: 'invalid-night-action' as const, participantId }),
      )
      .andThen(() =>
        !content.trim() || content.length > mafiaGameConfig.maxPublicSpeechLength
          ? err<void, MafiaActionError>({ type: 'invalid-public-speech' })
          : ok<void, MafiaActionError>(undefined),
      )
      .map(() => {
        this.timeline.push({
          id: this.nextTimelineItemId('mafia-chat'),
          type: 'mafia-chat',
          message: { dayNumber: this.dayNumber, participantId, content: content.trim() },
        });
      });
  }
  submitDoctorProtection(
    participantId: string,
    targetParticipantId: string,
    now = new Date(),
  ): Result<void, MafiaActionError> {
    return this.submitNightAction(
      participantId,
      targetParticipantId,
      'Doctor',
      () => {
        this.doctorProtections.set(participantId, targetParticipantId);
      },
      false,
      now,
    );
  }
  submitPoliceInvestigation(
    participantId: string,
    targetParticipantId: string,
    now = new Date(),
  ): Result<void, MafiaActionError> {
    return this.submitNightAction(
      participantId,
      targetParticipantId,
      'Police',
      () => {
        this.policeInvestigations.set(participantId, targetParticipantId);
      },
      this.policeInvestigations.has(participantId),
      now,
    ).map(() => {
      const target = find(this.participants, ({ id }) => id === targetParticipantId);
      if (!target) return;
      const investigations = this.policeInvestigationHistory.get(participantId) ?? new Map();
      investigations.set(targetParticipantId, allegianceFor(target.role));
      this.policeInvestigationHistory.set(participantId, investigations);
      this.timeline.push({
        id: this.nextTimelineItemId('personal-record'),
        type: 'personal-record',
        recipientParticipantId: participantId,
        outcome: {
          type: 'police-investigation-result',
          dayNumber: this.dayNumber,
          participantId: target.id,
          allegiance: allegianceFor(target.role),
        },
      });
    });
  }
  advanceDayPhase(now = new Date()): Result<MafiaDayPhaseResult, never> {
    if (now < this.phaseDeadline) return ok<MafiaDayPhaseResult>({ type: 'not-due' });
    return match(this.phase)
      .with('completed', () => ok<MafiaDayPhaseResult>({ type: 'not-due' }))
      .with('discussion', () => ok(this.advanceTo('nomination', now)))
      .with('nomination', () => ok(this.resolveNomination(now)))
      .with('final-defence', () => ok(this.advanceTo('verdict', now)))
      .with('verdict', () => ok(this.resolveVerdict(now)))
      .with('night', () => ok(this.resolveNight(now)))
      .exhaustive();
  }
  adjustDiscussionTime(
    participantId: string,
    adjustmentSeconds: 10 | -10,
    now = new Date(),
  ): Result<void, MafiaActionError> {
    if (this.phase !== 'discussion') return err({ type: 'invalid-phase', phase: this.phase });
    return this.livingParticipant(participantId, now).map(() => {
      this.phaseDeadline = new Date(this.phaseDeadline.getTime() + adjustmentSeconds * 1000);
      this.recordOutcome({
        type: 'discussion-time-adjusted',
        dayNumber: this.dayNumber,
        adjustmentSeconds,
      });
    });
  }
  agentSpeechContextFor(participantId: string): Result<MafiaAgentContext, MafiaProjectionError> {
    const participant = find(this.participants, ({ id }) => id === participantId);
    return participant
      ? ok({
          participant: { id: participant.id, name: participant.name },
          persona: `${participant.name} is observant and concise.`,
          public: this.publicInformation(),
          personal: {
            ...toPersonalInformation(participant),
            vote: this.personalVoteFor(participantId),
            nightAction: this.personalNightActionFor(participantId),
            knownRoles: this.knownRolesFor(participant),
          },
          timeline: this.timelineFor(participant),
        })
      : err({ type: 'unknown-participant', participantId });
  }
  livingAgentParticipantIds(humanParticipantId: string) {
    return pipe(
      this.participants,
      filter(({ id, alive }) => id !== humanParticipantId && alive),
      map(({ id }) => id),
    );
  }
  livingMafiaAgentParticipantIds(humanParticipantId: string) {
    return pipe(
      this.participants,
      filter(({ id, alive, role }) => id !== humanParticipantId && alive && role === 'Mafia'),
      map(({ id }) => id),
    );
  }
  projectionFor(
    participantId: string,
    eventId: number,
  ): Result<MafiaGameProjection, MafiaProjectionError> {
    const participant = find(this.participants, ({ id }) => id === participantId);
    return participant
      ? ok({
          eventId,
          sessionId: this.sessionId,
          public: this.publicInformation(),
          personal: {
            ...toPersonalInformation(participant),
            vote: this.personalVoteFor(participantId),
            nightAction: this.personalNightActionFor(participantId),
            knownRoles: this.knownRolesFor(participant),
          },
          timeline: this.timelineFor(participant),
        })
      : err({ type: 'unknown-participant', participantId });
  }
  private submitSpeech(
    participantId: string,
    content: string,
    now: Date,
  ): Result<void, MafiaActionError> {
    return this.livingParticipant(participantId, now)
      .andThen(() =>
        !content.trim() || content.length > mafiaGameConfig.maxPublicSpeechLength
          ? err<void, MafiaActionError>({ type: 'invalid-public-speech' })
          : ok<void, MafiaActionError>(undefined),
      )
      .map(() => {
        const message = {
          participantId,
          content: content.trim(),
        };
        this.timeline.push({ id: this.nextTimelineItemId('chat'), type: 'chat', message });
      });
  }
  private livingParticipant(
    participantId: string,
    now: Date,
  ): Result<MafiaParticipant, MafiaActionError> {
    const participant = find(this.participants, ({ id }) => id === participantId);
    if (!participant) return err({ type: 'unknown-participant', participantId });
    if (!participant.alive) return err({ type: 'dead-participant', participantId });
    return now >= this.phaseDeadline
      ? err({ type: 'expired-phase', phaseDeadline: this.phaseDeadline.toISOString() })
      : ok(participant);
  }
  private advanceTo(
    phase: 'nomination' | 'final-defence' | 'verdict',
    now: Date,
  ): MafiaDayPhaseResult {
    this.changePhase(phase);
    this.phaseDeadline = new Date(now.getTime() + this.durationFor(phase));
    return { type: 'phase-advanced', phase };
  }
  private resolveNomination(now: Date): MafiaDayPhaseResult {
    const resolution = resolveNomination(this.nominations);
    this.completedVoteRecords.push({
      id: `vote-record-${this.completedVoteRecords.length + 1}`,
      dayNumber: this.dayNumber,
      phase: 'nomination',
      votes: map([...this.nominations], ([participantId, targetParticipantId]) => ({
        participantId,
        targetParticipantId,
      })),
    });
    this.recordOutcome({
      type: 'nomination-resolved',
      dayNumber: this.dayNumber,
      result: resolution.type,
      nominatedParticipantId:
        resolution.type === 'nominated' ? resolution.participantId : undefined,
      leadingVoteCount: resolution.leadingVoteCount,
      voteCounts: resolution.voteCounts,
    });
    if (resolution.type !== 'nominated') return this.restartDay(now, resolution.type);
    this.nominatedParticipantId = resolution.participantId;
    this.nominations.clear();
    return this.advanceTo('final-defence', now);
  }
  private resolveVerdict(now: Date): MafiaDayPhaseResult {
    const livingCount = filter(this.participants, ({ alive }) => alive).length;
    const resolution = resolveVerdict(this.verdicts, livingCount);
    const nominatedParticipantId = this.nominatedParticipantId;
    if (nominatedParticipantId) {
      this.completedVoteRecords.push({
        id: `vote-record-${this.completedVoteRecords.length + 1}`,
        dayNumber: this.dayNumber,
        phase: 'verdict',
        votes: map([...this.verdicts], ([participantId, vote]) => ({ participantId, vote })),
      });
      this.recordOutcome({
        type: 'verdict-resolved',
        dayNumber: this.dayNumber,
        participantId: nominatedParticipantId,
        result: resolution.type,
        eliminateVotes: resolution.eliminateVotes,
        spareVotes: resolution.spareVotes,
        requiredEliminateVotes: resolution.requiredEliminateVotes,
      });
    }
    this.verdicts.clear();
    if (resolution.type !== 'eliminate') return this.restartDay(now, resolution.type);
    const nominated = find(this.participants, ({ id }) => id === this.nominatedParticipantId);
    if (!nominated) return this.restartDay(now, 'no-majority');
    nominated.alive = false;
    this.recordOutcome({
      type: 'allegiance-reveal',
      participantId: nominated.id,
      allegiance: allegianceFor(nominated.role),
    });
    this.nominatedParticipantId = undefined;
    const winner = this.winner();
    if (winner) {
      this.changePhase('completed');
      this.recordOutcome({
        type: 'victory',
        allegiance: winner,
      });
      return { type: 'game-completed', winner };
    }
    this.startNight(now);
    return { type: 'participant-eliminated', participantId: nominated.id };
  }
  private resolveNight(now: Date): MafiaDayPhaseResult {
    const targetParticipantId = this.mafiaTargetParticipantId;
    const protectedParticipantId = [...this.doctorProtections.values()][0];
    this.completedNightActionRecords.push({
      id: `night-action-record-${this.completedNightActionRecords.length + 1}`,
      dayNumber: this.dayNumber,
      mafiaTargetParticipantId: targetParticipantId,
      doctorActions: this.completedRoleActions('Doctor', this.doctorProtections),
      policeActions: this.completedRoleActions('Police', this.policeInvestigations),
    });
    const result = !targetParticipantId
      ? ('no-death' as const)
      : targetParticipantId === protectedParticipantId
        ? ('protected' as const)
        : ('participant-eliminated' as const);
    const target =
      result === 'participant-eliminated'
        ? find(this.participants, ({ id }) => id === targetParticipantId)
        : undefined;
    if (target) target.alive = false;
    this.recordOutcome({
      type: 'night-resolved',
      dayNumber: this.dayNumber,
      result,
      participantId: result === 'participant-eliminated' ? targetParticipantId : undefined,
    });
    if (target) {
      this.recordOutcome({
        type: 'allegiance-reveal',
        participantId: target.id,
        allegiance: allegianceFor(target.role),
      });
    }
    const winner = this.winner();
    if (winner) {
      this.changePhase('completed');
      this.recordOutcome({ type: 'victory', allegiance: winner });
      return { type: 'game-completed', winner };
    }
    this.startDay();
    this.phaseDeadline = dayjs(now)
      .add(this.dayDurations.discussionDurationMs, 'millisecond')
      .toDate();
    return { type: 'night-resolved', result };
  }
  private startNight(now: Date) {
    this.dayNumber += 1;
    this.nominatedParticipantId = undefined;
    this.mafiaTargetParticipantId = undefined;
    this.doctorProtections.clear();
    this.policeInvestigations.clear();
    this.changePhase('night');
    this.phaseDeadline = dayjs(now)
      .add(this.dayDurations.nightDurationMs ?? mafiaGameConfig.nightDurationMs, 'millisecond')
      .toDate();
  }
  private restartDay(
    now: Date,
    reason: 'nomination-tie' | 'no-nomination' | 'verdict-tie' | 'no-majority',
  ): MafiaDayPhaseResult {
    this.startNight(now);
    this.nominations.clear();
    return { type: 'day-restarted', reason };
  }
  private durationFor(phase: 'nomination' | 'final-defence' | 'verdict') {
    return match(phase)
      .with('nomination', () => this.dayDurations.nominationDurationMs)
      .with('final-defence', () => this.dayDurations.finalDefenceDurationMs)
      .with('verdict', () => this.dayDurations.verdictDurationMs)
      .exhaustive();
  }
  private winner(): MafiaAllegiance | undefined {
    const mafia = filter(this.participants, ({ alive, role }) => alive && role === 'Mafia').length;
    const citizens = filter(
      this.participants,
      ({ alive, role }) => alive && role !== 'Mafia',
    ).length;
    return mafia === 0 ? 'Citizen' : mafia >= citizens ? 'Mafia' : undefined;
  }
  private publicInformation(): MafiaPublicInformation {
    return {
      dayNumber: this.dayNumber,
      phase: this.phase,
      phaseDeadline: this.phaseDeadline.toISOString(),
      participants: map(this.participants, ({ id, name, alive }) => ({ id, name, alive })),
      nominatedParticipantId: this.nominatedParticipantId,
      completedRecords:
        this.phase === 'completed'
          ? {
              voteRecords: [...this.completedVoteRecords],
              nightActionRecords: [...this.completedNightActionRecords],
            }
          : { voteRecords: [], nightActionRecords: [] },
    };
  }
  private personalVoteFor(participantId: string): MafiaPersonalInformation['vote'] {
    return match(this.phase)
      .with('nomination', () => {
        const targetParticipantId = this.nominations.get(participantId);
        return targetParticipantId
          ? { phase: 'nomination' as const, targetParticipantId }
          : undefined;
      })
      .with('verdict', () => {
        const vote = this.verdicts.get(participantId);
        return vote ? { phase: 'verdict' as const, vote } : undefined;
      })
      .with('discussion', 'final-defence', 'night', 'completed', () => undefined)
      .exhaustive();
  }
  private recordOutcome(outcome: MafiaPublicOutcome) {
    this.timeline.push({ id: this.nextTimelineItemId('record'), type: 'record', outcome });
  }
  private nextTimelineItemId(type: MafiaPersonalTimelineItem['type']) {
    const sequence = (this.timelineItemCounts.get(type) ?? 0) + 1;
    this.timelineItemCounts.set(type, sequence);
    const prefix = match(type)
      .with('chat', () => 'public-chat')
      .with('mafia-chat', () => 'mafia-chat')
      .with('record', () => 'record')
      .with('personal-record', () => 'personal-record')
      .exhaustive();
    return `${prefix}-${sequence}`;
  }
  private changePhase(phase: MafiaPhase) {
    this.phase = phase;
    this.recordOutcome({
      type: 'phase-changed',
      dayNumber: this.dayNumber,
      phase,
    });
  }
  private startDay() {
    this.recordOutcome({
      type: 'day-changed',
      dayNumber: this.dayNumber,
    });
    this.changePhase('discussion');
  }
  private submitNightAction(
    participantId: string,
    targetParticipantId: string,
    role: MafiaParticipant['role'],
    recordAction: () => void,
    hasSubmittedAction: boolean,
    now: Date,
  ): Result<void, MafiaActionError> {
    if (this.phase !== 'night') return err({ type: 'invalid-phase', phase: this.phase });
    return this.livingParticipant(participantId, now)
      .andThen((participant) =>
        participant.role === role
          ? ok(participant)
          : err({ type: 'invalid-night-action' as const, participantId }),
      )
      .andThen(() =>
        role === 'Police' && hasSubmittedAction
          ? err({ type: 'night-action-already-submitted' as const, participantId })
          : ok(undefined),
      )
      .andThen(() => this.livingParticipant(targetParticipantId, now))
      .map(() => {
        recordAction();
      });
  }
  private completedRoleActions(
    role: Extract<MafiaParticipant['role'], 'Doctor' | 'Police'>,
    actions: ReadonlyMap<string, string>,
  ): MafiaCompletedNightAction[] {
    return map(
      filter(this.participants, (participant) => participant.alive && participant.role === role),
      ({ id }) => ({ participantId: id, targetParticipantId: actions.get(id) }),
    );
  }
  private personalNightActionFor(participantId: string): MafiaPersonalInformation['nightAction'] {
    const participant = find(this.participants, ({ id }) => id === participantId);
    if (participant?.role === 'Mafia' && this.mafiaTargetParticipantId) {
      return { type: 'mafia-target', targetParticipantId: this.mafiaTargetParticipantId };
    }
    const protectedParticipantId = this.doctorProtections.get(participantId);
    if (protectedParticipantId)
      return { type: 'doctor-protection', targetParticipantId: protectedParticipantId };
    const investigatedParticipantId = this.policeInvestigations.get(participantId);
    if (!investigatedParticipantId) return undefined;
    return {
      type: 'police-investigation',
      targetParticipantId: investigatedParticipantId,
    };
  }
  private knownRolesFor(participant: MafiaParticipant): MafiaPersonalInformation['knownRoles'] {
    if (this.phase === 'completed') {
      return map(this.participants, ({ id, role }) => ({
        participantId: id,
        role,
      }));
    }
    const policeHistory = this.policeInvestigationHistory.get(participant.id);
    const roleknownRoles =
      participant.role === 'Mafia'
        ? map(this.participants, ({ id, role }) => ({
            participantId: id,
            role: allegianceFor(role),
          }))
        : policeHistory
          ? map([...policeHistory], ([participantId, allegiance]) => ({
              participantId,
              role: allegiance,
            }))
          : [];
    const ownRole = {
      participantId: participant.id,
      role: participant.role,
    };
    const knownRoles = new Map(
      map(
        [...this.publiclyRevealedAllegiances(), ...roleknownRoles, ownRole],
        ({ participantId, role }) => [participantId, role] as const,
      ),
    );
    return map([...knownRoles], ([participantId, role]) => ({
      participantId,
      role,
    }));
  }
  private timelineFor(participant: MafiaParticipant): ReadonlyArray<MafiaPersonalTimelineItem> {
    return filter(this.timeline, (item) => {
      if (item.type === 'mafia-chat') return participant.role === 'Mafia';
      if (item.type === 'personal-record') return item.recipientParticipantId === participant.id;
      return true;
    });
  }
  private publiclyRevealedAllegiances(): MafiaPersonalInformation['knownRoles'] {
    return pipe(
      this.timeline,
      flatMap((item) =>
        item.type === 'record' && item.outcome.type === 'allegiance-reveal'
          ? [
              {
                participantId: item.outcome.participantId,
                role: item.outcome.allegiance,
              },
            ]
          : [],
      ),
    );
  }
}
export type MafiaGameProjection = AuthorizedGameProjection<
  MafiaPublicInformation,
  MafiaPersonalInformation
> & {
  timeline: ReadonlyArray<MafiaPersonalTimelineItem>;
};
