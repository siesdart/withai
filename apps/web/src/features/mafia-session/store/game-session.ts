import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { nextPublicSpeechDraft, type PublicSpeechDraft } from './public-speech-draft';

type GameSessionState = {
  sessionId: string | undefined;
  creationKey: string | undefined;
  publicSpeechDraft: PublicSpeechDraft | undefined;
  setSessionId: (sessionId: string) => void;
  ensureCreationKey: () => string;
  setPublicSpeechContent: (content: string) => void;
  clearPublicSpeechDraft: (idempotencyKey: string) => void;
  clearSession: () => void;
};

export const useGameSessionStore = create<GameSessionState>()(
  persist(
    (set, get) => ({
      sessionId: undefined,
      creationKey: undefined,
      publicSpeechDraft: undefined,
      setSessionId: (sessionId) => {
        set({ sessionId, creationKey: undefined, publicSpeechDraft: undefined });
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
      clearSession: () => {
        set({ sessionId: undefined, creationKey: undefined, publicSpeechDraft: undefined });
      },
    }),
    {
      name: 'withai-mafia-game-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ sessionId, creationKey, publicSpeechDraft }) => ({
        sessionId,
        creationKey,
        publicSpeechDraft,
      }),
    },
  ),
);
