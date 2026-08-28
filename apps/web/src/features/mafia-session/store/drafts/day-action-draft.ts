import { match } from 'ts-pattern';

import { type IdempotentDraft, nextIdempotentDraft } from './idempotent-draft';

export type DayAction =
  | { type: 'nomination'; targetParticipantId: string }
  | { type: 'verdict'; vote: 'eliminate' | 'spare' }
  | { type: 'final-defence'; content: string };

export type DayActionDraft = IdempotentDraft<DayAction>;

export function nextDayActionDraft(
  action: DayAction,
  existing: DayActionDraft | undefined,
): DayActionDraft {
  return nextIdempotentDraft(action, existing, isSameDayAction);
}

function isSameDayAction(action: DayAction, draft: DayActionDraft) {
  return match(action)
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
    .exhaustive();
}
