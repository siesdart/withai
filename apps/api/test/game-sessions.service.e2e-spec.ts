import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { MafiaGameSession } from '@repo/mafia';
import { ok } from 'neverthrow';

import { GameSessionsService } from '../src/game-sessions/game-sessions.service';

describe('GameSessionsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('recovers an expired phase when its timer was missed before a snapshot is read', () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
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
        public: { dayNumber: 1, phase: 'discussion' },
      },
    });
  });

  it('retries a phase timer that fires before its deadline', () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a session.');

    jest
      .spyOn(MafiaGameSession.prototype, 'advanceDayPhase')
      .mockImplementationOnce(() => ok({ type: 'not-due' }));

    const deadlineMs = Date.parse(created.value.projection.public.phaseDeadline) - Date.now();
    jest.advanceTimersByTime(deadlineMs);
    jest.advanceTimersByTime(1);

    expect(service.publishSessionProjection(created.value.projection.sessionId)).toMatchObject({
      value: { public: { phase: 'discussion' } },
    });
  });

  it('throttles Discussion Time Adjustments while allowing an idempotent retry', () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a session.');

    const cookie = `withai_guest=${service.signGuestId(created.value.holderId)}`;
    jest.clearAllTimers();
    jest.setSystemTime(new Date(Date.parse(created.value.projection.public.phaseDeadline) + 1));
    const discussion = service.getProjection(created.value.projection.sessionId, cookie);
    if (discussion.isErr()) throw new Error('Expected the initial Night to resolve.');
    const { phaseDeadline } = discussion.value.public;
    const first = service.adjustDiscussionTime(
      created.value.projection.sessionId,
      cookie,
      10,
      phaseDeadline,
      'first-discussion-time-adjustment-key',
    );
    expect(first.isOk()).toBe(true);
    if (first.isErr()) throw new Error('Expected a Discussion Time Adjustment.');
    const { phaseDeadline: adjustedDeadline } = first.value.public;

    expect(
      service.adjustDiscussionTime(
        created.value.projection.sessionId,
        cookie,
        -10,
        adjustedDeadline,
        'second-discussion-time-adjustment-key',
      ),
    ).toEqual({
      error: { type: 'discussion-time-adjustment-rate-limited', retryAfterMs: 1000 },
    });
    expect(
      service.adjustDiscussionTime(
        created.value.projection.sessionId,
        cookie,
        10,
        phaseDeadline,
        'first-discussion-time-adjustment-key',
      ),
    ).toEqual(first);
    expect(
      service.adjustDiscussionTime(
        created.value.projection.sessionId,
        cookie,
        10,
        adjustedDeadline,
        'first-discussion-time-adjustment-key',
      ),
    ).toEqual({ error: { type: 'discussion-time-adjustment-idempotency-conflict' } });
  });

  it('rejects a Discussion Time Adjustment for a stale Phase deadline', () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a session.');

    const cookie = `withai_guest=${service.signGuestId(created.value.holderId)}`;
    jest.clearAllTimers();
    jest.setSystemTime(new Date(Date.parse(created.value.projection.public.phaseDeadline) + 1));
    const discussion = service.getProjection(created.value.projection.sessionId, cookie);
    if (discussion.isErr()) throw new Error('Expected the initial Night to resolve.');
    expect(
      service.adjustDiscussionTime(
        created.value.projection.sessionId,
        cookie,
        10,
        '2026-08-27T17:11:50.000Z',
        'stale-discussion-time-adjustment-key',
      ),
    ).toEqual({ error: { type: 'stale-discussion-time-adjustment' } });
  });
});
