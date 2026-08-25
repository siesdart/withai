import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

function firstSetCookie(value: unknown) {
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].split(';')[0];
  }

  if (typeof value === 'string') {
    return value.split(';')[0];
  }

  throw new Error('Expected a guest cookie.');
}

describe('Mafia Game Session API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
        phase: 'day-discussion',
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

    expect(eventBody).toContain('id: 1');
    expect(eventBody).toContain('event: snapshot');
    expect(eventBody).toContain('"phase":"day-discussion"');
  });

  it('enforces ten new sessions per UTC day for one guest identity', async () => {
    const first = await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .send({ participantCount: 5 });
    const guestCookie = firstSetCookie(first.headers['set-cookie']);

    for (let index = 0; index < 9; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each request must observe the previous allowance count.
      await request(app.getHttpServer())
        .post('/game-sessions/mafia')
        .set('Cookie', guestCookie)
        .send({ participantCount: 5 })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .set('Cookie', guestCookie)
      .send({ participantCount: 5 })
      .expect(429);
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
      .set('Idempotency-Key', idempotencyKey)
      .send({ participantCount: 5 })
      .expect(201);

    expect(retried.body.sessionId).toBe(first.body.sessionId);
    expect(first.body.eventId).toBe(1);
    expect(retried.body.eventId).toBe(1);
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

    await request(app.getHttpServer())
      .post('/game-sessions/mafia')
      .set('Cookie', guestCookie)
      .send({ participantCount: 5 })
      .expect(429);
  });
});
/* oxlint-disable eslint/no-await-in-loop -- the allowance is intentionally observed after each creation. */
import { get } from 'node:http';
