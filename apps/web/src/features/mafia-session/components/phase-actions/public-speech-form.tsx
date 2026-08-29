import { usePublicSpeech } from '../../hooks/actions/use-public-speech';
import { MessageForm } from './message-form';

type PublicSpeechFormProps = {
  sessionId: string;
  disabled: boolean;
};

export function PublicSpeechForm({ sessionId, disabled }: PublicSpeechFormProps) {
  const speech = usePublicSpeech(sessionId);
  return (
    <MessageForm
      disabled={disabled || speech.isPending || speech.isThrottled}
      error={speech.error}
      onSubmit={speech.submit}
      onValueChange={speech.onContentChange}
      value={speech.content}
    />
  );
}
