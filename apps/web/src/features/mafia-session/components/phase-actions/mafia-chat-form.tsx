import { useCallback } from 'react';

import type { UseGameActionResult } from '../../hooks/actions/use-game-action';
import { MessageForm } from './message-form';

type MafiaChatFormProps = {
  disabled: boolean;
  gameAction: UseGameActionResult;
};

export function MafiaChatForm({ disabled, gameAction }: MafiaChatFormProps) {
  const draft = gameAction.drafts['mafia-chat'];
  const content = draft?.type === 'mafia-chat' ? draft.content : '';
  const onContentChange = useCallback(
    (nextContent: string) => gameAction.setDraft({ type: 'mafia-chat', content: nextContent }),
    [gameAction],
  );
  const onSubmit = useCallback(() => gameAction.submitDraft('mafia-chat'), [gameAction]);

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
