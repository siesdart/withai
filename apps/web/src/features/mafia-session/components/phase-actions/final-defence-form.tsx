import { useCallback, useState } from 'react';

import { MessageForm } from './message-form';

type FinalDefenceFormProps = {
  disabled: boolean;
  error: string | undefined;
  onSubmitFinalDefence: (content: string, onSuccess: () => void) => void;
};

export function FinalDefenceForm({ disabled, error, onSubmitFinalDefence }: FinalDefenceFormProps) {
  const [content, setContent] = useState('');
  const onSubmit = useCallback(
    () => onSubmitFinalDefence(content, () => setContent('')),
    [onSubmitFinalDefence, content],
  );

  return (
    <MessageForm
      disabled={disabled}
      error={error}
      onSubmit={onSubmit}
      onValueChange={setContent}
      value={content}
    />
  );
}
