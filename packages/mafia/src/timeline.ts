import type { NominationVoteCount } from './day-resolution';
import type { MafiaAllegiance } from './participants';

export type MafiaPhase =
  | 'discussion'
  | 'nomination'
  | 'final-defence'
  | 'verdict'
  | 'night'
  | 'completed';

export type MafiaPublicChatMessage = { participantId: string; content: string };
export type MafiaPublicOutcome =
  | {
      type: 'nomination-resolved';
      dayNumber: number;
      result: 'nominated' | 'nomination-tie' | 'no-nomination';
      nominatedParticipantId: string | undefined;
      leadingVoteCount: number;
      voteCounts: ReadonlyArray<NominationVoteCount>;
    }
  | {
      type: 'verdict-resolved';
      dayNumber: number;
      participantId: string;
      result: 'eliminate' | 'verdict-tie' | 'no-majority';
      eliminateVotes: number;
      spareVotes: number;
      requiredEliminateVotes: number;
    }
  | { type: 'day-changed'; dayNumber: number }
  | { type: 'phase-changed'; dayNumber: number; phase: MafiaPhase }
  | {
      type: 'night-resolved';
      dayNumber: number;
      result: 'no-death' | 'protected' | 'participant-eliminated';
      participantId?: string;
    }
  | { type: 'discussion-time-adjusted'; dayNumber: number; adjustmentSeconds: 10 | -10 }
  | { type: 'allegiance-reveal'; participantId: string; allegiance: MafiaAllegiance }
  | { type: 'victory'; allegiance: MafiaAllegiance };

export type MafiaPublicTimelineItem =
  | { id: string; type: 'chat'; message: MafiaPublicChatMessage }
  | { id: string; type: 'record'; outcome: MafiaPublicOutcome };
export type MafiaPersonalRecord = {
  type: 'autonomous-public-speech-limit-reached';
  dayNumber: number;
};
export type MafiaChatMessage = {
  dayNumber: number;
  participantId: string;
  content: string;
};
export type MafiaPersonalTimelineItem =
  | MafiaPublicTimelineItem
  | { id: string; type: 'mafia-chat'; message: MafiaChatMessage }
  | {
      id: string;
      type: 'personal-record';
      recipientParticipantId: string;
      outcome: MafiaPersonalRecord;
    };
