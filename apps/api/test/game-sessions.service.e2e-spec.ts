import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { GameSessionsService } from '../src/game-sessions/game-sessions.service';

describe('GameSessionsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('recovers an expired phase when its timer was missed before a snapshot is read', () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({ decide: () => ({ type: 'remain-silent' }) });
    const created = service.createMafiaSession(undefined, 5, undefined);

    expect(created.isOk()).toBe(true);
    if (created.isErr()) throw new Error('Expected a session.');

    jest.clearAllTimers();
    jest.setSystemTime(new Date('2026-08-27T17:13:51.001Z'));

    const cookie = `withai_guest=${service.signGuestId(created.value.holderId)}`;
    expect(service.getProjection(created.value.projection.sessionId, cookie)).toMatchObject({
      value: {
        eventId: 2,
        public: { phase: 'nomination' },
      },
    });
  });
});
