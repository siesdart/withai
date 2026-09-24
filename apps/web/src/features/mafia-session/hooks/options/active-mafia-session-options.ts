import { queryOptions } from '@tanstack/react-query';

import { MafiaGameSessionClient } from '../../api/client';

export const activeMafiaSessionOptions = () =>
  queryOptions({
    queryKey: ['active-mafia-session'],
    queryFn: async () => {
      const result = await MafiaGameSessionClient.activeSession();
      return result.match(
        (session) => session,
        () => null,
      );
    },
    retry: false,
  });
