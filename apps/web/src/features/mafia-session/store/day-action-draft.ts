export type DayAction =
  | { type: 'nomination'; targetParticipantId: string }
  | { type: 'verdict'; vote: 'eliminate' | 'spare' }
  | { type: 'final-defence'; content: string };

export type DayActionDraft = DayAction & { idempotencyKey: string };

export function nextDayActionDraft(
  action: DayAction,
  existing: DayActionDraft | undefined,
): DayActionDraft {
  if (existing && isSameDayAction(action, existing)) {
    return existing;
  }

  return { ...action, idempotencyKey: crypto.randomUUID() };
}

function isSameDayAction(action: DayAction, draft: DayActionDraft) {
  if (action.type !== draft.type) return false;
  if (action.type === 'nomination' && draft.type === 'nomination') {
    return action.targetParticipantId === draft.targetParticipantId;
  }
  if (action.type === 'verdict' && draft.type === 'verdict') {
    return action.vote === draft.vote;
  }
  return (
    action.type === 'final-defence' &&
    draft.type === 'final-defence' &&
    action.content === draft.content
  );
}
