import type { Dayjs } from 'dayjs';

export function cooldownRetryAfterMs(nextAvailableAt: Dayjs | undefined, now: Dayjs) {
  if (!nextAvailableAt?.isAfter(now)) {
    return undefined;
  }

  return nextAvailableAt.diff(now);
}

export function retryAfterSeconds(retryAfterMs: number) {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}
