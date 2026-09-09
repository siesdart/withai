import { afterEach, describe, expect, it } from '@jest/globals';
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

    await authority.acquireReconnectLease('session-1', 'connection-1', 'holder-1');
    await expect(
      authority.releaseReconnectLeaseAndBeginGrace(
        'session-1',
        'connection-1',
        '2026-09-05T00:02:00.000Z',
      ),
    ).resolves.toEqual({ value: true });
    await expect(authority.load('session-1')).resolves.toMatchObject({
      value: { reconnectGraceDeadline: '2026-09-05T00:02:00.000Z' },
    });
    await authority.save(
      { ...snapshot, nextEventId: 3 },
      { eventId: 3, projection: projection.value },
    );
    await expect(authority.load('session-1')).resolves.toMatchObject({
      value: { reconnectGraceDeadline: '2026-09-05T00:02:00.000Z' },
    });
    await authority.clearReconnectGrace('session-1');
    await expect(authority.load('session-1')).resolves.toMatchObject({
      value: expect.not.objectContaining({ reconnectGraceDeadline: expect.anything() }),
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
      ...createSnapshot('snapshot-race-session'),
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
    const authority = new RedisGameSessionAuthority(redis);

    await authority.acquireReconnectLease('session-1', 'connection-a', 'holder-1');
    await expect(authority.releaseReconnectLease('session-1', 'connection-b')).resolves.toEqual({
      value: false,
    });
    await expect(authority.releaseReconnectLease('session-1', 'connection-a')).resolves.toEqual({
      value: true,
    });
  });

  it('does not expire an active reconnect lease, then expires the inactive session', async () => {
    const redis = new RedisMock();
    redisClients.push(redis);
    const authority = new RedisGameSessionAuthority(redis);
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
    await expect(authority.load('leased-session')).resolves.toEqual({ value: undefined });
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
