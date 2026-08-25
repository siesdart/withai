import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type GameSessionState = {
  sessionId: string | undefined;
  creationKey: string | undefined;
  setSessionId: (sessionId: string) => void;
  ensureCreationKey: () => string;
  clearSession: () => void;
};

export const useGameSessionStore = create<GameSessionState>()(
  persist(
    (set, get) => ({
      sessionId: undefined,
      creationKey: undefined,
      setSessionId: (sessionId) => {
        set({ sessionId, creationKey: undefined });
      },
      ensureCreationKey: () => {
        const existingKey = get().creationKey;
        if (existingKey) {
          return existingKey;
        }

        const creationKey = crypto.randomUUID();
        set({ creationKey });
        return creationKey;
      },
      clearSession: () => {
        set({ sessionId: undefined, creationKey: undefined });
      },
    }),
    {
      name: 'withai-mafia-game-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ sessionId, creationKey }) => ({ sessionId, creationKey }),
    },
  ),
);
