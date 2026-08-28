import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearIdempotentDraft, nextIdempotentDraft } from './idempotent-draft';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('idempotent drafts', () => {
  it('reuses the key only while the request value is unchanged', () => {
    const existing = { content: 'I suspect Mina.', idempotencyKey: 'existing-key' };
    vi.stubGlobal('crypto', { randomUUID: () => 'new-key' });

    expect(nextIdempotentDraft({ content: existing.content }, existing, sameContent)).toBe(
      existing,
    );
    expect(nextIdempotentDraft({ content: 'I suspect Joon.' }, existing, sameContent)).toEqual({
      content: 'I suspect Joon.',
      idempotencyKey: 'new-key',
    });
  });

  it('does not clear a newer draft after an older request succeeds', () => {
    const draft = { content: 'I suspect Mina.', idempotencyKey: 'new-key' };

    expect(clearIdempotentDraft(draft, 'old-key')).toBe(draft);
    expect(clearIdempotentDraft(draft, 'new-key')).toBeUndefined();
  });
});

function sameContent(value: { content: string }, draft: { content: string }) {
  return value.content === draft.content;
}
