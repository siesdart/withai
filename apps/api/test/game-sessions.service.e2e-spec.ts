/* oxlint-disable typescript/no-unsafe-type-assertion -- The controller is exercised with the narrow HTTP surface it uses. */
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { MafiaGameSession } from '@repo/mafia';
import type { Request, Response } from 'express';
import RedisMock from 'ioredis-mock';
import { errAsync, ok, okAsync, type Result } from 'neverthrow';
import { Observable } from 'rxjs';

import { RedisGameSessionAuthority } from '../src/game-sessions/durability/redis-game-session-authority';
import { MafiaGameSessionProjectionEntity } from '../src/game-sessions/entities/mafia-game-session-projection.entity';
import type { GameSessionError } from '../src/game-sessions/game-session-error';
import { GameSessionsController } from '../src/game-sessions/game-sessions.controller';
import { GameSessionsService } from '../src/game-sessions/game-sessions.service';

const createDeferred = <Value>() => {
  let resolve: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve: (value: Value) => resolve(value) };
};

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

  it('consumes pending phase-entry actions when request hydration restores a session', async () => {
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
    const created = await firstService.createMafiaSession(undefined, 5, 'pending-actions-key');
    if (created.isErr()) throw new Error('Expected a durable session.');
    const stored = await authority.load(created.value.projection.sessionId);
    if (stored.isErr() || !stored.value) throw new Error('Expected an authoritative snapshot.');
    await authority.saveSnapshot({ ...stored.value, agentActionsPending: true });

    const restartedService = new GameSessionsService(agentDecisions);
    Object.assign(restartedService, { authority });
    const cookie = `withai_guest=${restartedService.signGuestId(created.value.holderId)}`;
    await expect(
      restartedService.getProjection(created.value.projection.sessionId, cookie),
    ).resolves.toMatchObject({ value: { sessionId: created.value.projection.sessionId } });
    await expect(authority.load(created.value.projection.sessionId)).resolves.toMatchObject({
      value: { agentActionsPending: false },
    });
    redis.disconnect();
  });

  it('retries pending Agent Mafia Night Chat replies after request hydration', async () => {
    jest.useFakeTimers();
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
    const created = await firstService.createMafiaSession(undefined, 5, 'pending-mafia-chat-key');
    if (created.isErr()) throw new Error('Expected a durable session.');
    const stored = await authority.load(created.value.projection.sessionId);
    if (stored.isErr() || !stored.value) throw new Error('Expected an authoritative snapshot.');
    await authority.saveSnapshot({
      ...stored.value,
      scheduledAgentMafiaChatReplies: [
        { participantId: 'participant-1', content: 'I will commit my action.' },
      ],
    });

    const restartedService = new GameSessionsService(agentDecisions);
    Object.assign(restartedService, { authority });
    const cookie = `withai_guest=${restartedService.signGuestId(created.value.holderId)}`;
    await restartedService.getProjection(created.value.projection.sessionId, cookie);
    await jest.advanceTimersByTimeAsync(1000);

    await expect(authority.load(created.value.projection.sessionId)).resolves.toMatchObject({
      value: { scheduledAgentMafiaChatReplies: [] },
    });
    redis.disconnect();
  });

  it('retries durable Phase recovery after a transient startup failure', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-11T00:00:00.000Z') });
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
    const created = await firstService.createMafiaSession(undefined, 5, 'startup-recovery-key');
    if (created.isErr()) throw new Error('Expected a durable session.');

    jest.clearAllTimers();
    jest.setSystemTime(new Date('2026-09-11T00:10:00.000Z'));
    const resolveExpiredPhase = jest
      .spyOn(authority, 'resolveExpiredPhase')
      .mockImplementationOnce(() =>
        errAsync({ type: 'authority-unavailable', cause: 'temporary' }),
      );
    const restartedService = new GameSessionsService(agentDecisions);
    Object.assign(restartedService, { authority });

    await restartedService.onModuleInit();
    await jest.advanceTimersByTimeAsync(1001);
    await jest.advanceTimersByTimeAsync(1);

    expect(resolveExpiredPhase).toHaveBeenCalledTimes(1);
    const recoveredEvents = await authority.eventsAfter(created.value.projection.sessionId, 1);
    if (recoveredEvents.isErr()) throw new Error('Expected recovered Phase events.');
    expect(recoveredEvents.value).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventId: 2 })]),
    );
    restartedService.onModuleDestroy();
    redis.disconnect();
  });

  it('does not treat an autonomous projection as Human Player activity', async () => {
    let now = new Date('2026-09-11T00:00:00.000Z');
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
      {
        now: () => now,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
      },
    );
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a Game Session.');
    const sessions = (
      service as unknown as {
        sessions: Map<string, { lastAccessedAt: { toISOString(): string } }>;
      }
    ).sessions;

    now = new Date('2026-09-11T00:16:00.000Z');
    expect(service.publishSessionProjection(created.value.projection.sessionId)).toMatchObject({
      value: { sessionId: created.value.projection.sessionId },
    });
    expect(sessions.get(created.value.projection.sessionId)?.lastAccessedAt.toISOString()).toBe(
      '2026-09-11T00:00:00.000Z',
    );
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

  it('converges concurrent creation requests from separate tabs on the active session', async () => {
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis);
    const agentDecisions = {
      decidePublicSpeech: () => ({ type: 'remain-silent' as const }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    };
    const firstTab = new GameSessionsService(agentDecisions);
    const secondTab = new GameSessionsService(agentDecisions);
    Object.assign(firstTab, { authority });
    Object.assign(secondTab, { authority });
    const cookie = `withai_guest=${firstTab.signGuestId('holder-multi-tab')}`;

    const [first, second] = await Promise.all([
      firstTab.createMafiaSession(cookie, 5, 'first-tab-request'),
      secondTab.createMafiaSession(cookie, 5, 'second-tab-request'),
    ]);

    if (first.isErr() || second.isErr()) throw new Error('Expected a shared active session.');
    expect(first.value.projection.sessionId).toBe(second.value.projection.sessionId);
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

  it('retries a phase timer after an authority claim failure', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis, 'withai:claim-retry-test');
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    Object.assign(service, { authority });
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a durable session.');
    const claimPhaseDeadline = jest
      .spyOn(authority, 'claimPhaseDeadline')
      .mockReturnValueOnce(
        errAsync({ type: 'authority-unavailable', cause: new Error('offline') }),
      );

    const deadlineMs = Date.parse(created.value.projection.public.phaseDeadline) - Date.now();
    await jest.advanceTimersByTimeAsync(deadlineMs);
    await jest.advanceTimersByTimeAsync(1000);
    await jest.runOnlyPendingTimersAsync();

    expect(claimPhaseDeadline).toHaveBeenCalledTimes(2);
    redis.disconnect();
  });

  it('retries a phase timer after another replica holds its deadline claim', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-27T17:11:51.000Z') });
    const redis = new RedisMock();
    const authority = new RedisGameSessionAuthority(redis, 'withai:claim-lease-retry-test');
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    Object.assign(service, { authority });
    const created = await service.createMafiaSession(undefined, 5, undefined);
    if (created.isErr()) throw new Error('Expected a durable session.');
    const claimPhaseDeadline = jest
      .spyOn(authority, 'claimPhaseDeadline')
      .mockReturnValueOnce(okAsync(false));

    const deadlineMs = Date.parse(created.value.projection.public.phaseDeadline) - Date.now();
    await jest.advanceTimersByTimeAsync(deadlineMs);
    await jest.advanceTimersByTimeAsync(0);
    expect(claimPhaseDeadline).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(59_999);
    expect(claimPhaseDeadline).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await jest.runOnlyPendingTimersAsync();

    expect(claimPhaseDeadline).toHaveBeenCalledTimes(2);
    redis.disconnect();
  });

  it('does not subscribe to SSE after the client disconnects during hydration', async () => {
    const service = new GameSessionsService({
      decidePublicSpeech: () => ({ type: 'remain-silent' }),
      decideFinalDefence: () => ({ opening: 'I will defend myself.', followUp: 'Please listen.' }),
      decideMafiaChatOpening: () => 'I propose a target.',
      decideMafiaChatReply: () => 'I will commit my action.',
      selectMafiaTarget: () => undefined,
    });
    const controller = new GameSessionsController(service);
    type EventsResult = Result<Observable<MafiaGameSessionProjectionEntity>, GameSessionError>;
    const eventsFor = createDeferred<EventsResult>();
    jest.spyOn(service, 'eventsFor').mockReturnValue(eventsFor.promise);
    const request = Object.assign(new EventEmitter(), {
      destroyed: false,
      headers: {},
    }) as unknown as Request;
    const flushHeaders = jest.fn();
    const write = jest.fn();
    const response = {
      end: jest.fn(),
      flushHeaders,
      set: jest.fn(),
      write,
    } as unknown as Response;
    let subscribed = false;
    const events = new Observable<MafiaGameSessionProjectionEntity>(() => {
      subscribed = true;
    });

    const handling = controller.events('session-id', request, response);
    request.emit('close');
    eventsFor.resolve(ok(events));
    await handling;

    expect(subscribed).toBe(false);
    expect(flushHeaders).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
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
