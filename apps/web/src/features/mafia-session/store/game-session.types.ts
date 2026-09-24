import type { MafiaOutputLanguage } from '@repo/api/client';
import type { StateCreator } from 'zustand';

import type { GameAction, GameActionDrafts } from './drafts/game-action-draft';

export type GameSessionStore = SessionSlice & DraftSlice;

export type SessionSlice = {
  outputLanguage: MafiaOutputLanguage | undefined;
  playerName: string;
  creationKey: string | undefined;
  setGameSession: (outputLanguage: MafiaOutputLanguage) => void;
  setPlayerName: (playerName: string) => void;
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
