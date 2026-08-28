import { type IdempotentDraft, nextIdempotentDraft } from './idempotent-draft';

type PublicSpeech = {
  content: string;
};

export type PublicSpeechDraft = IdempotentDraft<PublicSpeech>;

export function nextPublicSpeechDraft(
  content: string,
  existing: PublicSpeechDraft | undefined,
): PublicSpeechDraft | undefined {
  if (!content.trim()) {
    return undefined;
  }

  return nextIdempotentDraft(
    { content },
    existing,
    (value, draft) => value.content === draft.content,
  );
}
