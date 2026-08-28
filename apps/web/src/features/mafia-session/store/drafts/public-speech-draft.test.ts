import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextPublicSpeechDraft } from './public-speech-draft';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nextPublicSpeechDraft', () => {
  it('reuses the idempotency key for an unchanged draft', () => {
    const existing = { content: 'I suspect Mina.', idempotencyKey: 'existing-key' };

    expect(nextPublicSpeechDraft(existing.content, existing)).toBe(existing);
  });

  it('generates a new key after the draft changes', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'new-key' });

    expect(
      nextPublicSpeechDraft('I suspect Joon.', {
        content: 'I suspect Mina.',
        idempotencyKey: 'existing-key',
      }),
    ).toEqual({ content: 'I suspect Joon.', idempotencyKey: 'new-key' });
  });
});
