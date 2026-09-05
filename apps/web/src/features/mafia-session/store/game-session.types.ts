import type { StateCreator } from 'zustand';

import type { GameAction, GameActionDrafts } from './drafts/game-action-draft';

export type GameSessionStore = SessionSlice & DraftSlice;

export type SessionSlice = {
  sessionId: string | undefined;
  creationKey: string | undefined;
  setSessionId: (sessionId: string) => void;
  ensureCreationKey: () => string;
  clearSession: () => void;
};

export type DraftSlice = {
  gameActionDrafts: GameActionDrafts;
  setGameActionDraft: (action: GameAction) => void;
  clearGameActionDraft: (actionType: GameAction['type'], idempotencyKey: string) => void;
};

export type GameSessionSliceCreator<Slice> = StateCreator<GameSessionStore, [], [], Slice>;
