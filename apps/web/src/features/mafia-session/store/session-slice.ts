import type { GameSessionSliceCreator, SessionSlice } from './game-session.types';

export const createSessionSlice: GameSessionSliceCreator<SessionSlice> = (set, get) => ({
  outputLanguage: undefined,
  playerName: '',
  creationKey: undefined,
  setGameSession: (outputLanguage) => {
    set({
      outputLanguage,
      creationKey: undefined,
      gameActionDrafts: {},
    });
  },
  setPlayerName: (playerName) => {
    set({ playerName });
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
      outputLanguage: undefined,
      creationKey: undefined,
      gameActionDrafts: {},
    });
  },
});
