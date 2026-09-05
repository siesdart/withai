import { omit } from 'remeda';
import { match } from 'ts-pattern';

import { type IdempotentDraft, nextIdempotentDraft } from './idempotent-draft';

export type GameAction =
  | { type: 'public-speech'; content: string }
  | { type: 'mafia-chat'; content: string }
  | { type: 'nomination'; targetParticipantId: string }
  | { type: 'verdict'; vote: 'eliminate' | 'spare' }
  | { type: 'final-defence'; content: string }
  | { type: 'mafia-target'; targetParticipantId: string }
  | { type: 'doctor-protection'; targetParticipantId: string }
  | { type: 'detective-investigation'; targetParticipantId: string };

export type GameActionDraft = IdempotentDraft<GameAction>;
export type GameActionDrafts = Partial<Record<GameAction['type'], GameActionDraft>>;

export function nextGameActionDraft(
  action: GameAction,
  existing: GameActionDraft | undefined,
): GameActionDraft | undefined {
  if (isEmptyMessage(action)) {
    return undefined;
  }

  return nextIdempotentDraft(action, existing, isSameGameAction);
}

export function nextGameActionDrafts(
  action: GameAction,
  existing: GameActionDrafts,
): GameActionDrafts {
  const draft = nextGameActionDraft(action, existing[action.type]);
  return draft ? { ...existing, [action.type]: draft } : omit(existing, [action.type]);
}

export function clearGameActionDraft(
  drafts: GameActionDrafts,
  actionType: GameAction['type'],
  idempotencyKey: string,
): GameActionDrafts {
  return drafts[actionType]?.idempotencyKey === idempotencyKey
    ? omit(drafts, [actionType])
    : drafts;
}

function isEmptyMessage(action: GameAction) {
  return match(action)
    .with(
      { type: 'public-speech' },
      { type: 'mafia-chat' },
      { type: 'final-defence' },
      ({ content }) => !content.trim(),
    )
    .otherwise(() => false);
}

function isSameGameAction(action: GameAction, draft: GameActionDraft) {
  return match(action)
    .with(
      { type: 'public-speech' },
      (next) => draft.type === 'public-speech' && next.content === draft.content,
    )
    .with(
      { type: 'mafia-chat' },
      (next) => draft.type === 'mafia-chat' && next.content === draft.content,
    )
    .with(
      { type: 'nomination' },
      (next) =>
        draft.type === 'nomination' && next.targetParticipantId === draft.targetParticipantId,
    )
    .with({ type: 'verdict' }, (next) => draft.type === 'verdict' && next.vote === draft.vote)
    .with(
      { type: 'final-defence' },
      (next) => draft.type === 'final-defence' && next.content === draft.content,
    )
    .with(
      { type: 'mafia-target' },
      (next) =>
        draft.type === 'mafia-target' && next.targetParticipantId === draft.targetParticipantId,
    )
    .with(
      { type: 'doctor-protection' },
      (next) =>
        draft.type === 'doctor-protection' &&
        next.targetParticipantId === draft.targetParticipantId,
    )
    .with(
      { type: 'detective-investigation' },
      (next) =>
        draft.type === 'detective-investigation' &&
        next.targetParticipantId === draft.targetParticipantId,
    )
    .exhaustive();
}
