import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { match } from 'ts-pattern';

import { submitPublicSpeech } from '../api/api';
import { isGameSessionApiError } from '../api/error';
import { gameSessionSnapshotOptions } from './use-game-session-snapshot';

export type UsePublicSpeechResult = {
  content: string;
  error: string | undefined;
  isPending: boolean;
  onContentChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  submit: (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
};

export function usePublicSpeech(sessionId: string): UsePublicSpeechResult {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const mutation = useMutation({
    mutationFn: async ({
      speechContent,
      idempotencyKey,
    }: {
      speechContent: string;
      idempotencyKey: string;
    }) => {
      const result = await submitPublicSpeech(sessionId, speechContent, idempotencyKey);
      return result.match(
        (projection) => projection,
        (error) => {
          throw error;
        },
      );
    },
    onSuccess: (projection) => {
      queryClient.setQueryData(gameSessionSnapshotOptions(sessionId).queryKey, projection);
      setContent('');
    },
  });

  const onContentChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(event.target.value);
  }, []);

  const submit = (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    if (!content.trim() || mutation.isPending) {
      return;
    }

    mutation.mutate({ speechContent: content, idempotencyKey: crypto.randomUUID() });
  };

  return {
    content,
    error: mutation.isError ? actionErrorMessage(mutation.error) : undefined,
    isPending: mutation.isPending,
    onContentChange,
    submit,
  };
}

function actionErrorMessage(error: unknown) {
  if (!isGameSessionApiError(error)) {
    return 'Your speech was not accepted. The server state is authoritative.';
  }

  return match(error)
    .with(
      { type: 'action-rejected', status: 409 },
      () => 'This action was already submitted with a different request.',
    )
    .with(
      { type: 'action-rejected' },
      () => 'This public action is no longer permitted; the current Phase may have expired.',
    )
    .otherwise(() => 'Your speech was not accepted. The server state is authoritative.');
}
