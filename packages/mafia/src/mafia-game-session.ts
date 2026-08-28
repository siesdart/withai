import type { AuthorizedGameProjection, GameModuleSession } from '@repo/game-contract';
import { err, ok, type Result } from 'neverthrow';
import { filter, find, map, pipe } from 'remeda';
import { match } from 'ts-pattern';

import { mafiaGameConfig, type MafiaDayDurations } from './config';
import { resolveNomination, resolveVerdict } from './day-resolution';
import type { NominationVoteCount } from './day-resolution';
import {
  allegianceFor,
  toPersonalInformation,
  type MafiaAllegiance,
  type MafiaParticipant,
  type MafiaPersonalInformation,
} from './participants';

export { mafiaGameConfig } from './config';

export type MafiaPhase =
  | 'day-discussion'
  | 'nomination'
  | 'final-defence'
  | 'verdict'
  | 'completed';
export type MafiaPublicChatMessage = { id: string; participantId: string; content: string };
export type MafiaPublicOutcome =
  | {
      id: string;
      type: 'nomination-resolved';
      dayNumber: number;
      result: 'nominated' | 'nomination-tie' | 'no-nomination';
      nominatedParticipantId: string | undefined;
      leadingVoteCount: number;
      voteCounts: ReadonlyArray<NominationVoteCount>;
    }
  | {
      id: string;
      type: 'verdict-resolved';
      dayNumber: number;
      participantId: string;
      result: 'eliminate' | 'verdict-tie' | 'no-majority';
      eliminateVotes: number;
      spareVotes: number;
      requiredEliminateVotes: number;
    }
  | { id: string; type: 'day-changed'; dayNumber: number }
  | { id: string; type: 'phase-changed'; dayNumber: number; phase: MafiaPhase }
  | {
      id: string;
      type: 'phase-time-adjusted';
      dayNumber: number;
      phase: Exclude<MafiaPhase, 'completed'>;
      adjustmentSeconds: 10 | -10;
    }
  | { id: string; type: 'allegiance-reveal'; participantId: string; allegiance: MafiaAllegiance }
  | { id: string; type: 'victory'; allegiance: MafiaAllegiance };
export type MafiaPublicVoteStatus = {
  phase: 'nomination' | 'verdict';
  submittedParticipantIds: ReadonlyArray<string>;
};
export type MafiaCompletedVoteRecord = {
  id: string;
  dayNumber: number;
  phase: 'nomination' | 'verdict';
  votes: ReadonlyArray<
    | { participantId: string; targetParticipantId: string }
    | { participantId: string; vote: 'eliminate' | 'spare' }
  >;
};
export type MafiaPublicTimelineItem =
  | { id: string; type: 'chat'; message: MafiaPublicChatMessage }
  | { id: string; type: 'record'; outcome: MafiaPublicOutcome };
export type MafiaPublicInformation = {
  dayNumber: number;
  phase: MafiaPhase;
  phaseDeadline: string;
  participants: ReadonlyArray<Omit<MafiaParticipant, 'role'>>;
  nominatedParticipantId: string | undefined;
  voteStatus: MafiaPublicVoteStatus | undefined;
  timeline: ReadonlyArray<MafiaPublicTimelineItem>;
  completedVoteRecords: ReadonlyArray<MafiaCompletedVoteRecord>;
};
export type MafiaProjectionError = { type: 'unknown-participant'; participantId: string };
export type MafiaActionError =
  | { type: 'unknown-participant'; participantId: string }
  | { type: 'dead-participant'; participantId: string }
  | { type: 'expired-phase'; phaseDeadline: string }
  | { type: 'invalid-phase'; phase: MafiaPhase }
  | { type: 'not-nominated-participant'; participantId: string }
  | { type: 'invalid-target'; participantId: string }
  | { type: 'invalid-public-speech' };
export type MafiaAgentSpeechContext = {
  participant: Pick<MafiaParticipant, 'id' | 'name'>;
  persona: string;
  public: MafiaPublicInformation;
  personal: MafiaPersonalInformation;
};
export type MafiaDayPhaseResult =
  | { type: 'not-due' }
  | { type: 'phase-advanced'; phase: 'nomination' | 'final-defence' | 'verdict' }
  | {
      type: 'day-restarted';
      reason: 'nomination-tie' | 'no-nomination' | 'verdict-tie' | 'no-majority';
    }
  | { type: 'participant-eliminated'; participantId: string }
  | { type: 'game-completed'; winner: MafiaAllegiance };
export class MafiaGameSession implements GameModuleSession<
  MafiaPublicInformation,
  MafiaPersonalInformation,
  MafiaProjectionError
> {
  private readonly timeline: MafiaPublicTimelineItem[] = [];
  private readonly nominations = new Map<string, string>();
  private readonly verdicts = new Map<string, 'eliminate' | 'spare'>();
  private readonly completedVoteRecords: MafiaCompletedVoteRecord[] = [];
  private phase: MafiaPhase = 'day-discussion';
  private nominatedParticipantId: string | undefined;
  private dayNumber = 1;
  constructor(
    private readonly sessionId: string,
    private phaseDeadline: Date,
    private readonly participants: MafiaParticipant[],
    private readonly dayDurations: MafiaDayDurations,
  ) {
    this.recordDayStart();
  }

  submitPublicSpeech(
    participantId: string,
    content: string,
    now = new Date(),
  ): Result<void, MafiaActionError> {
    return this.phase === 'day-discussion'
      ? this.submitSpeech(participantId, content, now)
      : err({ type: 'invalid-phase', phase: this.phase });
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
  advanceDayPhase(now = new Date()): Result<MafiaDayPhaseResult, never> {
    if (now < this.phaseDeadline) return ok<MafiaDayPhaseResult>({ type: 'not-due' });
    return match(this.phase)
      .with('completed', () => ok<MafiaDayPhaseResult>({ type: 'not-due' }))
      .with('day-discussion', () => ok(this.advanceTo('nomination', now)))
      .with('nomination', () => ok(this.resolveNomination(now)))
      .with('final-defence', () => ok(this.advanceTo('verdict', now)))
      .with('verdict', () => ok(this.resolveVerdict(now)))
      .exhaustive();
  }
  adjustPhaseTime(adjustmentSeconds: 10 | -10, now = new Date()): Result<void, MafiaActionError> {
    if (this.phase === 'completed') return err({ type: 'invalid-phase', phase: this.phase });
    if (now >= this.phaseDeadline) {
      return err({ type: 'expired-phase', phaseDeadline: this.phaseDeadline.toISOString() });
    }

    this.phaseDeadline = new Date(this.phaseDeadline.getTime() + adjustmentSeconds * 1000);
    this.recordOutcome({
      id: this.nextOutcomeId(),
      type: 'phase-time-adjusted',
      dayNumber: this.dayNumber,
      phase: this.phase,
      adjustmentSeconds,
    });
    return ok(undefined);
  }
  agentSpeechContextFor(
    participantId: string,
  ): Result<MafiaAgentSpeechContext, MafiaProjectionError> {
    const participant = find(this.participants, ({ id }) => id === participantId);
    return participant
      ? ok({
          participant: { id: participant.id, name: participant.name },
          persona: `${participant.name} is observant and concise.`,
          public: this.publicInformation(),
          personal: {
            ...toPersonalInformation(participant),
            vote: this.personalVoteFor(participantId),
          },
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
          },
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
          id: `chat-${filter(this.timeline, ({ type }) => type === 'chat').length + 1}`,
          participantId,
          content: content.trim(),
        };
        this.timeline.push({ id: `timeline-${this.timeline.length + 1}`, type: 'chat', message });
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
      id: this.nextOutcomeId(),
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
        id: this.nextOutcomeId(),
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
      id: this.nextOutcomeId(),
      type: 'allegiance-reveal',
      participantId: nominated.id,
      allegiance: allegianceFor(nominated.role),
    });
    this.nominatedParticipantId = undefined;
    const winner = this.winner();
    if (winner) {
      this.changePhase('completed');
      this.recordOutcome({
        id: this.nextOutcomeId(),
        type: 'victory',
        allegiance: winner,
      });
      return { type: 'game-completed', winner };
    }
    this.startNextDay();
    this.phaseDeadline = new Date(now.getTime() + this.dayDurations.dayDiscussionDurationMs);
    return { type: 'participant-eliminated', participantId: nominated.id };
  }
  private restartDay(
    now: Date,
    reason: 'nomination-tie' | 'no-nomination' | 'verdict-tie' | 'no-majority',
  ): MafiaDayPhaseResult {
    this.startNextDay();
    this.nominatedParticipantId = undefined;
    this.nominations.clear();
    this.phaseDeadline = new Date(now.getTime() + this.dayDurations.dayDiscussionDurationMs);
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
      voteStatus: this.voteStatus(),
      timeline: [...this.timeline],
      completedVoteRecords: this.phase === 'completed' ? [...this.completedVoteRecords] : [],
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
      .with('day-discussion', 'final-defence', 'completed', () => undefined)
      .exhaustive();
  }
  private voteStatus(): MafiaPublicVoteStatus | undefined {
    return match(this.phase)
      .with('nomination', () => ({
        phase: 'nomination' as const,
        submittedParticipantIds: [...this.nominations.keys()],
      }))
      .with('verdict', () => ({
        phase: 'verdict' as const,
        submittedParticipantIds: [...this.verdicts.keys()],
      }))
      .with('day-discussion', 'final-defence', 'completed', () => undefined)
      .exhaustive();
  }
  private recordOutcome(outcome: MafiaPublicOutcome) {
    this.timeline.push({ id: `timeline-${this.timeline.length + 1}`, type: 'record', outcome });
  }
  private changePhase(phase: MafiaPhase) {
    this.phase = phase;
    this.recordOutcome({
      id: this.nextOutcomeId(),
      type: 'phase-changed',
      dayNumber: this.dayNumber,
      phase,
    });
  }
  private startNextDay() {
    this.dayNumber += 1;
    this.recordDayStart();
  }
  private recordDayStart() {
    this.recordOutcome({
      id: this.nextOutcomeId(),
      type: 'day-changed',
      dayNumber: this.dayNumber,
    });
    this.changePhase('day-discussion');
  }
  private nextOutcomeId() {
    return `outcome-${filter(this.timeline, ({ type }) => type === 'record').length + 1}`;
  }
}
export type MafiaGameProjection = AuthorizedGameProjection<
  MafiaPublicInformation,
  MafiaPersonalInformation
>;
