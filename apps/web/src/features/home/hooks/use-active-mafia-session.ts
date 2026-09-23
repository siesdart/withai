import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useGameSessionStore } from '../../mafia-session/store/game-session';
import { activeMafiaSessionOptions } from './options/active-mafia-session-options';

export function useActiveMafiaSession() {
  const { data: session, isPending } = useQuery(activeMafiaSessionOptions());

  useEffect(() => {
    if (isPending) return;

    const { clearSession, setGameSession } = useGameSessionStore.getState();
    if (!session) {
      clearSession();
      return;
    }

    setGameSession(session.outputLanguage);
  }, [isPending, session]);

  return { isChecking: isPending, session };
}
