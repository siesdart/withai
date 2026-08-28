import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { GameSessionsService } from '../src/game-sessions/game-sessions.service';

describe('GameSessionsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('recovers an expired phase when its timer was missed before a snapshot is read', () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decide: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
    });
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

  it('throttles Phase Time Adjustments while allowing an idempotent retry', () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decide: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
    });
    const created = service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a session.');

    const cookie = `withai_guest=${service.signGuestId(created.value.holderId)}`;
    const { phase, phaseDeadline } = created.value.projection.public;
    if (phase === 'completed') throw new Error('Expected an active Phase.');
    const first = service.adjustPhaseTime(
      created.value.projection.sessionId,
      cookie,
      10,
      phase,
      phaseDeadline,
      'first-phase-time-adjustment-key',
    );
    expect(first.isOk()).toBe(true);
    if (first.isErr()) throw new Error('Expected a Phase Time Adjustment.');
    const { phase: adjustedPhase, phaseDeadline: adjustedPhaseDeadline } = first.value.public;
    if (adjustedPhase === 'completed') throw new Error('Expected an active Phase.');

    expect(
      service.adjustPhaseTime(
        created.value.projection.sessionId,
        cookie,
        -10,
        adjustedPhase,
        adjustedPhaseDeadline,
        'second-phase-time-adjustment-key',
      ),
    ).toEqual({ error: { type: 'phase-time-adjustment-rate-limited', retryAfterMs: 1000 } });
    expect(
      service.adjustPhaseTime(
        created.value.projection.sessionId,
        cookie,
        10,
        phase,
        phaseDeadline,
        'first-phase-time-adjustment-key',
      ),
    ).toEqual(first);
    expect(
      service.adjustPhaseTime(
        created.value.projection.sessionId,
        cookie,
        10,
        adjustedPhase,
        adjustedPhaseDeadline,
        'first-phase-time-adjustment-key',
      ),
    ).toEqual({ error: { type: 'phase-time-adjustment-idempotency-conflict' } });
  });

  it('rejects a Phase Time Adjustment for a stale Phase deadline', () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decide: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
    });
    const created = service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a session.');

    const cookie = `withai_guest=${service.signGuestId(created.value.holderId)}`;
    expect(
      service.adjustPhaseTime(
        created.value.projection.sessionId,
        cookie,
        10,
        'day-discussion',
        '2026-08-27T17:11:50.000Z',
        'stale-phase-time-adjustment-key',
      ),
    ).toEqual({ error: { type: 'stale-phase-time-adjustment' } });
  });
});
