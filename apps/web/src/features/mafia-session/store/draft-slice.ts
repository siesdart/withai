import { nextDayActionDraft, type DayAction } from './drafts/day-action-draft';
import { clearIdempotentDraft } from './drafts/idempotent-draft';
import { nextPublicSpeechDraft } from './drafts/public-speech-draft';
import type { DraftSlice, GameSessionSliceCreator } from './game-session.types';

export const createDraftSlice: GameSessionSliceCreator<DraftSlice> = (set, get) => ({
  publicSpeechDraft: undefined,
  dayActionDraft: undefined,
  setPublicSpeechContent: (content) => {
    set(({ publicSpeechDraft }) => ({
      publicSpeechDraft: nextPublicSpeechDraft(content, publicSpeechDraft),
    }));
  },
  clearPublicSpeechDraft: (idempotencyKey) => {
    set(({ publicSpeechDraft }) => ({
      publicSpeechDraft: clearIdempotentDraft(publicSpeechDraft, idempotencyKey),
    }));
  },
  ensureDayActionDraft: (action: DayAction) => {
    const dayActionDraft = nextDayActionDraft(action, get().dayActionDraft);
    set({ dayActionDraft });
    return dayActionDraft;
  },
  clearDayActionDraft: (idempotencyKey) => {
    set(({ dayActionDraft }) => ({
      dayActionDraft: clearIdempotentDraft(dayActionDraft, idempotencyKey),
    }));
  },
});
