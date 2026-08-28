import { useMutation } from '@tanstack/react-query';
import { match } from 'ts-pattern';

import { MafiaGameSessionClient } from '../api/client';
import { isGameSessionApiError } from '../api/error';
import { type DayAction, type DayActionDraft } from '../store/drafts/day-action-draft';
import { useGameSessionStore } from '../store/game-session';
import { gameSessionMutationOptions } from './game-session-mutation-options';
import { useCooldown } from './use-cooldown';

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
  const ensureDayActionDraft = useGameSessionStore((state) => state.ensureDayActionDraft);
  const clearDayActionDraft = useGameSessionStore((state) => state.clearDayActionDraft);
  const cooldown = useCooldown();
  const client = new MafiaGameSessionClient(sessionId);
  const mutation = useMutation(
    gameSessionMutationOptions({
      sessionId,
      mutationFn: (action: DayActionDraft) =>
        match(action)
          .with({ type: 'nomination' }, (draft) =>
            client.submitNomination(draft.targetParticipantId, draft.idempotencyKey),
          )
          .with({ type: 'verdict' }, (draft) =>
            client.submitVerdict(draft.vote, draft.idempotencyKey),
          )
          .with({ type: 'final-defence' }, (draft) =>
            client.submitFinalDefence(draft.content, draft.idempotencyKey),
          )
          .exhaustive(),
      onRateLimited: cooldown.startCooldown,
    }),
  );
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
