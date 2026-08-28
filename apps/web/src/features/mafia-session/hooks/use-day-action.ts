import { useMutation, useQueryClient } from '@tanstack/react-query';
import { match } from 'ts-pattern';

import { submitFinalDefence, submitNomination, submitVerdict } from '../api/api';
import { isGameSessionApiError } from '../api/error';
import { type DayAction, type DayActionDraft } from '../store/drafts/day-action-draft';
import { useGameSessionStore } from '../store/game-session';
import { useCooldown } from './use-cooldown';
import { gameSessionSnapshotOptions } from './use-game-session-snapshot';

export type UseDayActionResult = {
  error: string | undefined;
  isCoolingDown: boolean;
  isPending: boolean;
  retryAfterSeconds: number | undefined;
  submit: (action: DayAction, options?: DayActionSubmitOptions) => void;
};

type DayActionSubmitOptions = {
  onSuccess?: () => void;
};

export function useDayAction(sessionId: string): UseDayActionResult {
  const queryClient = useQueryClient();
  const ensureDayActionDraft = useGameSessionStore((state) => state.ensureDayActionDraft);
  const clearDayActionDraft = useGameSessionStore((state) => state.clearDayActionDraft);
  const cooldown = useCooldown();
  const mutation = useMutation({
    mutationFn: async (action: DayActionDraft) => {
      const result = await match(action)
        .with({ type: 'nomination' }, (draft) =>
          submitNomination(sessionId, draft.targetParticipantId, draft.idempotencyKey),
        )
        .with({ type: 'verdict' }, (draft) =>
          submitVerdict(sessionId, draft.vote, draft.idempotencyKey),
        )
        .with({ type: 'final-defence' }, (draft) =>
          submitFinalDefence(sessionId, draft.content, draft.idempotencyKey),
        )
        .exhaustive();
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
    onError: (error) => {
      if (isGameSessionApiError(error) && error.type === 'rate-limited') {
        cooldown.startCooldown(error.retryAfterMs);
      }
    },
  });
  return {
    submit: (action: DayAction, options?: DayActionSubmitOptions) => {
      const draft = ensureDayActionDraft(action);
      mutation.mutate(draft, {
        onSuccess: () => {
          clearDayActionDraft(draft.idempotencyKey);
          options?.onSuccess?.();
        },
      });
    },
    error: mutation.isError ? dayActionErrorMessage(mutation.error) : undefined,
    isCoolingDown: cooldown.isCoolingDown,
    isPending: mutation.isPending,
    retryAfterSeconds: cooldown.retryAfterSeconds,
  };
}

function dayActionErrorMessage(error: unknown) {
  if (!isGameSessionApiError(error)) {
    return 'Your action was not accepted. The server state is authoritative.';
  }

  return match(error)
    .with({ type: 'rate-limited' }, () => 'Please wait before submitting another final defence.')
    .with(
      { type: 'action-rejected', status: 409 },
      () => 'This action was already submitted with a different request.',
    )
    .with(
      { type: 'action-rejected' },
      () => 'This action is no longer permitted; the current Phase may have expired.',
    )
    .with(
      { type: 'unavailable' },
      { type: 'aborted' },
      { type: 'invalid-event' },
      { type: 'request-failed' },
      () => 'Your action was not accepted. The server state is authoritative.',
    )
    .exhaustive();
}
