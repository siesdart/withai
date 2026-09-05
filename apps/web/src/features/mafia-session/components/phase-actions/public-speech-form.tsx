import { useCallback } from 'react';

import type { UseGameActionResult } from '../../hooks/actions/use-game-action';
import { MessageForm } from './message-form';

type PublicSpeechFormProps = {
  disabled: boolean;
  gameAction: UseGameActionResult;
};

export function PublicSpeechForm({ disabled, gameAction }: PublicSpeechFormProps) {
  const draft = gameAction.drafts['public-speech'];
  const content = draft?.type === 'public-speech' ? draft.content : '';
  const onContentChange = useCallback(
    (nextContent: string) => gameAction.setDraft({ type: 'public-speech', content: nextContent }),
    [gameAction],
  );
  const onSubmit = useCallback(() => gameAction.submitDraft('public-speech'), [gameAction]);

  return (
    <MessageForm
      disabled={disabled}
      error={gameAction.error}
      onSubmit={onSubmit}
      onValueChange={onContentChange}
      value={content}
    />
  );
}
