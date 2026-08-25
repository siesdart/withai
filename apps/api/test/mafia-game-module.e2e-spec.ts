import { describe, expect, it } from '@jest/globals';
import { MafiaGameModule } from '@repo/mafia';

describe('MafiaGameModule', () => {
  it('returns typed errors for invalid inputs and unknown participants', () => {
    const gameModule = new MafiaGameModule(() => 0);
    const invalidSession = gameModule.create({
      sessionId: 'session-1',
      participantCount: 4,
      phaseDeadline: new Date('2026-08-26T00:00:00.000Z'),
    });

    expect(invalidSession).toMatchObject({
      error: { type: 'invalid-participant-count', participantCount: 4 },
    });

    const validSession = gameModule.create({
      sessionId: 'session-1',
      participantCount: 5,
      phaseDeadline: new Date('2026-08-26T00:00:00.000Z'),
    });
    expect(validSession.isOk()).toBe(true);
    if (validSession.isErr()) {
      throw new Error('Expected a valid Mafia Game Session.');
    }

    expect(validSession.value.projectionFor('unknown-participant', 1)).toMatchObject({
      error: { type: 'unknown-participant', participantId: 'unknown-participant' },
    });
  });

  it('assigns shuffled roles to participant seats using an injected random source', () => {
    const randomValues = [0, 0, 0, 0];
    const gameModule = new MafiaGameModule(() => randomValues.shift() ?? 0);
    const sessionResult = gameModule.create({
      sessionId: 'session-1',
      participantCount: 5,
      phaseDeadline: new Date('2026-08-26T00:00:00.000Z'),
    });
    expect(sessionResult.isOk()).toBe(true);
    if (sessionResult.isErr()) {
      throw new Error('Expected a valid Mafia Game Session.');
    }

    const projectionResult = sessionResult.value.projectionFor('participant-1', 1);
    expect(projectionResult.isOk()).toBe(true);
    if (projectionResult.isErr()) {
      throw new Error('Expected a projection for the known participant.');
    }
    const projection = projectionResult.value;

    expect(projection.personal.role).toBe('Detective');
    expect(projection.public.participants).toHaveLength(5);
    expect(projection.public.participants).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ role: expect.anything() })]),
    );
  });
});
