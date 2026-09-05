import { useCallback } from 'react';

import type { UseGameActionResult } from '../../hooks/actions/use-game-action';
import { MessageForm } from './message-form';

type FinalDefenceFormProps = {
  disabled: boolean;
  gameAction: UseGameActionResult;
};

export function FinalDefenceForm({ disabled, gameAction }: FinalDefenceFormProps) {
  const draft = gameAction.drafts['final-defence'];
  const content = draft?.type === 'final-defence' ? draft.content : '';
  const onContentChange = useCallback(
    (nextContent: string) => gameAction.setDraft({ type: 'final-defence', content: nextContent }),
    [gameAction],
  );
  const onSubmit = useCallback(() => gameAction.submitDraft('final-defence'), [gameAction]);

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
