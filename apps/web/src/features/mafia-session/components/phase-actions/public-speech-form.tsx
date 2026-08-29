import { useCallback } from 'react';

import type { UseGameActionResult } from '../../hooks/actions/use-game-action';
import { MessageForm } from './message-form';

type PublicSpeechFormProps = {
  disabled: boolean;
  gameAction: UseGameActionResult;
};

export function PublicSpeechForm({ disabled, gameAction }: PublicSpeechFormProps) {
  const content = gameAction.draft?.type === 'public-speech' ? gameAction.draft.content : '';
  const onContentChange = useCallback(
    (nextContent: string) => gameAction.setDraft({ type: 'public-speech', content: nextContent }),
    [gameAction],
  );

  return (
    <MessageForm
      disabled={disabled}
      error={gameAction.error}
      onSubmit={gameAction.submitDraft}
      onValueChange={onContentChange}
      value={content}
    />
  );
}
