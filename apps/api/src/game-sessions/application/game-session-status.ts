export const gameSessionStatuses = ['in-progress', 'completed', 'abandoned'] as const;

export type GameSessionStatus = (typeof gameSessionStatuses)[number];
