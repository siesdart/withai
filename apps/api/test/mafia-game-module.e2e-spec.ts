import { describe, expect, it } from '@jest/globals';
import { MafiaGameModule } from '@repo/mafia';

describe('MafiaGameModule', () => {
  it('assigns shuffled roles to participant seats using an injected random source', () => {
    const randomValues = [0, 0, 0, 0];
    const gameModule = new MafiaGameModule(() => randomValues.shift() ?? 0);
    const session = gameModule.create({
      sessionId: 'session-1',
      participantCount: 5,
      phaseDeadline: new Date('2026-08-26T00:00:00.000Z'),
    });

    const projection = session.projectionFor('participant-1', 1);

    expect(projection.personal.role).toBe('Detective');
    expect(projection.public.participants).toHaveLength(5);
    expect(projection.public.participants).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ role: expect.anything() })]),
    );
  });
});
