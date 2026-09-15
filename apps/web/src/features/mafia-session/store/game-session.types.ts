import type { MafiaOutputLanguage } from '@repo/mafia';
import type { StateCreator } from 'zustand';

import type { GameAction, GameActionDrafts } from './drafts/game-action-draft';

export type GameSessionStore = SessionSlice & DraftSlice;

export type SessionSlice = {
  sessionId: string | undefined;
  outputLanguage: MafiaOutputLanguage | undefined;
  creationKey: string | undefined;
  setSessionId: (sessionId: string, outputLanguage: MafiaOutputLanguage) => void;
  ensureCreationKey: () => string;
  resetCreationKey: () => void;
  clearSession: () => void;
};

export type DraftSlice = {
  gameActionDrafts: GameActionDrafts;
  setGameActionDraft: (action: GameAction) => void;
  clearGameActionDraft: (actionType: GameAction['type'], idempotencyKey: string) => void;
};

export type GameSessionSliceCreator<Slice> = StateCreator<GameSessionStore, [], [], Slice>;
