import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { MafiaGameSession, type MafiaParticipant } from '@repo/mafia';
import dayjs from 'dayjs';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';

import { RedisGameSessionAuthority } from '../src/game-sessions/durability/redis-game-session-authority';

const mafiaParticipants: MafiaParticipant[] = [
  { id: 'participant-1', name: 'You', alive: true, role: 'Mafia' },
  { id: 'participant-2', name: 'Mina', alive: true, role: 'Detective' },
  { id: 'participant-3', name: 'Joon', alive: true, role: 'Doctor' },
  { id: 'participant-4', name: 'Sora', alive: true, role: 'Citizen' },
  { id: 'participant-5', name: 'Hana', alive: true, role: 'Citizen' },
];

const dayDurations = {
  discussionDurationMs: 1000,
  nominationDurationMs: 1000,
  finalDefenceDurationMs: 1000,
  verdictDurationMs: 1000,
  nightDurationMs: 1000,
};

const createMafiaSession = (sessionId: string) =>
  new MafiaGameSession(sessionId, structuredClone(mafiaParticipants), dayDurations);

const createSnapshot = (sessionId: string, lastActivityAt = dayjs().toISOString()) => ({
  sessionId,
  holderId: 'holder-1',
  humanParticipantId: 'participant-1',
  gameSession: createMafiaSession(sessionId).snapshot(),
  nextEventId: 1,
  phaseDeadline: '2026-09-05T00:01:00.000Z',
  lastActivityAt,
  status: 'in-progress' as const,
  reconnectGraceDeadline: undefined,
});

describe('RedisGameSessionAuthority', () => {
  const redisClients: Redis[] = [];

  afterEach(() => {
    for (const client of redisClients.splice(0)) client.disconnect();
  });

  it('keeps an authoritative snapshot and ordered public catch-up events', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis);
    const snapshot = {
      sessionId: 'session-1',
      holderId: 'holder-1',
      humanParticipantId: 'participant-1',
      gameSession: createMafiaSession('session-1').snapshot(),
      nextEventId: 2,
      phaseDeadline: '2026-09-05T00:01:00.000Z',
      lastActivityAt: '2026-09-05T00:00:00.000Z',
      status: 'in-progress' as const,
      reconnectGraceDeadline: undefined,
    };

    const projection = new MafiaGameSession(
      snapshot.sessionId,
      snapshot.gameSession.participants,
      snapshot.gameSession.dayDurations,
    ).projectionFor('participant-1', 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(
      { ...snapshot, nextEventId: 1 },
      { eventId: 1, projection: projection.value },
    );
    await authority.save(
      { ...snapshot, nextEventId: 2 },
      { eventId: 2, projection: projection.value },
    );

    await expect(authority.load('session-1')).resolves.toEqual({
      value: { ...snapshot, nextEventId: 2 },
    });
    await expect(authority.eventsAfter('session-1', 0)).resolves.toMatchObject({
      value: [{ eventId: 1 }, { eventId: 2 }],
    });
    await expect(authority.eventsAfter('session-1', 1)).resolves.toMatchObject({
      value: [{ eventId: 2 }],
    });

    const reconnectGraceDeadline = dayjs().add(5, 'minute').toISOString();
    await authority.acquireReconnectLease('session-1', 'connection-1', 'holder-1');
    await expect(
      authority.releaseReconnectLeaseAndBeginGrace(
        'session-1',
        'connection-1',
        reconnectGraceDeadline,
      ),
    ).resolves.toEqual({ value: true });
    await expect(authority.load('session-1')).resolves.toMatchObject({
      value: { reconnectGraceDeadline },
    });
    await authority.save(
      { ...snapshot, nextEventId: 3 },
      { eventId: 3, projection: projection.value },
    );
    await expect(authority.load('session-1')).resolves.toMatchObject({
      value: { reconnectGraceDeadline },
    });
    await authority.clearReconnectGrace('session-1');
    await expect(authority.load('session-1')).resolves.toMatchObject({
      value: expect.not.objectContaining({ reconnectGraceDeadline: expect.anything() }),
    });
  });

  it('does not let a stale CAS save regress authoritative Human Player activity', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis);
    const snapshot = createSnapshot('activity-session', '2026-09-11T00:00:00.000Z');
    const projection = createMafiaSession('activity-session').projectionFor('participant-1', 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(snapshot, { eventId: 1, projection: projection.value });
    await authority.touch('activity-session', '2026-09-11T00:10:00.000Z');
    await authority.save(
      { ...snapshot, nextEventId: 2 },
      { eventId: 2, projection: projection.value },
    );

    await expect(authority.load('activity-session')).resolves.toMatchObject({
      value: { lastActivityAt: '2026-09-11T00:10:00.000Z' },
    });
  });

  it('abandons an expired Reconnect Lease left by a stopped replica', async () => {
    let now = new Date('2026-09-11T00:00:00.000Z');
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(
      redis,
      'withai:expired-reconnect-lease',
      () => now,
    );
    const snapshot = createSnapshot('lease-session', now.toISOString());
    const projection = createMafiaSession('lease-session').projectionFor('participant-1', 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(snapshot, { eventId: 1, projection: projection.value });
    await authority.acquireReconnectLease('lease-session', 'connection-1', snapshot.holderId);
    const leased = await authority.load('lease-session');
    if (leased.isErr() || !leased.value?.reconnectLeaseDeadline)
      throw new Error('Expected an active Reconnect Lease.');

    now = new Date(Date.parse(leased.value.reconnectLeaseDeadline) + 1);
    await expect(
      authority.abandonIfReconnectLeaseExpired(
        'lease-session',
        leased.value.reconnectLeaseDeadline,
        snapshot.holderId,
      ),
    ).resolves.toEqual({ value: true });
    await expect(authority.load('lease-session')).resolves.toMatchObject({
      value: { status: 'abandoned' },
    });
  });

  it('enforces a Guest Play Allowance atomically for a UTC day', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis);

    await expect(authority.consumeGuestAllowance('holder-1', '2026-09-05', 1)).resolves.toEqual({
      value: true,
    });
    await expect(authority.consumeGuestAllowance('holder-1', '2026-09-05', 1)).resolves.toEqual({
      value: false,
    });
  });

  it('does not let a stale writer replace a newer snapshot', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis);
    const gameSession = createMafiaSession('atomic-session');
    const projection = gameSession.projectionFor('participant-1', 2);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');
    const current = {
      sessionId: 'atomic-session',
      holderId: 'holder-1',
      humanParticipantId: 'participant-1',
      gameSession: gameSession.snapshot(),
      nextEventId: 2,
      phaseDeadline: '2026-09-05T00:01:00.000Z',
      lastActivityAt: '2026-09-05T00:00:00.000Z',
      status: 'in-progress' as const,
      reconnectGraceDeadline: undefined,
    };

    await expect(
      authority.save({ ...current, nextEventId: 1 }, { eventId: 1, projection: projection.value }),
    ).resolves.toEqual({ value: true });
    await expect(
      authority.save(current, { eventId: 2, projection: projection.value }),
    ).resolves.toEqual({
      value: true,
    });
    await expect(
      authority.save({ ...current, nextEventId: 1 }, { eventId: 1, projection: projection.value }),
    ).resolves.toEqual({ value: false });
    await expect(authority.load('atomic-session')).resolves.toMatchObject({
      value: { nextEventId: 2 },
    });
  });

  it('does not let a stale snapshot-only write replace a newer event', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis);
    const gameSession = createMafiaSession('snapshot-race-session');
    const projection = gameSession.projectionFor('participant-1', 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');
    const first = {
      ...createSnapshot('snapshot-race-session', '2026-09-05T00:00:00.000Z'),
      gameSession: gameSession.snapshot(),
      nextEventId: 1,
    };
    const latest = { ...first, nextEventId: 2, lastActivityAt: '2026-09-05T00:01:00.000Z' };

    await expect(
      authority.save(first, { eventId: 1, projection: projection.value }),
    ).resolves.toEqual({
      value: true,
    });
    await expect(
      authority.save(latest, { eventId: 2, projection: projection.value }),
    ).resolves.toEqual({
      value: true,
    });
    await expect(authority.saveSnapshot(first)).resolves.toEqual({ value: false });
    await expect(authority.load('snapshot-race-session')).resolves.toMatchObject({
      value: { nextEventId: 2, lastActivityAt: latest.lastActivityAt },
    });
  });

  it('commits only one concurrent snapshot version', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis);
    const gameSession = createMafiaSession('race-session');
    const projection = gameSession.projectionFor('participant-1', 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');
    const snapshot = {
      sessionId: 'race-session',
      holderId: 'holder-1',
      humanParticipantId: 'participant-1',
      gameSession: gameSession.snapshot(),
      nextEventId: 1,
      phaseDeadline: '2026-09-05T00:01:00.000Z',
      lastActivityAt: '2026-09-05T00:00:00.000Z',
      status: 'in-progress' as const,
      reconnectGraceDeadline: undefined,
    };

    const results = await Promise.all([
      authority.save(snapshot, { eventId: 1, projection: projection.value }),
      authority.save(snapshot, { eventId: 1, projection: projection.value }),
    ]);
    expect(results.filter((result) => result.isOk() && result.value)).toHaveLength(1);
  });

  it('releases only the reconnect lease owner', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis, 'withai:lease-owner-test');

    await authority.acquireReconnectLease('session-1', 'connection-a', 'holder-1');
    await expect(authority.releaseReconnectLease('session-1', 'connection-b')).resolves.toEqual({
      value: false,
    });
    await expect(authority.releaseReconnectLease('session-1', 'connection-a')).resolves.toEqual({
      value: true,
    });
  });

  it('does not expire an active reconnect lease, then retains an inactive session for creation replay', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis, 'withai:idle-replay-retention-test');
    const snapshot = createSnapshot('leased-session', '2020-01-01T00:00:00.000Z');
    const projection = createMafiaSession('leased-session').projectionFor('participant-1', 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(snapshot, { eventId: 1, projection: projection.value });
    await authority.acquireReconnectLease('leased-session', 'connection-1', 'holder-1');
    await authority.expireInactiveSessions();
    await expect(authority.load('leased-session')).resolves.toMatchObject({
      value: { sessionId: 'leased-session', status: 'in-progress' },
    });

    await authority.releaseReconnectLease('leased-session', 'connection-1');
    await authority.expireInactiveSessions();
    await expect(authority.load('leased-session')).resolves.toMatchObject({
      value: { sessionId: 'leased-session', status: 'expired' },
    });
    await expect(authority.activeSnapshots()).resolves.toEqual({ value: [] });
  });

  it('keeps healthy snapshots recoverable while pruning missing and corrupt active entries', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const prefix = 'withai:active-snapshot-pruning';
    const authority = new RedisGameSessionAuthority(redis, prefix);
    const snapshot = createSnapshot('healthy-session');
    const projection = createMafiaSession('healthy-session').projectionFor('participant-1', 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(snapshot, { eventId: 1, projection: projection.value });
    await redis.zadd(`${prefix}:active-sessions`, 0, 'missing-session', 0, 'corrupt-session');
    await redis.set(`${prefix}:snapshots:corrupt-session`, '{');

    await expect(authority.activeSnapshots()).resolves.toMatchObject({
      value: [{ sessionId: 'healthy-session' }],
    });
    await expect(redis.zrangebyscore(`${prefix}:active-sessions`, '-inf', '+inf')).resolves.toEqual(
      ['healthy-session'],
    );
    await expect(redis.get(`${prefix}:snapshots:corrupt-session`)).resolves.toBe('{');
  });

  it('retries a temporarily unavailable indexed snapshot without blocking healthy recovery', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const prefix = 'withai:active-snapshot-retry';
    const authority = new RedisGameSessionAuthority(redis, prefix);
    const healthy = createSnapshot('healthy-session');
    const retrying = createSnapshot('retrying-session');
    const healthyProjection = createMafiaSession('healthy-session').projectionFor(
      'participant-1',
      1,
    );
    const retryingProjection = createMafiaSession('retrying-session').projectionFor(
      'participant-1',
      1,
    );
    if (healthyProjection.isErr() || retryingProjection.isErr())
      throw new Error('Expected Human Player projections.');

    await authority.save(healthy, { eventId: 1, projection: healthyProjection.value });
    await authority.save(retrying, { eventId: 1, projection: retryingProjection.value });
    const originalGet = redis.get.bind(redis);
    const get = jest.spyOn(redis, 'get');
    let retryingSnapshotFailed = false;
    get.mockImplementation((key) => {
      if (!retryingSnapshotFailed && key === `${prefix}:snapshots:retrying-session`) {
        retryingSnapshotFailed = true;
        return Promise.reject(new Error('Temporary Redis read failure.'));
      }
      return originalGet(key);
    });

    await expect(authority.activeSnapshots()).resolves.toMatchObject({
      value: [{ sessionId: 'healthy-session' }],
    });
    get.mockRestore();
    const recovered = await authority.activeSnapshots();
    if (recovered.isErr()) throw new Error('Expected indexed snapshots to recover.');
    expect(recovered.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: 'healthy-session' }),
        expect.objectContaining({ sessionId: 'retrying-session' }),
      ]),
    );
  });

  it('persists authorized read activity before evaluating idle expiry', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis);
    const snapshot = createSnapshot('active-read-session', '2020-01-01T00:00:00.000Z');
    const projection = createMafiaSession('active-read-session').projectionFor('participant-1', 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(snapshot, { eventId: 1, projection: projection.value });
    await authority.touch('active-read-session', dayjs().toISOString());
    await authority.expireInactiveSessions();
    await expect(authority.load('active-read-session')).resolves.toMatchObject({
      value: { sessionId: 'active-read-session' },
    });
  });

  it('does not revive an idle-expired Game Session through activity or a reconnect lease', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis);
    const snapshot = createSnapshot('idle-expired-session', '2020-01-01T00:00:00.000Z');
    const projection = createMafiaSession('idle-expired-session').projectionFor('participant-1', 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(snapshot, { eventId: 1, projection: projection.value });
    await authority.expireInactiveSessions();

    await expect(authority.touch(snapshot.sessionId, dayjs().toISOString())).resolves.toEqual({
      value: false,
    });
    await expect(
      authority.acquireReconnectLease(snapshot.sessionId, 'connection-1', snapshot.holderId),
    ).resolves.toEqual({ value: false });
    await expect(authority.saveSnapshot(snapshot)).resolves.toEqual({ value: false });
    await expect(authority.activeSnapshots()).resolves.toMatchObject({
      value: expect.not.arrayContaining([
        expect.objectContaining({ sessionId: snapshot.sessionId }),
      ]),
    });
    await expect(authority.load(snapshot.sessionId)).resolves.toMatchObject({
      value: { status: 'expired' },
    });
  });

  it('abandons an expired grace period and rejects later writes', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis);
    const snapshot = createSnapshot('abandoned-session');
    const projection = createMafiaSession('abandoned-session').projectionFor('participant-1', 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(snapshot, { eventId: 1, projection: projection.value });
    await authority.acquireReconnectLease('abandoned-session', 'connection-1', 'holder-1');
    const expiredDeadline = '2020-01-01T00:00:00.000Z';
    await authority.releaseReconnectLeaseAndBeginGrace(
      'abandoned-session',
      'connection-1',
      expiredDeadline,
    );
    await expect(
      authority.abandonIfReconnectExpired('abandoned-session', expiredDeadline, 'holder-1'),
    ).resolves.toEqual({ value: true });
    await expect(authority.load('abandoned-session')).resolves.toMatchObject({
      value: { status: 'abandoned' },
    });
    await expect(
      authority.save({ ...snapshot, nextEventId: 2 }, { eventId: 2, projection: projection.value }),
    ).resolves.toEqual({ value: false });
  });

  it('rejects a reconnect after its stored grace deadline before the sweep runs', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis);
    const snapshot = createSnapshot('expired-reconnect-session');
    const projection = createMafiaSession('expired-reconnect-session').projectionFor(
      'participant-1',
      1,
    );
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(snapshot, { eventId: 1, projection: projection.value });
    await authority.acquireReconnectLease('expired-reconnect-session', 'connection-1', 'holder-1');
    await authority.releaseReconnectLeaseAndBeginGrace(
      'expired-reconnect-session',
      'connection-1',
      '2020-01-01T00:00:00.000Z',
    );

    await expect(
      authority.acquireReconnectLease('expired-reconnect-session', 'connection-2', 'holder-1'),
    ).resolves.toEqual({ value: false });
  });

  it('abandons an expired reconnect grace before committing a write', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis);
    const snapshot = createSnapshot('expired-grace-write-session');
    const projection = createMafiaSession('expired-grace-write-session').projectionFor(
      'participant-1',
      1,
    );
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(snapshot, { eventId: 1, projection: projection.value });
    await authority.acquireReconnectLease(
      'expired-grace-write-session',
      'connection-1',
      'holder-1',
    );
    await authority.releaseReconnectLeaseAndBeginGrace(
      'expired-grace-write-session',
      'connection-1',
      '2020-01-01T00:00:00.000Z',
    );

    await expect(
      authority.save({ ...snapshot, nextEventId: 2 }, { eventId: 2, projection: projection.value }),
    ).resolves.toEqual({ value: false });
    await expect(authority.load('expired-grace-write-session')).resolves.toMatchObject({
      value: { status: 'abandoned' },
    });
  });

  it('abandons an expired reconnect lease before committing a write', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    let now = new Date('2026-09-05T00:00:00.000Z');
    const authority = new RedisGameSessionAuthority(redis, 'withai:expired-lease-write', () => now);
    const snapshot = createSnapshot('expired-lease-write-session');
    const projection = createMafiaSession('expired-lease-write-session').projectionFor(
      'participant-1',
      1,
    );
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(snapshot, { eventId: 1, projection: projection.value });
    await authority.acquireReconnectLease(
      'expired-lease-write-session',
      'connection-1',
      'holder-1',
    );
    now = new Date(now.valueOf() + 60_001);

    await expect(
      authority.save({ ...snapshot, nextEventId: 2 }, { eventId: 2, projection: projection.value }),
    ).resolves.toEqual({ value: false });
    await expect(authority.load('expired-lease-write-session')).resolves.toMatchObject({
      value: { status: 'abandoned' },
    });
  });

  it('abandons an expired Reconnect Lease before saving a snapshot', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    let now = new Date('2026-09-05T00:00:00.000Z');
    const authority = new RedisGameSessionAuthority(
      redis,
      'withai:expired-lease-snapshot',
      () => now,
    );
    const snapshot = createSnapshot('expired-lease-snapshot-session');
    const projection = createMafiaSession('expired-lease-snapshot-session').projectionFor(
      'participant-1',
      1,
    );
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(snapshot, { eventId: 1, projection: projection.value });
    await authority.acquireReconnectLease(
      'expired-lease-snapshot-session',
      'connection-1',
      'holder-1',
    );
    now = new Date(now.valueOf() + 60_001);

    await expect(authority.saveSnapshot(snapshot)).resolves.toEqual({ value: false });
    await expect(authority.load('expired-lease-snapshot-session')).resolves.toMatchObject({
      value: { status: 'abandoned' },
    });
  });

  it('replays a Creation Idempotency Key after idle cleanup', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis, 'withai:idle-idempotency-replay-test');
    const snapshot = createSnapshot('idle-idempotency-session', '2020-01-01T00:00:00.000Z');
    const projection = createMafiaSession('idle-idempotency-session').projectionFor(
      'participant-1',
      1,
    );
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await expect(
      authority.create(
        snapshot,
        { eventId: 1, projection: projection.value },
        'holder-1',
        '2026-09-05',
        3,
        { key: 'idle-retry-key', fingerprint: '5' },
      ),
    ).resolves.toEqual({ value: { type: 'created' } });
    await authority.expireInactiveSessions();

    await expect(authority.activeSnapshots()).resolves.toEqual({ value: [] });
    await expect(
      authority.create(
        snapshot,
        { eventId: 1, projection: projection.value },
        'holder-1',
        '2026-09-05',
        3,
        { key: 'idle-retry-key', fingerprint: '5' },
      ),
    ).resolves.toEqual({
      value: {
        type: 'replayed',
        record: { fingerprint: '5', sessionId: 'idle-idempotency-session' },
      },
    });
    await expect(authority.load('idle-idempotency-session')).resolves.toMatchObject({
      value: { sessionId: 'idle-idempotency-session' },
    });
  });

  it('abandons an orphaned reconnect lease after its expiry and releases the active holder', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    let now = new Date('2026-09-05T00:00:00.000Z');
    const authority = new RedisGameSessionAuthority(redis, 'withai:game-sessions', () => now);
    const snapshot = createSnapshot('orphaned-lease-session');
    const projection = createMafiaSession('orphaned-lease-session').projectionFor(
      'participant-1',
      1,
    );
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(snapshot, { eventId: 1, projection: projection.value });
    await authority.acquireReconnectLease('orphaned-lease-session', 'connection-1', 'holder-1');
    now = new Date(now.valueOf() + 60_001);

    await expect(
      authority.acquireReconnectLease('orphaned-lease-session', 'connection-2', 'holder-1'),
    ).resolves.toEqual({ value: false });
    await expect(authority.load('orphaned-lease-session')).resolves.toMatchObject({
      value: { status: 'abandoned' },
    });

    const replacement = createSnapshot('replacement-session');
    const replacementProjection = createMafiaSession('replacement-session').projectionFor(
      'participant-1',
      1,
    );
    if (replacementProjection.isErr()) throw new Error('Expected a Human Player projection.');
    await expect(
      authority.create(
        replacement,
        { eventId: 1, projection: replacementProjection.value },
        'holder-1',
        '2026-09-05',
        3,
        undefined,
      ),
    ).resolves.toEqual({ value: { type: 'created' } });
  });

  it('rejects a phase-deadline claim once authoritative state has changed', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis);
    const snapshot = createSnapshot('deadline-session');
    const projection = createMafiaSession('deadline-session').projectionFor('participant-1', 1);
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');

    await authority.save(snapshot, { eventId: 1, projection: projection.value });
    await authority.save(
      { ...snapshot, nextEventId: 2, phaseDeadline: '2026-09-05T00:02:00.000Z' },
      { eventId: 2, projection: projection.value },
    );
    await expect(
      authority.claimPhaseDeadline('deadline-session', snapshot.phaseDeadline),
    ).resolves.toEqual({ value: false });
  });

  it('removes completed phase recovery from the active index', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis, 'withai:completed-phase-recovery-test');
    const initial = createSnapshot('completed-recovery-session');
    const projection = createMafiaSession('completed-recovery-session').projectionFor(
      'participant-1',
      1,
    );
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');
    await authority.save(initial, { eventId: 1, projection: projection.value });

    await expect(
      authority.resolveExpiredPhase(
        initial.phaseDeadline,
        { ...initial, nextEventId: 2, status: 'completed' },
        { eventId: 2, projection: projection.value },
      ),
    ).resolves.toEqual({ value: true });

    await expect(authority.activeSnapshots()).resolves.toEqual({ value: [] });
    await expect(authority.load('completed-recovery-session')).resolves.toMatchObject({
      value: { status: 'completed' },
    });
  });

  it('does not resolve a phase after lifecycle expiry wins the race', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const prefix = 'withai:expired-phase-recovery-test';
    const authority = new RedisGameSessionAuthority(redis, prefix);
    const initial = createSnapshot('expired-recovery-session');
    const projection = createMafiaSession('expired-recovery-session').projectionFor(
      'participant-1',
      1,
    );
    if (projection.isErr()) throw new Error('Expected a Human Player projection.');
    await authority.save(initial, { eventId: 1, projection: projection.value });
    await redis.set(`${prefix}:lifecycles:expired-recovery-session`, 'idle-expired');

    await expect(
      authority.resolveExpiredPhase(
        initial.phaseDeadline,
        { ...initial, nextEventId: 2 },
        { eventId: 2, projection: projection.value },
      ),
    ).resolves.toEqual({ value: false });
    await expect(authority.load('expired-recovery-session')).resolves.toMatchObject({
      value: { nextEventId: 1, status: 'expired' },
    });
  });

  it('binds a Creation Idempotency Key when returning an active session', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis, 'withai:active-key-binding-test');
    const activeSnapshot = createSnapshot('active-session');
    const activeProjection = createMafiaSession('active-session').projectionFor('participant-1', 1);
    if (activeProjection.isErr()) throw new Error('Expected a Human Player projection.');
    await expect(
      authority.create(
        activeSnapshot,
        { eventId: 1, projection: activeProjection.value },
        'holder-1',
        '2026-09-05',
        3,
        undefined,
      ),
    ).resolves.toEqual({ value: { type: 'created' } });

    const requestSnapshot = createSnapshot('new-session');
    const requestProjection = createMafiaSession('new-session').projectionFor('participant-1', 1);
    if (requestProjection.isErr()) throw new Error('Expected a Human Player projection.');
    await expect(
      authority.create(
        requestSnapshot,
        { eventId: 1, projection: requestProjection.value },
        'holder-1',
        '2026-09-05',
        3,
        { key: 'active-session-request-key', fingerprint: '5' },
      ),
    ).resolves.toEqual({ value: { type: 'active-session', sessionId: 'active-session' } });

    await expect(
      authority.loadCreationIdempotency('holder-1', 'active-session-request-key'),
    ).resolves.toEqual({ value: { fingerprint: '5', sessionId: 'active-session' } });
    await expect(
      authority.create(
        requestSnapshot,
        { eventId: 1, projection: requestProjection.value },
        'holder-1',
        '2026-09-05',
        3,
        { key: 'active-session-request-key', fingerprint: '5' },
      ),
    ).resolves.toEqual({
      value: {
        type: 'replayed',
        record: { fingerprint: '5', sessionId: 'active-session' },
      },
    });
  });
});
