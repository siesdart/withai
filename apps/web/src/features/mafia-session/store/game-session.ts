import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { createDraftSlice } from './draft-slice';
import type { GameSessionStore } from './game-session.types';
import { createSessionSlice } from './session-slice';

export const useGameSessionStore = create<GameSessionStore>()(
  persist(
    (...args) => ({
      ...createSessionSlice(...args),
      ...createDraftSlice(...args),
    }),
    {
      name: 'withai-mafia-game-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ outputLanguage, creationKey, gameActionDrafts }) => ({
        outputLanguage,
        creationKey,
        gameActionDrafts,
      }),
    },
  ),
);
