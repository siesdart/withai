import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import { useEffect, useState } from 'react';

dayjs.extend(duration);

function formatDuration(deadline: string, now: dayjs.Dayjs) {
  const remaining = dayjs.duration(Math.max(0, dayjs(deadline).diff(now)));
  return remaining.format(remaining.asHours() >= 1 ? 'HH:mm:ss' : 'mm:ss');
}

export function useDeadlineCountdown(deadline: string) {
  const [now, setNow] = useState(() => dayjs());

  const isExpired = !dayjs(deadline).isAfter(now);

  useEffect(() => {
    if (isExpired) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setNow(dayjs());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isExpired]);

  const remainingMs = Math.max(0, dayjs(deadline).diff(now));
  return {
    label: formatDuration(deadline, now),
    isExpired,
    isUrgent: remainingMs > 0 && remainingMs <= 30_000,
  };
}
