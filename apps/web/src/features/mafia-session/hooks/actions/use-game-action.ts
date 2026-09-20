import { useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';
import { match } from 'ts-pattern';

import { MafiaGameSessionClient } from '../../api/client';
import { isGameSessionApiError } from '../../api/error';
import {
  nextGameActionDraft,
  type GameAction,
  type GameActionDraft,
  type GameActionDrafts,
} from '../../store/drafts/game-action-draft';
import { useGameSessionStore } from '../../store/game-session';
import { gameSessionMutationOptions } from '../options/game-session-mutation-options';
import { useCooldown } from '../ui/use-cooldown';

export type UseGameActionResult = {
  drafts: GameActionDrafts;
  error: string | undefined;
  isSubmissionBlocked: boolean;
  retryAfterSeconds: number | undefined;
  setDraft: (action: GameAction) => void;
  submit: (action: GameAction) => void;
  submitDraft: (actionType: GameAction['type']) => void;
};

export function useGameAction(): UseGameActionResult {
  const drafts = useGameSessionStore((state) => state.gameActionDrafts);
  const setGameActionDraft = useGameSessionStore((state) => state.setGameActionDraft);
  const clearGameActionDraft = useGameSessionStore((state) => state.clearGameActionDraft);
  const cooldown = useCooldown();
  const client = new MafiaGameSessionClient();
  const { error, isError, isPending, mutate } = useMutation(
    gameSessionMutationOptions({
      mutationFn: (action: GameActionDraft) => submitGameAction(client, action),
      onRateLimited: cooldown.startCooldown,
    }),
  );
  const isSubmissionBlocked = isPending || cooldown.isCoolingDown;

  const submitDraft = useCallback(
    (actionType: GameAction['type']) => {
      const draft = drafts[actionType];
      if (!draft || isSubmissionBlocked) {
        return;
      }

      mutate(draft, {
        onSuccess: () => {
          clearGameActionDraft(actionType, draft.idempotencyKey);
        },
      });
    },
    [clearGameActionDraft, drafts, isSubmissionBlocked, mutate],
  );

  const submit = useCallback(
    (action: GameAction) => {
      if (isSubmissionBlocked) {
        return;
      }

      setGameActionDraft(action);
      const nextDraft = nextGameActionDraft(action, drafts[action.type]);
      if (!nextDraft) return;

      mutate(nextDraft, {
        onSuccess: () => {
          clearGameActionDraft(action.type, nextDraft.idempotencyKey);
        },
      });
    },
    [clearGameActionDraft, drafts, isSubmissionBlocked, mutate, setGameActionDraft],
  );

  return {
    drafts,
    error: isError ? gameActionErrorMessage(error) : undefined,
    isSubmissionBlocked,
    retryAfterSeconds: cooldown.retryAfterSeconds,
    setDraft: setGameActionDraft,
    submit,
    submitDraft,
  };
}

function submitGameAction(client: MafiaGameSessionClient, action: GameActionDraft) {
  return match(action)
    .with({ type: 'public-speech' }, (draft) =>
      client.submitPublicSpeech(draft.content, draft.idempotencyKey),
    )
    .with({ type: 'mafia-chat' }, (draft) =>
      client.submitMafiaChat(draft.content, draft.idempotencyKey),
    )
    .with({ type: 'nomination' }, (draft) =>
      client.submitNomination(draft.targetParticipantId, draft.idempotencyKey),
    )
    .with({ type: 'verdict' }, (draft) => client.submitVerdict(draft.vote, draft.idempotencyKey))
    .with({ type: 'final-defence' }, (draft) =>
      client.submitFinalDefence(draft.content, draft.idempotencyKey),
    )
    .with({ type: 'mafia-target' }, (draft) =>
      client.submitMafiaTarget(draft.targetParticipantId, draft.idempotencyKey),
    )
    .with({ type: 'doctor-protection' }, (draft) =>
      client.submitDoctorProtection(draft.targetParticipantId, draft.idempotencyKey),
    )
    .with({ type: 'police-investigation' }, (draft) =>
      client.submitPoliceInvestigation(draft.targetParticipantId, draft.idempotencyKey),
    )
    .exhaustive();
}

function gameActionErrorMessage(error: unknown) {
  if (!isGameSessionApiError(error)) {
    return 'Your action was not accepted. The server state is authoritative.';
  }

  return match(error)
    .with({ type: 'rate-limited' }, () => 'Please wait before submitting another action.')
    .with(
      { type: 'action-rejected', status: 409 },
      () => 'This action was already submitted with a different request.',
    )
    .with(
      { type: 'action-rejected' },
      () => 'This action is no longer permitted; the current Phase may have expired.',
    )
    .with(
      { type: 'holder-token-invalid' },
      () => 'Your action was not accepted. The server state is authoritative.',
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
