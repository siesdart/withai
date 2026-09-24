import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';

import { guestPlayAllowanceOptions } from '../options/guest-play-allowance-options';

dayjs.extend(duration);

function formatResetCountdown(resetsAt: string, now: dayjs.Dayjs) {
  const remaining = dayjs.duration(Math.max(0, dayjs(resetsAt).diff(now)));
  return remaining.format(remaining.asHours() >= 1 ? 'HH시간 mm분' : 'mm분');
}

export function useGuestPlayAllowance(open: boolean) {
  const { data: allowance, isLoading } = useQuery({
    ...guestPlayAllowanceOptions(),
    enabled: open,
  });
  const resetsAt = allowance?.resetsAt;

  return {
    allowance,
    resetCountdown: resetsAt ? formatResetCountdown(resetsAt, dayjs()) : undefined,
    isExhausted: allowance?.remaining === 0,
    isLoading,
  };
}
