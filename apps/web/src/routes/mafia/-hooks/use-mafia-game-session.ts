import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';

import { createMafiaGameSession } from '@/lib/game-session-api';
import { useGameSessionStore } from '@/lib/game-session-store';

export function useMafiaGameSession() {
  const sessionId = useGameSessionStore((state) => state.sessionId);
  const setSessionId = useGameSessionStore((state) => state.setSessionId);
  const { mutate, isPending, isError } = useMutation({
    mutationFn: createMafiaGameSession,
    onSuccess: ({ sessionId: createdSessionId }) => {
      setSessionId(createdSessionId);
    },
  });

  useEffect(() => {
    if (!sessionId) {
      mutate();
    }
  }, [mutate, sessionId]);

  return {
    sessionId,
    retry: mutate,
    isCreating: isPending,
    hasCreationError: isError,
  };
}
