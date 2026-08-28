import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextDayActionDraft } from './day-action-draft';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nextDayActionDraft', () => {
  it('reuses the idempotency key for an unchanged Day action', () => {
    const existing = {
      type: 'nomination' as const,
      targetParticipantId: 'participant-2',
      idempotencyKey: 'existing-key',
    };

    expect(
      nextDayActionDraft({ type: 'nomination', targetParticipantId: 'participant-2' }, existing),
    ).toBe(existing);
  });

  it('generates a key when the logical Day action changes', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'new-key' });

    expect(
      nextDayActionDraft(
        { type: 'final-defence', content: 'I acted on the evidence.' },
        { type: 'final-defence', content: 'I need more time.', idempotencyKey: 'existing-key' },
      ),
    ).toEqual({
      type: 'final-defence',
      content: 'I acted on the evidence.',
      idempotencyKey: 'new-key',
    });
  });
});
