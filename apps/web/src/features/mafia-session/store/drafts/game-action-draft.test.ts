import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearGameActionDraft,
  nextGameActionDraft,
  nextGameActionDrafts,
} from './game-action-draft';

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

  it('preserves a Mafia Chat draft when a Mafia target is added and later cleared', () => {
    const chat = {
      type: 'mafia-chat' as const,
      content: 'Let us target Mina.',
      idempotencyKey: 'chat-key',
    };
    const drafts = nextGameActionDrafts(
      { type: 'mafia-target', targetParticipantId: 'participant-mina' },
      { 'mafia-chat': chat },
    );
    const targetKey = drafts['mafia-target']?.idempotencyKey;

    expect(targetKey).toBeDefined();
    expect(clearGameActionDraft(drafts, 'mafia-target', targetKey ?? '')).toEqual({
      'mafia-chat': chat,
    });
  });

  it('clears only the draft whose action type and idempotency key match', () => {
    const drafts = {
      'mafia-chat': {
        type: 'mafia-chat' as const,
        content: 'Do not clear me.',
        idempotencyKey: 'chat-key',
      },
      'mafia-target': {
        type: 'mafia-target' as const,
        targetParticipantId: 'participant-mina',
        idempotencyKey: 'target-key',
      },
    };

    expect(clearGameActionDraft(drafts, 'mafia-target', 'other-key')).toBe(drafts);
    expect(clearGameActionDraft(drafts, 'mafia-target', 'target-key')).toEqual({
      'mafia-chat': drafts['mafia-chat'],
    });
  });
});
