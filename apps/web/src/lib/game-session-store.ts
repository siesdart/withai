import { create } from 'zustand';

type GameSessionState = {
  sessionId: string | undefined;
  setSessionId: (sessionId: string) => void;
};

export const useGameSessionStore = create<GameSessionState>((set) => ({
  sessionId: undefined,
  setSessionId: (sessionId) => {
    set({ sessionId });
  },
}));
