/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- form-local input and submit handlers own the Final Defence draft lifecycle. */
import { Button } from '@repo/ui/components/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@repo/ui/components/field';
import { Textarea } from '@repo/ui/components/textarea';
import { useState } from 'react';

type FinalDefenceFormProps = {
  disabled: boolean;
  error: string | undefined;
  onSubmitFinalDefence: (content: string, onSuccess: () => void) => void;
  retryAfterSeconds: number | undefined;
};

export function FinalDefenceForm({
  disabled,
  error,
  onSubmitFinalDefence,
  retryAfterSeconds,
}: FinalDefenceFormProps) {
  const [content, setContent] = useState('');

  return (
    <form
      className="mt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (content.trim()) {
          onSubmitFinalDefence(content, () => setContent(''));
        }
      }}
    >
      <FieldGroup>
        <Field data-disabled={disabled} data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="final-defence">Your final defence</FieldLabel>
          <Textarea
            id="final-defence"
            disabled={disabled}
            maxLength={500}
            onChange={(event) => setContent(event.target.value)}
            value={content}
          />
          {error ? <FieldError>{error}</FieldError> : null}
          {retryAfterSeconds ? (
            <FieldDescription>Wait {retryAfterSeconds}s before trying again.</FieldDescription>
          ) : null}
          <div className="flex justify-end">
            <Button disabled={disabled || !content.trim()} type="submit">
              {retryAfterSeconds ? `Wait ${retryAfterSeconds}s` : 'Deliver final defence'}
            </Button>
          </div>
        </Field>
      </FieldGroup>
    </form>
  );
}
