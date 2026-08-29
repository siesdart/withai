import { nextGameActionDraft, type GameAction } from './drafts/game-action-draft';
import { clearIdempotentDraft } from './drafts/idempotent-draft';
import type { DraftSlice, GameSessionSliceCreator } from './game-session.types';

export const createDraftSlice: GameSessionSliceCreator<DraftSlice> = (set, get) => ({
  gameActionDraft: undefined,
  setGameActionDraft: (action: GameAction) => {
    const gameActionDraft = nextGameActionDraft(action, get().gameActionDraft);
    set({ gameActionDraft });
    return gameActionDraft;
  },
  clearGameActionDraft: (idempotencyKey) => {
    set(({ gameActionDraft }) => ({
      gameActionDraft: clearIdempotentDraft(gameActionDraft, idempotencyKey),
    }));
  },
});
