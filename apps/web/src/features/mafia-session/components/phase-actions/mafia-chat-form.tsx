import { useCallback } from 'react';

import type { UseGameActionResult } from '../../hooks/actions/use-game-action';
import { MessageForm } from './message-form';

type MafiaChatFormProps = {
  disabled: boolean;
  gameAction: UseGameActionResult;
};

export function MafiaChatForm({ disabled, gameAction }: MafiaChatFormProps) {
  const content = gameAction.draft?.type === 'mafia-chat' ? gameAction.draft.content : '';
  const onContentChange = useCallback(
    (nextContent: string) => gameAction.setDraft({ type: 'mafia-chat', content: nextContent }),
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
