export const mafiaGameConfig = {
  defaultParticipantCount: 5,
  minParticipantCount: 5,
  maxParticipantCount: 10,
  mafiaRoleThreshold: 6,
  maxPublicSpeechLength: 500,
  discussionDurationMs: 2 * 60 * 1000,
  nominationDurationMs: 20 * 1000,
  finalDefenceDurationMs: 20 * 1000,
  verdictDurationMs: 20 * 1000,
  nightDurationMs: 30 * 1000,
} as const;

export type MafiaDayDurations = {
  discussionDurationMs: number;
  nominationDurationMs: number;
  finalDefenceDurationMs: number;
  verdictDurationMs: number;
  nightDurationMs: number;
};
