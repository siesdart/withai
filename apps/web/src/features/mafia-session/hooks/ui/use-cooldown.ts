import { useCallback, useEffect, useState } from 'react';

export function useCooldown() {
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | undefined>();

  useEffect(() => {
    if (!retryAfterSeconds) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setRetryAfterSeconds(undefined);
    }, retryAfterSeconds * 1000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [retryAfterSeconds]);

  const startCooldown = useCallback((retryAfterMs: number) => {
    setRetryAfterSeconds(Math.max(1, Math.ceil(retryAfterMs / 1000)));
  }, []);

  return {
    isCoolingDown: Boolean(retryAfterSeconds),
    retryAfterSeconds,
    startCooldown,
  };
}
