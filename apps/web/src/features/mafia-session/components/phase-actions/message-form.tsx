/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- input and submit handlers adapt DOM events to the controlled form contract. */
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { SendIcon } from 'lucide-react';

type MessageFormProps = {
  disabled: boolean;
  error?: string;
  onSubmit: () => void;
  onValueChange: (value: string) => void;
  value: string;
};

export function MessageForm({ disabled, error, onSubmit, onValueChange, value }: MessageFormProps) {
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
          aria-label="Message"
          className="flex-1"
          disabled={disabled}
          maxLength={500}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder="Write a message…"
          value={value}
        />
        <Button
          aria-label="Send message"
          disabled={disabled || !value.trim()}
          size="icon"
          title="Send message"
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
