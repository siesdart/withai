import { useCallback } from 'react';

import type { UseGameActionResult } from '../../hooks/actions/use-game-action';
import { MessageForm } from './message-form';

type FinalDefenceFormProps = {
  disabled: boolean;
  gameAction: UseGameActionResult;
};

export function FinalDefenceForm({ disabled, gameAction }: FinalDefenceFormProps) {
  const content = gameAction.draft?.type === 'final-defence' ? gameAction.draft.content : '';
  const onContentChange = useCallback(
    (nextContent: string) => gameAction.setDraft({ type: 'final-defence', content: nextContent }),
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
