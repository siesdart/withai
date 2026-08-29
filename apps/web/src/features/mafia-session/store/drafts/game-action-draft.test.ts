import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextGameActionDraft } from './game-action-draft';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nextGameActionDraft', () => {
  it('reuses the idempotency key for an unchanged action', () => {
    const existing = {
      type: 'public-speech' as const,
      content: 'I suspect Mina.',
      idempotencyKey: 'existing-key',
    };

    expect(
      nextGameActionDraft({ type: 'public-speech', content: existing.content }, existing),
    ).toBe(existing);
  });

  it('generates a key when the logical action changes', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'new-key' });

    expect(
      nextGameActionDraft(
        { type: 'final-defence', content: 'I acted on the evidence.' },
        { type: 'final-defence', content: 'I need more time.', idempotencyKey: 'existing-key' },
      ),
    ).toEqual({
      type: 'final-defence',
      content: 'I acted on the evidence.',
      idempotencyKey: 'new-key',
    });
  });

  it('clears an empty message draft', () => {
    expect(
      nextGameActionDraft(
        { type: 'public-speech', content: '   ' },
        { type: 'public-speech', content: 'I suspect Mina.', idempotencyKey: 'existing-key' },
      ),
    ).toBeUndefined();
  });
});
