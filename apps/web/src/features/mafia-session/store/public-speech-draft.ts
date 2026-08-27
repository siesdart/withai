export type PublicSpeechDraft = {
  content: string;
  idempotencyKey: string;
};

export function nextPublicSpeechDraft(
  content: string,
  existing: PublicSpeechDraft | undefined,
): PublicSpeechDraft | undefined {
  if (!content.trim()) {
    return undefined;
  }

  if (existing?.content === content) {
    return existing;
  }

  return { content, idempotencyKey: crypto.randomUUID() };
}
