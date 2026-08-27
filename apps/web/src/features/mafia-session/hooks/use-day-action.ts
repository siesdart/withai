import { useMutation, useQueryClient } from '@tanstack/react-query';

import { submitFinalDefence, submitNomination, submitVerdict } from '../api/api';
import { gameSessionSnapshotOptions } from './use-game-session-snapshot';

type DayAction =
  | { type: 'nomination'; targetParticipantId: string }
  | { type: 'verdict'; vote: 'eliminate' | 'spare' }
  | { type: 'final-defence'; content: string };

export function useDayAction(sessionId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (action: DayAction) => {
      const idempotencyKey = crypto.randomUUID();
      const result =
        action.type === 'nomination'
          ? await submitNomination(sessionId, action.targetParticipantId, idempotencyKey)
          : action.type === 'verdict'
            ? await submitVerdict(sessionId, action.vote, idempotencyKey)
            : await submitFinalDefence(sessionId, action.content, idempotencyKey);
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
  return { submit: mutation.mutate, isPending: mutation.isPending };
}
