/* oxlint-disable typescript/no-unsafe-type-assertion, eslint/no-await-in-loop, unicorn/no-array-sort -- the deterministic timer queue uses numeric opaque handles and ordered sequential execution. */
import { randomUUID } from 'node:crypto';
import { get } from 'node:http';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MafiaGameModule, mafiaGameConfig, type MafiaDayDurations } from '@repo/mafia';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import {
  agentDecisionGateway,
  type AgentDecisionGateway,
} from '../src/game-sessions/agent-decision.gateway';
import { RedisGameSessionAuthority } from '../src/game-sessions/durability/redis-game-session-authority';
import { gameSessionClock, type GameSessionClock } from '../src/game-sessions/game-session-clock';
import { GameSessionsService } from '../src/game-sessions/game-sessions.service';

const flushMicrotasks = async (remaining = 10): Promise<void> => {
  if (remaining === 0) return;
  await Promise.resolve();
  return flushMicrotasks(remaining - 1);
};

class ControlledGameSessionClock implements GameSessionClock {
  private current = new Date('2026-09-06T00:00:00.000Z');
  private nextTimerId = 0;
  private readonly timers = new Map<
    number,
    { callback: () => void; dueAt: number; intervalMs: number | undefined }
  >();

  now() {
    return this.current;
  }

  async advanceBy(milliseconds: number) {
    const target = this.now().valueOf() + milliseconds;
    this.current = new Date(target);
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort(([, left], [, right]) => left.dueAt - right.dueAt)[0];
      if (!due) break;
      const [id, timer] = due;
      if (timer.intervalMs === undefined) this.timers.delete(id);
      else timer.dueAt += timer.intervalMs;
      timer.callback();
      await flushMicrotasks();
    }
    await flushMicrotasks();
  }

  elapseWithoutTimers(milliseconds: number) {
    this.current = new Date(this.now().valueOf() + milliseconds);
  }

  reset() {
    this.current = new Date('2026-09-06T00:00:00.000Z');
    this.timers.clear();
  }

  setTimeout(callback: () => void, delayMs: number) {
    return this.schedule(callback, delayMs) as unknown as NodeJS.Timeout;
  }

  clearTimeout(timer: NodeJS.Timeout) {
    this.timers.delete(timer as unknown as number);
  }

  setInterval(callback: () => void, delayMs: number) {
    return this.schedule(callback, delayMs, delayMs) as unknown as NodeJS.Timeout;
  }

  clearInterval(timer: NodeJS.Timeout) {
    this.clearTimeout(timer);
  }

  private schedule(callback: () => void, delayMs: number, intervalMs?: number) {
    const id = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.set(id, {
      callback,
      dueAt: this.now().valueOf() + delayMs,
      intervalMs,
    });
    return id;
  }
}

function firstSetCookie(value: unknown) {
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].split(';')[0];
  }

  if (typeof value === 'string') {
    return value.split(';')[0];
  }

  throw new Error('Expected a guest cookie.');
}

type LifecycleFixture = {
  app: INestApplication;
  close: () => Promise<void>;
  clock: ControlledGameSessionClock;
  gatewaySpy: jest.Mocked<AgentDecisionGateway>;
  redis: Redis;
  prefix: string;
};

const createGatewaySpy = (): jest.Mocked<AgentDecisionGateway> => ({
  decidePublicSpeech: jest.fn(() => ({ type: 'remain-silent' })),
  decideFinalDefence: jest.fn(() => ({ opening: 'I have nothing further to add.', followUp: '' })),
  decideMafiaChatOpening: jest.fn(() => 'I will wait for more information.'),
  decideMafiaChatReply: jest.fn(() => 'I will wait for more information.'),
  selectMafiaTarget: jest.fn(() => undefined),
});

const gatewayCallCount = (gatewaySpy: jest.Mocked<AgentDecisionGateway>) =>
  gatewaySpy.decidePublicSpeech.mock.calls.length +
  gatewaySpy.decideFinalDefence.mock.calls.length +
  gatewaySpy.decideMafiaChatOpening.mock.calls.length +
  gatewaySpy.decideMafiaChatReply.mock.calls.length +
  gatewaySpy.selectMafiaTarget.mock.calls.length;

const createLifecycleFixture = async (options?: {
  clock?: ControlledGameSessionClock;
  gatewaySpy?: jest.Mocked<AgentDecisionGateway>;
  prefix?: string;
  redis?: Redis;
  dayDurations?: MafiaDayDurations;
}): Promise<LifecycleFixture> => {
  const clock = options?.clock ?? new ControlledGameSessionClock();
  const gatewaySpy = options?.gatewaySpy ?? createGatewaySpy();
  const redis = options?.redis ?? new RedisMock();
  const prefix = options?.prefix ?? `withai:lifecycle:${randomUUID()}`;
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(gameSessionClock)
    .useValue(clock)
    .overrideProvider(agentDecisionGateway)
    .useValue(gatewaySpy)
    .compile();
  Object.assign(moduleRef.get(GameSessionsService), {
    authority: new RedisGameSessionAuthority(redis, prefix, () => clock.now()),
    ...(options?.dayDurations && {
      mafiaModule: new MafiaGameModule(undefined, options.dayDurations, () => clock.now()),
    }),
  });

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.listen(0, '127.0.0.1');

  return {
    app,
    clock,
    gatewaySpy,
    redis,
    prefix,
    close: async () => app.close(),
  };
};

const openSse = async (
  app: INestApplication,
  sessionId: string,
  guestCookie: string,
): Promise<{ close: () => Promise<void> }> => {
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected the API test server to have a TCP address.');
  }

  return new Promise((resolve, reject) => {
    const eventRequest = get(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: `/game-sessions/${sessionId}/events`,
        headers: { Cookie: guestCookie },
      },
      (eventResponse) => {
        let body = '';
        eventResponse.setEncoding('utf8');
        eventResponse.on('data', (chunk) => {
          body += chunk;
          if (body.includes('event: snapshot')) {
            resolve({
              close: () =>
                new Promise<void>((close) => {
                  eventResponse.once('close', () => setTimeout(close, 25));
                  eventRequest.destroy();
                  eventResponse.destroy();
                }),
            });
          }
        });
        eventResponse.on('error', reject);
      },
    );
    eventRequest.on('error', reject);
  });
};

describe('Mafia Game Session API', () => {
  let app: INestApplication;
  const redis = new RedisMock();
  const clock = new ControlledGameSessionClock();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(gameSessionClock)
      .useValue(clock)
      .compile();
    Object.assign(moduleRef.get(GameSessionsService), {
      authority: new RedisGameSessionAuthority(redis, 'withai:game-sessions', () => clock.now()),
    });

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
    redis.disconnect();
  });

  afterEach(() => {
    jest.useRealTimers();
    clock.reset();
  });

  it('creates an anonymous session with only the human player private information', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .send({ participantCount: 5 })
      .expect(201);

    expect(createResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringMatching(/^withai_guest=/)]),
    );
    expect(createResponse.body).toMatchObject({
      eventId: 1,
      public: {
        phase: 'night',
        participants: expect.arrayContaining([
          expect.objectContaining({ name: 'You', alive: true }),
        ]),
      },
      personal: {
        participantId: expect.any(String),
        role: expect.any(String),
        allegiance: expect.any(String),
      },
    });
    expect(JSON.stringify(createResponse.body)).not.toContain('agentReasoning');
    expect(createResponse.body.public.participants).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ role: expect.anything() })]),
    );
  });

  it('serves a Redis-backed session after an API restart', async () => {
    const created = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .set('Idempotency-Key', 'api-restart-idempotency-key')
      .send({ participantCount: 5 })
      .expect(201);
    const restartedModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    Object.assign(restartedModule.get(GameSessionsService), {
      authority: new RedisGameSessionAuthority(redis),
    });
    const restartedApp = restartedModule.createNestApplication();
    restartedApp.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await restartedApp.listen(0, '127.0.0.1');
    try {
      await request(restartedApp.getHttpServer())
        .get(`/game-sessions/${created.body.sessionId}/snapshot`)
        .set('Cookie', firstSetCookie(created.headers['set-cookie']))
        .expect(200)
        .expect((response) => {
          expect(response.body.sessionId).toBe(created.body.sessionId);
        });
      const address = restartedApp.getHttpServer().address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected the restarted API server to have a TCP address.');
      }
      const eventBody = await new Promise<string>((resolve, reject) => {
        const eventRequest = get(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: `/game-sessions/${created.body.sessionId}/events`,
            headers: {
              Cookie: firstSetCookie(created.headers['set-cookie']),
              'Last-Event-ID': '0',
            },
          },
          (eventResponse) => {
            let body = '';
            eventResponse.setEncoding('utf8');
            eventResponse.on('data', (chunk) => {
              body += chunk;
              if (body.includes('event: snapshot')) {
                eventResponse.destroy();
                resolve(body);
              }
            });
            eventResponse.on('error', reject);
          },
        );
        eventRequest.on('error', reject);
      });
      expect(eventBody).not.toMatch(/\nid: \d+/);
    } finally {
      await restartedApp.close();
    }
  });

  it('converges concurrent HTTP creation retries through Redis idempotency', async () => {
    const holder = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .send({ participantCount: 5 })
      .expect(201);
    const guestCookie = firstSetCookie(holder.headers['set-cookie']);
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/game-sessions/mafia')
        .set('Cookie', guestCookie)
        .set('Idempotency-Key', 'concurrent-http-creation-key')
        .send({ participantCount: 5 })
        .expect(201),
      request(app.getHttpServer())
        .post('/game-sessions/mafia')
        .set('Cookie', guestCookie)
        .set('Idempotency-Key', 'concurrent-http-creation-key')
        .send({ participantCount: 5 })
        .expect(201),
    ]);
    expect(second.body.sessionId).toBe(first.body.sessionId);
  });

  it('validates optional and required Idempotency-Key parameters', async () => {
    await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .set('Idempotency-Key', 'too-short')
      .send({ participantCount: 5 })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .send({ participantCount: 5 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/game-sessions/${created.body.sessionId}/actions/public-speech`)
      .set('Cookie', firstSetCookie(created.headers['set-cookie']))
      .send({ content: 'I want to hear from the other participants.' })
      .expect(400);
  });

  it('serves an ordered initial snapshot over SSE to the session holder', async () => {
    const created = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .send({ participantCount: 5 });
    const sessionId = String(created.body.sessionId);
    const guestCookie = firstSetCookie(created.headers['set-cookie']);

    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected the API test server to have a TCP address.');
    }

    const eventBody = await new Promise<string>((resolve, reject) => {
      const eventRequest = get(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: `/game-sessions/${sessionId}/events`,
          headers: { Cookie: guestCookie },
        },
        (eventResponse) => {
          let body = '';
          eventResponse.setEncoding('utf8');
          eventResponse.on('data', (chunk) => {
            body += chunk;
            if (body.includes('event: snapshot')) {
              eventResponse.destroy();
              resolve(body);
            }
          });
          eventResponse.on('error', reject);
        },
      );
      eventRequest.on('error', reject);
    });

    expect(eventBody).not.toContain('id: 1');
    expect(eventBody).toContain('event: snapshot');
    expect(eventBody).toContain('"phase":"night"');
  });

  it('accepts a living Human Player public speech exactly once', async () => {
    const created = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .send({ participantCount: 5 })
      .expect(201);
    const guestCookie = firstSetCookie(created.headers['set-cookie']);
    const sessionId = String(created.body.sessionId);
    clock.elapseWithoutTimers(31_000);
    await request(app.getHttpServer())
      .get(`/game-sessions/${sessionId}/snapshot`)
      .set('Cookie', guestCookie)
      .expect(200)
      .expect((response) => expect(response.body.public.phase).toBe('discussion'));

    const speech = await request(app.getHttpServer())
      .post(`/game-sessions/${sessionId}/actions/public-speech`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', 'a-public-speech-idempotency-key')
      .send({ content: "I want to hear everyone's read before we nominate." })
      .expect(201);

    expect(speech.body).toMatchObject({
      eventId: expect.any(Number),
      public: {
        phase: 'discussion',
      },
    });
    const speechEventId = speech.body.eventId;
    expect(speech.body.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'chat',
          message: expect.objectContaining({
            participantId: 'participant-1',
            content: "I want to hear everyone's read before we nominate.",
          }),
        }),
      ]),
    );
    expect(speech.body.public).not.toHaveProperty('chat');
    expect(speech.body.public).not.toHaveProperty('outcomes');

    const retried = await request(app.getHttpServer())
      .post(`/game-sessions/${sessionId}/actions/public-speech`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', 'a-public-speech-idempotency-key')
      .send({ content: "I want to hear everyone's read before we nominate." })
      .expect(201);

    expect(retried.body.eventId).toBe(speechEventId);

    expect(JSON.stringify(speech.body)).not.toContain('"persona":');
    expect(JSON.stringify(speech.body)).not.toContain('"agentReasoning":');

    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected the API test server to have a TCP address.');
    }

    const catchUpBody = await new Promise<string>((resolve, reject) => {
      const eventRequest = get(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: `/game-sessions/${sessionId}/events`,
          headers: { Cookie: guestCookie, 'Last-Event-ID': '1' },
        },
        (eventResponse) => {
          let body = '';
          eventResponse.setEncoding('utf8');
          eventResponse.on('data', (chunk) => {
            body += chunk;
            if (body.includes(`id: ${speechEventId}`)) {
              eventResponse.destroy();
              resolve(body);
            }
          });
          eventResponse.on('error', reject);
        },
      );
      eventRequest.on('error', reject);
    });

    const frames = catchUpBody.trim().split('\n\n');
    expect(frames[0]).toContain('event: snapshot');
    expect(frames[0]).not.toContain('\nid: ');
    const replayedIds = frames.slice(1).map((frame) => {
      const match = /^id: (\d+)/m.exec(frame);
      if (!match) throw new Error('Expected each replay frame to have an event ID.');
      return Number(match[1]);
    });
    expect(replayedIds).toEqual(Array.from({ length: speechEventId - 1 }, (_, index) => index + 2));
  }, 40_000);

  it('throttles new public speech while allowing an idempotent retry', async () => {
    const created = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .send({ participantCount: 5 })
      .expect(201);
    const guestCookie = firstSetCookie(created.headers['set-cookie']);
    const sessionId = String(created.body.sessionId);
    clock.elapseWithoutTimers(31_000);
    await request(app.getHttpServer())
      .get(`/game-sessions/${sessionId}/snapshot`)
      .set('Cookie', guestCookie)
      .expect(200)
      .expect((response) => expect(response.body.public.phase).toBe('discussion'));
    const firstKey = 'first-public-speech-idempotency-key';

    const first = await request(app.getHttpServer())
      .post(`/game-sessions/${sessionId}/actions/public-speech`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', firstKey)
      .send({ content: 'I want more time to consider the evidence.' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/game-sessions/${sessionId}/actions/public-speech`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', 'second-public-speech-idempotency-key')
      .send({ content: 'I have changed my mind.' })
      .expect('Retry-After', '1')
      .expect(429);

    const retried = await request(app.getHttpServer())
      .post(`/game-sessions/${sessionId}/actions/public-speech`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', firstKey)
      .send({ content: 'I want more time to consider the evidence.' })
      .expect(201);

    expect(retried.body.eventId).toBe(first.body.eventId);

    await clock.advanceBy(1100);

    await request(app.getHttpServer())
      .post(`/game-sessions/${sessionId}/actions/public-speech`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', 'second-public-speech-idempotency-key')
      .send({ content: 'I have changed my mind.' })
      .expect(201);
  }, 40_000);

  it('reuses an active Game Session without consuming additional Guest Play Allowance', async () => {
    const first = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .send({ participantCount: 5 });
    const guestCookie = firstSetCookie(first.headers['set-cookie']);

    for (let index = 0; index < 9; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each request must observe the previous allowance count.
      const repeated = await request(app.getHttpServer())
        .post('/game-sessions/mafia')
        .set('Cookie', guestCookie)
        .send({ participantCount: 5 })
        .expect(201);
      expect(repeated.body.sessionId).toBe(first.body.sessionId);
    }

    const repeated = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .set('Cookie', guestCookie)
      .send({ participantCount: 5 })
      .expect(201);
    expect(repeated.body.sessionId).toBe(first.body.sessionId);
  });

  it('reuses a Game Session when a creation request is retried with the same idempotency key', async () => {
    const idempotencyKey = 'a-secure-client-generated-idempotency-key';
    const first = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .set('Idempotency-Key', idempotencyKey)
      .send({ participantCount: 5 })
      .expect(201);

    const retried = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .set('Cookie', firstSetCookie(first.headers['set-cookie']))
      .set('Idempotency-Key', idempotencyKey)
      .send({ participantCount: 5 })
      .expect(201);

    expect(retried.body.sessionId).toBe(first.body.sessionId);
    expect(first.body.eventId).toBe(1);
    expect(retried.body.eventId).toBeGreaterThanOrEqual(1);
  });

  it('does not share an idempotent session with a different guest', async () => {
    const idempotencyKey = 'a-secure-client-generated-idempotency-key';
    const first = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .set('Idempotency-Key', idempotencyKey)
      .send({ participantCount: 5 })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .set('Idempotency-Key', idempotencyKey)
      .send({ participantCount: 5 })
      .expect(201);

    expect(second.body.sessionId).not.toBe(first.body.sessionId);
    await request(app.getHttpServer())
      .get(`/game-sessions/${first.body.sessionId}/snapshot`)
      .set('Cookie', firstSetCookie(second.headers['set-cookie']))
      .expect(403);
  });

  it('rejects idempotency key reuse with a different request body', async () => {
    const idempotencyKey = 'a-secure-client-generated-idempotency-key';
    const first = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .set('Idempotency-Key', idempotencyKey)
      .send({ participantCount: 5 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .set('Cookie', firstSetCookie(first.headers['set-cookie']))
      .set('Idempotency-Key', idempotencyKey)
      .send({ participantCount: 10 })
      .expect(409);
  });

  it('rejects invalid participant counts without consuming the Guest Play Allowance', async () => {
    const first = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .send({ participantCount: 5 })
      .expect(201);
    const guestCookie = firstSetCookie(first.headers['set-cookie']);

    await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .set('Cookie', guestCookie)
      .send({ participantCount: 5.5 })
      .expect(400);

    for (let index = 0; index < 9; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each request must observe the previous allowance count.
      await request(app.getHttpServer())
        .post('/game-sessions/mafia')
        .set('Cookie', guestCookie)
        .send({ participantCount: 5 })
        .expect(201);
    }

    const repeated = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .set('Cookie', guestCookie)
      .send({ participantCount: 5 })
      .expect(201);
    expect(repeated.body.sessionId).toBe(first.body.sessionId);
  });

  it('keeps private Night commands unavailable outside Night without exposing private state', async () => {
    const created = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .send({ participantCount: 5 })
      .expect(201);
    const guestCookie = firstSetCookie(created.headers['set-cookie']);

    const response = await request(app.getHttpServer())
      .post(`/game-sessions/${created.body.sessionId}/actions/public-speech`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', 'public-speech-outside-discussion-key')
      .send({ content: 'The first Night is still resolving.' })
      .expect(400);
    expect(JSON.stringify(response.body)).not.toContain('Detective');
    expect(JSON.stringify(response.body)).not.toContain('Doctor');
  });
});

describe('Mafia Game Session API lifecycle acceptance', () => {
  it('keeps every scheduled Agent Public Chat reply after the first reply commits', async () => {
    const gatewaySpy = createGatewaySpy();
    gatewaySpy.decidePublicSpeech.mockReturnValue({
      type: 'speak',
      content: 'I want to hear more before we nominate.',
      delayMs: 500,
    });
    const fixture = await createLifecycleFixture({ gatewaySpy });
    try {
      const created = await request(fixture.app.getHttpServer())
        .post('/game-sessions/mafia')
        .send({ participantCount: 5 })
        .expect(201);
      const sessionId = String(created.body.sessionId);
      const guestCookie = firstSetCookie(created.headers['set-cookie']);

      await fixture.clock.advanceBy(30_001);
      await request(fixture.app.getHttpServer())
        .post(`/game-sessions/${sessionId}/actions/public-speech`)
        .set('Cookie', guestCookie)
        .set('Idempotency-Key', 'all-agent-public-replies-key')
        .send({ content: 'What should we make of the night?' })
        .expect(201);

      await fixture.clock.advanceBy(1_000);

      await request(fixture.app.getHttpServer())
        .get(`/game-sessions/${sessionId}/snapshot`)
        .set('Cookie', guestCookie)
        .expect(200)
        .expect((response) => {
          const agentMessages = response.body.timeline.filter(
            (item: { type: string; message?: { participantId: string } }) =>
              item.type === 'chat' && item.message?.participantId !== 'participant-1',
          );
          expect(agentMessages).toHaveLength(4);
        });
    } finally {
      await fixture.close();
      fixture.redis.disconnect();
    }
  });

  it('abandons a disconnected SSE session after its grace period while preserving its Night fallback', async () => {
    const fixture = await createLifecycleFixture();
    try {
      const created = await request(fixture.app.getHttpServer())
        .post('/game-sessions/mafia')
        .send({ participantCount: 5 })
        .expect(201);
      const sessionId = String(created.body.sessionId);
      const guestCookie = firstSetCookie(created.headers['set-cookie']);
      const stream = await openSse(fixture.app, sessionId, guestCookie);

      jest.clearAllMocks();
      await stream.close();
      await flushMicrotasks();
      await fixture.clock.advanceBy(60_001);

      await request(fixture.app.getHttpServer())
        .get(`/game-sessions/${sessionId}/snapshot`)
        .set('Cookie', guestCookie)
        .expect(403);
      await request(fixture.app.getHttpServer())
        .post(`/game-sessions/${sessionId}/actions/public-speech`)
        .set('Cookie', guestCookie)
        .set('Idempotency-Key', 'abandoned-session-public-speech-key')
        .send({ content: 'This action must not be accepted.' })
        .expect(403);
      expect(gatewayCallCount(fixture.gatewaySpy)).toBe(1);
    } finally {
      await fixture.close();
      fixture.redis.disconnect();
    }
  });

  it('retains an active SSE session past the idle expiry and expires it after closing', async () => {
    const fixture = await createLifecycleFixture();
    try {
      const created = await request(fixture.app.getHttpServer())
        .post('/game-sessions/mafia')
        .send({ participantCount: 5 })
        .expect(201);
      const sessionId = String(created.body.sessionId);
      const guestCookie = firstSetCookie(created.headers['set-cookie']);
      const stream = await openSse(fixture.app, sessionId, guestCookie);

      await fixture.clock.advanceBy(15 * 60 * 1000 + 1);
      await request(fixture.app.getHttpServer())
        .get(`/game-sessions/${sessionId}/snapshot`)
        .set('Cookie', guestCookie)
        .expect(200);

      await stream.close();
      await flushMicrotasks();
      await fixture.clock.advanceBy(15 * 60 * 1000 + 1);
      await request(fixture.app.getHttpServer())
        .get(`/game-sessions/${sessionId}/snapshot`)
        .set('Cookie', guestCookie)
        .expect(403);
    } finally {
      await fixture.close();
      fixture.redis.disconnect();
    }
  }, 10_000);

  it('recovers an expired phase once after an API restart', async () => {
    const clock = new ControlledGameSessionClock();
    const gatewaySpy = createGatewaySpy();
    const redis = new RedisMock();
    const prefix = `withai:lifecycle:${randomUUID()}`;
    const first = await createLifecycleFixture({ clock, gatewaySpy, prefix, redis });
    try {
      const created = await request(first.app.getHttpServer())
        .post('/game-sessions/mafia')
        .send({ participantCount: 5 })
        .expect(201);
      const sessionId = String(created.body.sessionId);
      const guestCookie = firstSetCookie(created.headers['set-cookie']);

      await first.close();
      clock.elapseWithoutTimers(30_001);

      const second = await createLifecycleFixture({ clock, gatewaySpy, prefix, redis });
      try {
        const recovered = await request(second.app.getHttpServer())
          .get(`/game-sessions/${sessionId}/snapshot`)
          .set('Cookie', guestCookie)
          .expect(200);
        expect(recovered.body.public.phase).toBe('discussion');

        const repeated = await request(second.app.getHttpServer())
          .get(`/game-sessions/${sessionId}/snapshot`)
          .set('Cookie', guestCookie)
          .expect(200);
        expect(repeated.body.public.phase).toBe('discussion');
        expect(repeated.body.eventId).toBe(recovered.body.eventId);
      } finally {
        await second.close();
      }
    } finally {
      redis.disconnect();
    }
  });

  it('cancels delayed Agent public replies when their phase becomes obsolete', async () => {
    const fixture = await createLifecycleFixture({
      dayDurations: {
        discussionDurationMs: 100,
        finalDefenceDurationMs: mafiaGameConfig.finalDefenceDurationMs,
        nightDurationMs: 30,
        nominationDurationMs: mafiaGameConfig.nominationDurationMs,
        verdictDurationMs: mafiaGameConfig.verdictDurationMs,
      },
    });
    try {
      fixture.gatewaySpy.decidePublicSpeech.mockReturnValue({
        type: 'speak',
        content: 'I have a delayed response.',
        delayMs: 5_000,
      });
      const created = await request(fixture.app.getHttpServer())
        .post('/game-sessions/mafia')
        .send({ participantCount: 5 })
        .expect(201);
      const sessionId = String(created.body.sessionId);
      const guestCookie = firstSetCookie(created.headers['set-cookie']);

      await fixture.clock.advanceBy(31);
      await request(fixture.app.getHttpServer())
        .get(`/game-sessions/${sessionId}/snapshot`)
        .set('Cookie', guestCookie)
        .expect(200)
        .expect((response) => expect(response.body.public.phase).toBe('discussion'));
      await request(fixture.app.getHttpServer())
        .post(`/game-sessions/${sessionId}/actions/public-speech`)
        .set('Cookie', guestCookie)
        .set('Idempotency-Key', 'delayed-agent-public-speech-key')
        .send({ content: 'I want to hear the other participants before we nominate.' })
        .expect(201);

      jest.clearAllMocks();
      await fixture.clock.advanceBy(101);
      await request(fixture.app.getHttpServer())
        .get(`/game-sessions/${sessionId}/snapshot`)
        .set('Cookie', guestCookie)
        .expect(200)
        .expect((response) => expect(response.body.public.phase).toBe('nomination'));
      await fixture.clock.advanceBy(5_000);

      expect(fixture.gatewaySpy.decidePublicSpeech.mock.calls).toHaveLength(0);
    } finally {
      await fixture.close();
      fixture.redis.disconnect();
    }
  });
});
/* oxlint-disable eslint/no-await-in-loop -- the allowance is intentionally observed after each creation. */
