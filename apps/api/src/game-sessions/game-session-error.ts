import type { MafiaProjectionError, MafiaSessionInputError } from '@repo/mafia';

export type GameSessionError =
  | { type: 'idempotency-conflict' }
  | { type: 'guest-allowance-exhausted' }
  | { type: 'unavailable-to-guest'; sessionId: string }
  | { type: 'session-not-found'; sessionId: string }
  | { type: 'invalid-mafia-session-input'; cause: MafiaSessionInputError }
  | { type: 'invalid-mafia-projection'; cause: MafiaProjectionError }
  | { type: 'public-speech-idempotency-conflict' }
  | { type: 'public-speech-rate-limited'; retryAfterMs: number }
  | { type: 'invalid-public-speech' }
  | { type: 'mafia-chat-idempotency-conflict' }
  | { type: 'invalid-mafia-chat' }
  | { type: 'invalid-day-action' }
  | { type: 'day-action-idempotency-conflict' }
  | { type: 'day-action-rate-limited'; retryAfterMs: number }
  | { type: 'discussion-time-adjustment-idempotency-conflict' }
  | { type: 'discussion-time-adjustment-rate-limited'; retryAfterMs: number }
  | { type: 'invalid-discussion-time-adjustment' }
  | { type: 'stale-discussion-time-adjustment' }
  | { type: 'expired-phase'; phaseDeadline: string }
  | { type: 'dead-participant'; participantId: string };
