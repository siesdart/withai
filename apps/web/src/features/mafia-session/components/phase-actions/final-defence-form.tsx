/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- form-local input and submit handlers own the Final Defence draft lifecycle. */
import { Button } from '@repo/ui/components/button';
import { Field, FieldGroup, FieldLabel } from '@repo/ui/components/field';
import { Textarea } from '@repo/ui/components/textarea';
import { useState } from 'react';

type FinalDefenceFormProps = {
  disabled: boolean;
  onSubmitFinalDefence: (content: string) => void;
};

export function FinalDefenceForm({ disabled, onSubmitFinalDefence }: FinalDefenceFormProps) {
  const [content, setContent] = useState('');

  return (
    <form
      className="mt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (content.trim()) {
          onSubmitFinalDefence(content);
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="final-defence">Your final defence</FieldLabel>
          <Textarea
            id="final-defence"
            disabled={disabled}
            maxLength={500}
            onChange={(event) => setContent(event.target.value)}
            value={content}
          />
          <div className="flex justify-end">
            <Button disabled={disabled || !content.trim()} type="submit">
              Deliver final defence
            </Button>
          </div>
        </Field>
      </FieldGroup>
    </form>
  );
}
