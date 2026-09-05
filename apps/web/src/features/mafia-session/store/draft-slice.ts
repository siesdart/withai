import {
  clearGameActionDraft,
  nextGameActionDrafts,
  type GameAction,
} from './drafts/game-action-draft';
import type { DraftSlice, GameSessionSliceCreator } from './game-session.types';

export const createDraftSlice: GameSessionSliceCreator<DraftSlice> = (set, get) => ({
  gameActionDrafts: {},
  setGameActionDraft: (action: GameAction) => {
    set({ gameActionDrafts: nextGameActionDrafts(action, get().gameActionDrafts) });
  },
  clearGameActionDraft: (actionType, idempotencyKey) => {
    set(({ gameActionDrafts }) => ({
      gameActionDrafts: clearGameActionDraft(gameActionDrafts, actionType, idempotencyKey),
    }));
  },
});
