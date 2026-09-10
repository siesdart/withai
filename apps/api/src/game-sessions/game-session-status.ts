export const gameSessionStatuses = ['in-progress', 'completed', 'abandoned', 'expired'] as const;

export type GameSessionStatus = (typeof gameSessionStatuses)[number];
