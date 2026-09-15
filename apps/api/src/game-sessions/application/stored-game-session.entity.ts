import type { MafiaGameSession } from '@repo/mafia';
import type { MafiaGameProjection } from '@repo/mafia';
import type { Dayjs } from 'dayjs';
import { type ReplaySubject } from 'rxjs';

import type { AgentMind } from '../agents/agent-mind.js';
import type { GameSessionStatus } from './game-session-status.js';
import type { IdempotencyRecord } from './idempotency/idempotency-ledger.js';

export type ScheduledAgentPublicSpeech = {
  participantId: string;
  content: string;
  dueAt: string;
};

export const scheduledAgentPublicSpeechKey = ({
  participantId,
  content,
  dueAt,
}: ScheduledAgentPublicSpeech) => JSON.stringify([participantId, content, dueAt]);

export const sameScheduledAgentFinalDefence = (
  left: ScheduledAgentFinalDefence,
  right: ScheduledAgentFinalDefence,
) =>
  left.participantId === right.participantId &&
  left.content === right.content &&
  left.dueAt === right.dueAt;

export type ScheduledAgentFinalDefence = {
  participantId: string;
  content: string;
  dueAt: string;
};

export type ScheduledAgentMafiaChatReply = {
  id: string;
  participantId: string;
  content: string;
  dueAt: string;
};

export type StoredGameSessionEntity = {
  holderId: string;
  humanParticipantId: string;
  gameSession: MafiaGameSession;
  agentMinds: Record<string, AgentMind>;
  events: ReplaySubject<MafiaGameProjection>;
  nextEventId: number;
  nextPublicSpeechAt: Dayjs | undefined;
  nextFinalDefenceAt: Dayjs | undefined;
  nextDiscussionTimeAdjustmentAt: Dayjs | undefined;
  lastAccessedAt: Dayjs;
  status: GameSessionStatus;
  publicSpeechIdempotencyKeys: Map<string, IdempotencyRecord<MafiaGameProjection>>;
  mafiaChatIdempotencyKeys: Map<string, IdempotencyRecord<MafiaGameProjection>>;
  dayActionIdempotencyKeys: Map<string, IdempotencyRecord<MafiaGameProjection>>;
  discussionTimeAdjustmentIdempotencyKeys: Map<string, IdempotencyRecord<MafiaGameProjection>>;
  phaseTimer: NodeJS.Timeout | undefined;
  agentFinalDefenceTimer: NodeJS.Timeout | undefined;
  publicSpeechAgentTimers: Map<string, NodeJS.Timeout>;
  mafiaChatReplyTimers: Map<string, NodeJS.Timeout>;
  mafiaTargetFallbackTimer: NodeJS.Timeout | undefined;
  scheduledAgentPublicSpeeches: ScheduledAgentPublicSpeech[];
  scheduledAgentFinalDefence: ScheduledAgentFinalDefence | undefined;
  scheduledAgentMafiaChatReplies: ScheduledAgentMafiaChatReply[];
  scheduledMafiaTargetFallbackAt: string | undefined;
  autonomousPublicSpeechTurns: number;
  lastAutonomousPublicSpeechSnapshotKey: string | undefined;
  autonomousPublicSpeechLimitReachedDiscussionKey: string | undefined;
  agentActionsPending: boolean;
  reconnectGraceTimer: NodeJS.Timeout | undefined;
  reconnectGraceDeadline: Dayjs | undefined;
};
