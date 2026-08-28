import { useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';
import { match } from 'ts-pattern';

import { MafiaGameSessionClient } from '../../api/client';
import { isGameSessionApiError } from '../../api/error';
import { useGameSessionStore } from '../../store/game-session';
import { gameSessionMutationOptions } from '../options/game-session-mutation-options';
import { useCooldown } from '../ui/use-cooldown';

export type UsePublicSpeechResult = {
  content: string;
  error: string | undefined;
  isPending: boolean;
  isThrottled: boolean;
  retryAfterSeconds: number | undefined;
  onContentChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  submit: (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
};

export function usePublicSpeech(sessionId: string): UsePublicSpeechResult {
  const publicSpeechDraft = useGameSessionStore((state) => state.publicSpeechDraft);
  const setPublicSpeechContent = useGameSessionStore((state) => state.setPublicSpeechContent);
  const clearPublicSpeechDraft = useGameSessionStore((state) => state.clearPublicSpeechDraft);
  const cooldown = useCooldown();
  const client = new MafiaGameSessionClient(sessionId);
  const mutation = useMutation(
    gameSessionMutationOptions({
      sessionId,
      mutationFn: ({
        speechContent,
        idempotencyKey,
      }: {
        speechContent: string;
        idempotencyKey: string;
      }) => client.submitPublicSpeech(speechContent, idempotencyKey),
      onRateLimited: cooldown.startCooldown,
    }),
  );

  const onContentChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setPublicSpeechContent(event.target.value);
    },
    [setPublicSpeechContent],
  );

  const submit = (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    if (!publicSpeechDraft || mutation.isPending || cooldown.isCoolingDown) {
      return;
    }

    mutation.mutate(
      {
        speechContent: publicSpeechDraft.content,
        idempotencyKey: publicSpeechDraft.idempotencyKey,
      },
      {
        onSuccess: () => {
          clearPublicSpeechDraft(publicSpeechDraft.idempotencyKey);
        },
      },
    );
  };

  return {
    content: publicSpeechDraft?.content ?? '',
    error: mutation.isError ? actionErrorMessage(mutation.error) : undefined,
    isPending: mutation.isPending,
    isThrottled: cooldown.isCoolingDown,
    retryAfterSeconds: cooldown.retryAfterSeconds,
    onContentChange,
    submit,
  };
}

function actionErrorMessage(error: unknown) {
  if (!isGameSessionApiError(error)) {
    return 'Your speech was not accepted. The server state is authoritative.';
  }

  return match(error)
    .with({ type: 'rate-limited' }, () => 'Please wait before speaking again.')
    .with(
      { type: 'action-rejected', status: 409 },
      () => 'This action was already submitted with a different request.',
    )
    .with(
      { type: 'action-rejected' },
      () => 'This public action is no longer permitted; the current Phase may have expired.',
    )
    .with(
      { type: 'unavailable' },
      { type: 'aborted' },
      { type: 'invalid-event' },
      { type: 'request-failed' },
      () => 'Your speech was not accepted. The server state is authoritative.',
    )
    .exhaustive();
}
