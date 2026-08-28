export const gameSessionsConfig = {
  guestCookieName: 'withai_guest',
  guestAllowance: 10,
  humanActionCooldownMs: 1000,
  sessionIdleTtlHours: 24,
  cleanupIntervalMs: 60 * 60 * 1000,
  eventReplayBufferSize: 100,
} as const;
