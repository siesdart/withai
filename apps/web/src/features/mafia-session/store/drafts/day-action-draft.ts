import { match } from 'ts-pattern';

import { type IdempotentDraft, nextIdempotentDraft } from './idempotent-draft';

export type DayAction =
  | { type: 'nomination'; targetParticipantId: string }
  | { type: 'verdict'; vote: 'eliminate' | 'spare' }
  | { type: 'final-defence'; content: string }
  | { type: 'mafia-target'; targetParticipantId: string }
  | { type: 'doctor-protection'; targetParticipantId: string }
  | { type: 'detective-investigation'; targetParticipantId: string };

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
