import type { GameSessionSliceCreator, SessionSlice } from './game-session.types';

export const createSessionSlice: GameSessionSliceCreator<SessionSlice> = (set, get) => ({
  sessionId: undefined,
  outputLanguage: undefined,
  creationKey: undefined,
  setSessionId: (sessionId, outputLanguage) => {
    set({
      sessionId,
      outputLanguage,
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
  resetCreationKey: () => {
    set({ creationKey: undefined });
  },
  clearSession: () => {
    set({
      sessionId: undefined,
      outputLanguage: undefined,
      creationKey: undefined,
      gameActionDrafts: {},
    });
  },
});
