/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- input and submit handlers adapt DOM events to the controlled form contract. */
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { SendIcon } from 'lucide-react';

import { useGameTranslation } from '../../i18n/use-game-translation';

type MessageFormProps = {
  disabled: boolean;
  error?: string;
  onSubmit: () => void;
  onValueChange: (value: string) => void;
  value: string;
};

export function MessageForm({ disabled, error, onSubmit, onValueChange, value }: MessageFormProps) {
  const { t } = useGameTranslation();

  return (
    <form
      className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) {
          onSubmit();
        }
      }}
    >
      <div className="flex items-center gap-2" data-disabled={disabled}>
        <Input
          type="text"
          aria-invalid={Boolean(error)}
          aria-label={t('message.label')}
          className="flex-1"
          disabled={disabled}
          maxLength={500}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={t('message.placeholder')}
          value={value}
        />
        <Button
          aria-label={t('message.send')}
          disabled={disabled || !value.trim()}
          size="icon"
          title={t('message.send')}
          type="submit"
        >
          <SendIcon data-icon="inline-end" />
        </Button>
      </div>
      {error ? (
        <div className="mt-2 text-xs font-normal text-destructive" role="alert">
          {error}
        </div>
      ) : null}
    </form>
  );
}
