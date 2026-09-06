import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { MafiaGameSession } from '@repo/mafia';
import RedisMock from 'ioredis-mock';
import { ok } from 'neverthrow';

import { RedisGameSessionAuthority } from '../src/game-sessions/durability/redis-game-session-authority';
import { GameSessionsService } from '../src/game-sessions/game-sessions.service';

describe('GameSessionsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rehydrates a committed session in a new service instance', async () => {
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const firstService = new GameSessionsService(agentDecisions);
    Object.assign(firstService, { authority });
    const created = await firstService.createMafiaSession(undefined, 5, 'restart-key');
    if (created.isErr()) throw new Error('Expected a durable session.');

    const restartedService = new GameSessionsService(agentDecisions);
    Object.assign(restartedService, { authority });
    const cookie = `withai_guest=${restartedService.signGuestId(created.value.holderId)}`;
    await expect(
      restartedService.getProjection(created.value.projection.sessionId, cookie),
    ).resolves.toMatchObject({ value: { sessionId: created.value.projection.sessionId } });
    redis.disconnect();
  });

  it('converges concurrent idempotent creation requests on one Redis session', async () => {
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const left = new GameSessionsService(agentDecisions);
    const right = new GameSessionsService(agentDecisions);
    Object.assign(left, { authority });
    Object.assign(right, { authority });
    const cookie = `withai_guest=${left.signGuestId('holder-race')}`;
    const [first, second] = await Promise.all([
      left.createMafiaSession(cookie, 5, 'same-request'),
      right.createMafiaSession(cookie, 5, 'same-request'),
    ]);
    expect(first).toMatchObject({ value: { projection: { sessionId: expect.any(String) } } });
    expect(second).toMatchObject({ value: { projection: { sessionId: expect.any(String) } } });
    if (first.isErr() || second.isErr()) throw new Error('Expected idempotent creation results.');
    expect(second.value.projection.sessionId).toBe(first.value.projection.sessionId);
    redis.disconnect();
  });

  it('recovers an expired phase when its timer was missed before a snapshot is read', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(undefined, 5, undefined);

    expect(created.isOk()).toBe(true);
    if (created.isErr()) throw new Error('Expected a session.');

    jest.clearAllTimers();
    jest.setSystemTime(new Date('2026-08-27T17:13:51.001Z'));

    const cookie = `withai_guest=${service.signGuestId(created.value.holderId)}`;
    expect(await service.getProjection(created.value.projection.sessionId, cookie)).toMatchObject({
      value: {
        eventId: 3,
        public: { dayNumber: 1, phase: 'discussion' },
      },
    });
  });

  it('retries a phase timer that fires before its deadline', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(undefined, 5, undefined);
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

  it('retains a durable phase timer after a subscriber hydrates the session', async () => {
    let now = new Date('2026-08-27T17:11:51.000Z');
    type TestTimer = {
      callback: () => void;
      deadline: number;
      cancelled: boolean;
    };
    const timers: TestTimer[] = [];
    const timerMetadata = new Map<NodeJS.Timeout, TestTimer>();
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const clock = {
      now: () => now,
      setTimeout: (callback: () => void, delayMs: number) => {
        const metadata = {
          callback,
          deadline: now.valueOf() + delayMs,
          cancelled: false,
        };
        const timer = setTimeout(() => undefined, delayMs);
        timer.unref();
        timers.push(metadata);
        timerMetadata.set(timer, metadata);
        return timer;
      },
      clearTimeout: (timer: NodeJS.Timeout) => {
        const metadata = timerMetadata.get(timer);
        if (metadata) metadata.cancelled = true;
        clearTimeout(timer);
      },
      setInterval: (callback: () => void, delayMs: number) => setInterval(callback, delayMs),
      clearInterval: (timer: NodeJS.Timeout) => clearInterval(timer),
    };
    const service = new GameSessionsService(
      {
        decidePublicSpeech: () => ({ type: 'remain-silent' }),
        decideFinalDefence: () => ({
          opening: 'I will defend myself.',
          followUp: 'Please listen.',
        }),
        decideMafiaChatOpening: () => 'I propose a target.',
        decideMafiaChatReply: () => 'I will commit my action.',
        selectMafiaTarget: () => undefined,
      },
      clock,
    );
    Object.assign(service, { authority });
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a durable session.');
    const claimPhaseDeadline = jest.spyOn(authority, 'claimPhaseDeadline');
    const cookie = `withai_guest=${service.signGuestId(created.value.holderId)}`;
    const events = await service.eventsFor(created.value.projection.sessionId, cookie, undefined);
    expect(events.isOk()).toBe(true);

    const runNextDueTimer = async () => {
      const timer = timers.find(
        (candidate) => !candidate.cancelled && candidate.deadline <= now.valueOf(),
      );
      if (!timer) throw new Error('Expected a phase timer.');
      timer.cancelled = true;
      timer.callback();
      await Promise.all(
        Array.from({ length: 5 }, () => new Promise<void>((resolve) => setImmediate(resolve))),
      );
    };
    now = new Date(created.value.projection.public.phaseDeadline);
    await runNextDueTimer();
    expect(claimPhaseDeadline).toHaveBeenCalledTimes(1);

    await expect(
      authority.eventsAfter(created.value.projection.sessionId, 0),
    ).resolves.toMatchObject({
      value: expect.arrayContaining([
        expect.objectContaining({
          projection: expect.objectContaining({
            public: expect.objectContaining({ phase: 'discussion' }),
          }),
        }),
      ]),
    });
    redis.disconnect();
  });

  it('throttles Discussion Time Adjustments while allowing an idempotent retry', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a session.');

    const cookie = `withai_guest=${service.signGuestId(created.value.holderId)}`;
    jest.clearAllTimers();
    jest.setSystemTime(new Date(Date.parse(created.value.projection.public.phaseDeadline) + 1));
    const discussion = await service.getProjection(created.value.projection.sessionId, cookie);
    if (discussion.isErr()) throw new Error('Expected the initial Night to resolve.');
    const { phaseDeadline } = discussion.value.public;
    const first = await service.adjustDiscussionTime(
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
      await service.adjustDiscussionTime(
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
      await service.adjustDiscussionTime(
        created.value.projection.sessionId,
        cookie,
        10,
        phaseDeadline,
        'first-discussion-time-adjustment-key',
      ),
    ).toEqual(first);
    expect(
      await service.adjustDiscussionTime(
        created.value.projection.sessionId,
        cookie,
        10,
        adjustedDeadline,
        'first-discussion-time-adjustment-key',
      ),
    ).toEqual({ error: { type: 'discussion-time-adjustment-idempotency-conflict' } });
  });

  it('rejects a Discussion Time Adjustment for a stale Phase deadline', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a session.');

    const cookie = `withai_guest=${service.signGuestId(created.value.holderId)}`;
    jest.clearAllTimers();
    jest.setSystemTime(new Date(Date.parse(created.value.projection.public.phaseDeadline) + 1));
    const discussion = await service.getProjection(created.value.projection.sessionId, cookie);
    if (discussion.isErr()) throw new Error('Expected the initial Night to resolve.');
    expect(
      await service.adjustDiscussionTime(
        created.value.projection.sessionId,
        cookie,
        10,
        '2026-08-27T17:11:50.000Z',
        'stale-discussion-time-adjustment-key',
      ),
    ).toEqual({ error: { type: 'stale-discussion-time-adjustment' } });
  });
});
