import type { StateCreator } from 'zustand';

import type { GameAction, GameActionDraft } from './drafts/game-action-draft';

export type GameSessionStore = SessionSlice & DraftSlice;

export type SessionSlice = {
  sessionId: string | undefined;
  creationKey: string | undefined;
  setSessionId: (sessionId: string) => void;
  ensureCreationKey: () => string;
  clearSession: () => void;
};

export type DraftSlice = {
  gameActionDraft: GameActionDraft | undefined;
  setGameActionDraft: (action: GameAction) => GameActionDraft | undefined;
  clearGameActionDraft: (idempotencyKey: string) => void;
};

export type GameSessionSliceCreator<Slice> = StateCreator<GameSessionStore, [], [], Slice>;
