import { useMutation, useQueryClient } from '@tanstack/react-query';

import { submitFinalDefence, submitNomination, submitVerdict } from '../api/api';
import { type DayAction, type DayActionDraft } from '../store/day-action-draft';
import { useGameSessionStore } from '../store/game-session';
import { gameSessionSnapshotOptions } from './use-game-session-snapshot';

export function useDayAction(sessionId: string) {
  const queryClient = useQueryClient();
  const ensureDayActionDraft = useGameSessionStore((state) => state.ensureDayActionDraft);
  const clearDayActionDraft = useGameSessionStore((state) => state.clearDayActionDraft);
  const mutation = useMutation({
    mutationFn: async (action: DayActionDraft) => {
      const result =
        action.type === 'nomination'
          ? await submitNomination(sessionId, action.targetParticipantId, action.idempotencyKey)
          : action.type === 'verdict'
            ? await submitVerdict(sessionId, action.vote, action.idempotencyKey)
            : await submitFinalDefence(sessionId, action.content, action.idempotencyKey);
      return result.match(
        (projection) => projection,
        (error) => {
          throw error;
        },
      );
    },
    onSuccess: (projection) => {
      queryClient.setQueryData(gameSessionSnapshotOptions(sessionId).queryKey, projection);
    },
  });
  return {
    submit: (action: DayAction) => {
      const draft = ensureDayActionDraft(action);
      mutation.mutate(draft, {
        onSuccess: () => {
          clearDayActionDraft(draft.idempotencyKey);
        },
      });
    },
    isPending: mutation.isPending,
  };
}
