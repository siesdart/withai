import type { StateCreator } from 'zustand';

import type { DayAction, DayActionDraft } from './drafts/day-action-draft';
import type { PublicSpeechDraft } from './drafts/public-speech-draft';

export type GameSessionStore = SessionSlice & DraftSlice;

export type SessionSlice = {
  sessionId: string | undefined;
  creationKey: string | undefined;
  setSessionId: (sessionId: string) => void;
  ensureCreationKey: () => string;
  clearSession: () => void;
};

export type DraftSlice = {
  publicSpeechDraft: PublicSpeechDraft | undefined;
  dayActionDraft: DayActionDraft | undefined;
  setPublicSpeechContent: (content: string) => void;
  clearPublicSpeechDraft: (idempotencyKey: string) => void;
  ensureDayActionDraft: (action: DayAction) => DayActionDraft;
  clearDayActionDraft: (idempotencyKey: string) => void;
};

export type GameSessionSliceCreator<Slice> = StateCreator<GameSessionStore, [], [], Slice>;
