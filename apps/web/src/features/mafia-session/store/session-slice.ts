import type { GameSessionSliceCreator, SessionSlice } from './game-session.types';

export const createSessionSlice: GameSessionSliceCreator<SessionSlice> = (set, get) => ({
  sessionId: undefined,
  creationKey: undefined,
  setSessionId: (sessionId) => {
    set({
      sessionId,
      creationKey: undefined,
      gameActionDrafts: {},
    });
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
    set({
      sessionId: undefined,
      creationKey: undefined,
      gameActionDrafts: {},
    });
  },
});
