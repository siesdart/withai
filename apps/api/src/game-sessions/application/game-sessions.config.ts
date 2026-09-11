export const gameSessionsConfig = {
  guestCookieName: 'withai_guest',
  guestAllowance: 10,
  humanActionCooldownMs: 1000,
  sessionIdleTtlHours: 24,
  abandonedSessionTtlMinutes: 60,
  inProgressIdleTtlMinutes: 15,
  reconnectGraceMs: 60 * 1000,
  phaseDeadlineClaimLeaseMs: 60 * 1000,
  cleanupIntervalMs: 60 * 1000,
  eventReplayBufferSize: 10_000,
} as const;
