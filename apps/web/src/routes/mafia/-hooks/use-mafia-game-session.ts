import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { createMafiaGameSession } from '@/lib/game-session-api';
import { useGameSessionStore } from '@/lib/game-session-store';

export function useMafiaGameSession() {
  const sessionId = useGameSessionStore((state) => state.sessionId);
  const ensureCreationKey = useGameSessionStore((state) => state.ensureCreationKey);
  const clearSession = useGameSessionStore((state) => state.clearSession);

  const createRequestStartedRef = useRef(false);
  const { mutate, isPending, isError } = useMutation({
    mutationFn: createMafiaGameSession,
    onSuccess: ({ sessionId: createdSessionId }) => {
      useGameSessionStore.getState().setSessionId(createdSessionId);
    },
  });

  const createSession = useCallback(() => {
    createRequestStartedRef.current = true;
    mutate(ensureCreationKey());
  }, [ensureCreationKey, mutate]);

  useEffect(() => {
    if (!sessionId && !createRequestStartedRef.current) {
      createSession();
    }
  }, [createSession, sessionId]);

  const startNewGame = useCallback(() => {
    clearSession();
    createRequestStartedRef.current = false;
    createSession();
  }, [clearSession, createSession]);

  return {
    sessionId,
    retry: createSession,
    startNewGame,
    isCreating: isPending || (!sessionId && !isError),
    hasCreationError: isError,
  };
}
