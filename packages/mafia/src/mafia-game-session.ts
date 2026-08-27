import { randomInt } from 'node:crypto';

import type { AuthorizedGameProjection, GameModule, GameModuleSession } from '@repo/game-contract';
import { err, ok, type Result } from 'neverthrow';
import { filter, find, map, pipe } from 'remeda';
import { match } from 'ts-pattern';

import { mafiaGameConfig } from './config';
import { resolveNomination, resolveVerdict } from './day-resolution';
import { allegianceFor, createParticipants, toPersonalInformation } from './participants';

export { mafiaGameConfig } from './config';

export type MafiaSessionInput = {
  sessionId: string;
  participantCount: number;
  phaseDeadline: Date;
};
export type MafiaRole = 'Mafia' | 'Detective' | 'Doctor' | 'Citizen';
export type MafiaPhase =
  | 'day-discussion'
  | 'nomination'
  | 'final-defence'
  | 'verdict'
  | 'completed';
export type MafiaParticipant = { id: string; name: string; alive: boolean; role: MafiaRole };
export type MafiaAllegiance = 'Mafia' | 'Citizen';
export type MafiaPublicChatMessage = { id: string; participantId: string; content: string };
export type MafiaPublicOutcome =
  | { id: string; type: 'nomination-tie' | 'no-nomination' | 'verdict-tie' | 'no-majority' }
  | { id: string; type: 'allegiance-reveal'; participantId: string; allegiance: MafiaAllegiance }
  | { id: string; type: 'victory'; allegiance: MafiaAllegiance };
export type MafiaPublicInformation = {
  phase: MafiaPhase;
  phaseDeadline: string;
  participants: ReadonlyArray<Omit<MafiaParticipant, 'role'>>;
  chat: ReadonlyArray<MafiaPublicChatMessage>;
  nominatedParticipantId: string | undefined;
  outcomes: ReadonlyArray<MafiaPublicOutcome>;
};
export type MafiaPersonalInformation = {
  participantId: string;
  role: MafiaRole;
  allegiance: MafiaAllegiance;
};

export type RandomInt = (maxExclusive: number) => number;
export type MafiaSessionInputError = {
  type: 'invalid-participant-count';
  participantCount: number;
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
export type MafiaPublicSpeechError = MafiaActionError;
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
export type MafiaDayDurations = {
  dayDiscussionDurationMs: number;
  nominationDurationMs: number;
  finalDefenceDurationMs: number;
  verdictDurationMs: number;
};
const defaultDayDurations: MafiaDayDurations = {
  dayDiscussionDurationMs: mafiaGameConfig.dayDiscussionDurationMs,
  nominationDurationMs: mafiaGameConfig.nominationDurationMs,
  finalDefenceDurationMs: mafiaGameConfig.finalDefenceDurationMs,
  verdictDurationMs: mafiaGameConfig.verdictDurationMs,
};

export class MafiaGameSession implements GameModuleSession<
  MafiaPublicInformation,
  MafiaPersonalInformation,
  MafiaProjectionError
> {
  private readonly chat: MafiaPublicChatMessage[] = [];
  private readonly outcomes: MafiaPublicOutcome[] = [];
  private readonly nominations = new Map<string, string>();
  private readonly verdicts = new Map<string, 'eliminate' | 'spare'>();
  private phase: MafiaPhase = 'day-discussion';
  private nominatedParticipantId: string | undefined;
  constructor(
    private readonly sessionId: string,
    private phaseDeadline: Date,
    private readonly participants: MafiaParticipant[],
    private readonly dayDurations: MafiaDayDurations,
  ) {}

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
    if (now < this.phaseDeadline || this.phase === 'completed') return ok({ type: 'not-due' });
    if (this.phase === 'day-discussion') return ok(this.advanceTo('nomination', now));
    if (this.phase === 'nomination') return ok(this.resolveNomination(now));
    if (this.phase === 'final-defence') return ok(this.advanceTo('verdict', now));
    return ok(this.resolveVerdict(now));
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
          personal: toPersonalInformation(participant),
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
          personal: toPersonalInformation(participant),
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
        this.chat.push({
          id: `chat-${this.chat.length + 1}`,
          participantId,
          content: content.trim(),
        });
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
    this.phase = phase;
    this.phaseDeadline = new Date(now.getTime() + this.durationFor(phase));
    return { type: 'phase-advanced', phase };
  }
  private resolveNomination(now: Date): MafiaDayPhaseResult {
    const resolution = resolveNomination(this.nominations);
    if (resolution.type !== 'nominated') return this.restartDay(now, resolution.type);
    this.nominatedParticipantId = resolution.participantId;
    this.nominations.clear();
    return this.advanceTo('final-defence', now);
  }
  private resolveVerdict(now: Date): MafiaDayPhaseResult {
    const livingCount = this.participants.filter(({ alive }) => alive).length;
    const resolution = resolveVerdict(this.verdicts, livingCount);
    this.verdicts.clear();
    if (resolution !== 'eliminate') return this.restartDay(now, resolution);
    const nominated = find(this.participants, ({ id }) => id === this.nominatedParticipantId);
    if (!nominated) return this.restartDay(now, 'no-majority');
    nominated.alive = false;
    this.outcomes.push({
      id: `outcome-${this.outcomes.length + 1}`,
      type: 'allegiance-reveal',
      participantId: nominated.id,
      allegiance: allegianceFor(nominated.role),
    });
    this.nominatedParticipantId = undefined;
    const winner = this.winner();
    if (winner) {
      this.phase = 'completed';
      this.outcomes.push({
        id: `outcome-${this.outcomes.length + 1}`,
        type: 'victory',
        allegiance: winner,
      });
      return { type: 'game-completed', winner };
    }
    this.phase = 'day-discussion';
    this.phaseDeadline = new Date(now.getTime() + this.dayDurations.dayDiscussionDurationMs);
    return { type: 'participant-eliminated', participantId: nominated.id };
  }
  private restartDay(
    now: Date,
    reason: 'nomination-tie' | 'no-nomination' | 'verdict-tie' | 'no-majority',
  ): MafiaDayPhaseResult {
    this.outcomes.push({ id: `outcome-${this.outcomes.length + 1}`, type: reason });
    this.phase = 'day-discussion';
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
    const mafia = this.participants.filter(({ alive, role }) => alive && role === 'Mafia').length;
    const citizens = this.participants.filter(
      ({ alive, role }) => alive && role !== 'Mafia',
    ).length;
    return mafia === 0 ? 'Citizen' : mafia >= citizens ? 'Mafia' : undefined;
  }
  private publicInformation(): MafiaPublicInformation {
    return {
      phase: this.phase,
      phaseDeadline: this.phaseDeadline.toISOString(),
      participants: map(this.participants, ({ id, name, alive }) => ({ id, name, alive })),
      chat: [...this.chat],
      nominatedParticipantId: this.nominatedParticipantId,
      outcomes: [...this.outcomes],
    };
  }
}
export type MafiaGameProjection = AuthorizedGameProjection<
  MafiaPublicInformation,
  MafiaPersonalInformation
>;
