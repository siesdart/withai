export const mafiaGameConfig = {
  defaultParticipantCount: 8,
  minParticipantCount: 5,
  maxParticipantCount: 8,
  mafiaRoleThreshold: 6,
  maxPublicSpeechLength: 500,
  discussionDurationMs: 3 * 60 * 1000,
  nominationDurationMs: 20 * 1000,
  finalDefenceDurationMs: 30 * 1000,
  verdictDurationMs: 15 * 1000,
  nightDurationMs: 20 * 1000,
} as const;

export type MafiaDayDurations = {
  discussionDurationMs: number;
  nominationDurationMs: number;
  finalDefenceDurationMs: number;
  verdictDurationMs: number;
  nightDurationMs: number;
};
