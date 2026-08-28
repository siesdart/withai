import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { nextDayActionDraft, type DayAction, type DayActionDraft } from './day-action-draft';
import { nextPublicSpeechDraft, type PublicSpeechDraft } from './public-speech-draft';

type GameSessionState = {
  sessionId: string | undefined;
  creationKey: string | undefined;
  publicSpeechDraft: PublicSpeechDraft | undefined;
  dayActionDraft: DayActionDraft | undefined;
  setSessionId: (sessionId: string) => void;
  ensureCreationKey: () => string;
  setPublicSpeechContent: (content: string) => void;
  clearPublicSpeechDraft: (idempotencyKey: string) => void;
  ensureDayActionDraft: (action: DayAction) => DayActionDraft;
  clearDayActionDraft: (idempotencyKey: string) => void;
  clearSession: () => void;
};

export const useGameSessionStore = create<GameSessionState>()(
  persist(
    (set, get) => ({
      sessionId: undefined,
      creationKey: undefined,
      publicSpeechDraft: undefined,
      dayActionDraft: undefined,
      setSessionId: (sessionId) => {
        set({
          sessionId,
          creationKey: undefined,
          publicSpeechDraft: undefined,
          dayActionDraft: undefined,
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
      setPublicSpeechContent: (content) => {
        set(({ publicSpeechDraft }) => ({
          publicSpeechDraft: nextPublicSpeechDraft(content, publicSpeechDraft),
        }));
      },
      clearPublicSpeechDraft: (idempotencyKey) => {
        set(({ publicSpeechDraft }) =>
          publicSpeechDraft?.idempotencyKey === idempotencyKey
            ? { publicSpeechDraft: undefined }
            : {},
        );
      },
      ensureDayActionDraft: (action) => {
        const dayActionDraft = nextDayActionDraft(action, get().dayActionDraft);
        set({ dayActionDraft });
        return dayActionDraft;
      },
      clearDayActionDraft: (idempotencyKey) => {
        set(({ dayActionDraft }) =>
          dayActionDraft?.idempotencyKey === idempotencyKey ? { dayActionDraft: undefined } : {},
        );
      },
      clearSession: () => {
        set({
          sessionId: undefined,
          creationKey: undefined,
          publicSpeechDraft: undefined,
          dayActionDraft: undefined,
        });
      },
    }),
    {
      name: 'withai-mafia-game-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ sessionId, creationKey, publicSpeechDraft, dayActionDraft }) => ({
        sessionId,
        creationKey,
        publicSpeechDraft,
        dayActionDraft,
      }),
    },
  ),
);
