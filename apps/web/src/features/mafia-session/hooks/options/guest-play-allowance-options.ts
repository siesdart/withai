import { queryOptions } from '@tanstack/react-query';

import { MafiaGameSessionClient } from '../../api/client';

export const guestPlayAllowanceOptions = () =>
  queryOptions({
    queryKey: ['guest-play-allowance'],
    queryFn: async () => {
      const result = await MafiaGameSessionClient.guestPlayAllowance();
      return result.match(
        (allowance) => allowance,
        (error) => {
          throw error;
        },
      );
    },
  });
