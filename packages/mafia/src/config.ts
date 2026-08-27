export const mafiaGameConfig = {
  defaultParticipantCount: 5,
  minParticipantCount: 5,
  maxParticipantCount: 10,
  mafiaRoleThreshold: 6,
  maxPublicSpeechLength: 500,
  dayDiscussionDurationMs: 2 * 60 * 1000,
  nominationDurationMs: 60 * 1000,
  finalDefenceDurationMs: 45 * 1000,
  verdictDurationMs: 45 * 1000,
} as const;

export type MafiaDayDurations = {
  dayDiscussionDurationMs: number;
  nominationDurationMs: number;
  finalDefenceDurationMs: number;
  verdictDurationMs: number;
};
