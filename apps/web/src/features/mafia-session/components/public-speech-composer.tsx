import { Button } from '@repo/ui/components/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@repo/ui/components/field';
import { Textarea } from '@repo/ui/components/textarea';
import { SendIcon } from 'lucide-react';

export type PublicSpeechControl = {
  content: string;
  error: string | undefined;
  isPending: boolean;
  isThrottled: boolean;
  retryAfterSeconds: number | undefined;
  onContentChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  submitSpeech: (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
};

type PublicSpeechComposerProps = {
  disabled: boolean;
  speech: PublicSpeechControl;
};

export function PublicSpeechComposer({ disabled, speech }: PublicSpeechComposerProps) {
  const isDisabled = disabled || speech.isPending || speech.isThrottled;

  return (
    <form
      className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-5"
      onSubmit={speech.submitSpeech}
    >
      <FieldGroup>
        <Field data-disabled={isDisabled} data-invalid={Boolean(speech.error)}>
          <FieldLabel htmlFor="public-speech">Your public statement</FieldLabel>
          <Textarea
            id="public-speech"
            aria-invalid={Boolean(speech.error)}
            disabled={isDisabled}
            maxLength={500}
            name="public-speech"
            onChange={speech.onContentChange}
            placeholder="Share your read with the table…"
            value={speech.content}
          />
          {speech.error ? <FieldError>{speech.error}</FieldError> : null}
          <FieldDescription>Living participants can see this immediately.</FieldDescription>
          <div className="flex justify-end">
            <Button disabled={isDisabled || !speech.content.trim()} type="submit">
              <SendIcon data-icon="inline-end" />
              {speech.isPending
                ? 'Sending'
                : speech.isThrottled
                  ? `Wait ${speech.retryAfterSeconds ?? 1}s`
                  : 'Speak publicly'}
            </Button>
          </div>
        </Field>
      </FieldGroup>
    </form>
  );
}
