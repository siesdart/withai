import { describe, expect, it } from '@jest/globals';
import { MafiaGameModule } from '@repo/mafia';
import { filter, map, pipe } from 'remeda';

const timeAt = (milliseconds: number) => new Date(`2026-08-26T00:00:00.${milliseconds}Z`);

describe('MafiaGameModule', () => {
  it('returns typed errors for invalid inputs and unknown participants', () => {
    const gameModule = new MafiaGameModule(() => 0, {
      dayDiscussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
    });
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

  it('records a Phase Time Adjustment before immediately resolving an expired phase', () => {
    const gameModule = new MafiaGameModule(() => 0, {
      dayDiscussionDurationMs: 60_000,
      nominationDurationMs: 60_000,
      finalDefenceDurationMs: 60_000,
      verdictDurationMs: 60_000,
    });
    const sessionResult = gameModule.create({
      sessionId: 'session-time-adjustment',
      participantCount: 5,
      phaseDeadline: new Date('2026-08-26T00:01:00.000Z'),
    });
    if (sessionResult.isErr()) throw new Error('Expected a valid Mafia Game Session.');

    const session = sessionResult.value;
    const now = new Date('2026-08-26T00:00:55.000Z');
    expect(session.adjustPhaseTime('participant-1', -10, now)).toEqual({ value: undefined });
    expect(session.advanceDayPhase(now)).toEqual({
      value: { type: 'phase-advanced', phase: 'nomination' },
    });

    const projectionResult = session.projectionFor('participant-1', 2);
    if (projectionResult.isErr()) throw new Error('Expected a projection.');
    const outcomes = pipe(
      projectionResult.value.public.timeline,
      filter((item) => item.type === 'record'),
      map((item) => item.outcome.type),
    );
    expect(outcomes.slice(-2)).toEqual(['phase-time-adjusted', 'phase-changed']);
    expect(projectionResult.value.public.phase).toBe('nomination');
  });

  it('rejects a Phase Time Adjustment from an eliminated participant', () => {
    const gameModule = new MafiaGameModule(() => 0, {
      dayDiscussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
    });
    const sessionResult = gameModule.create({
      sessionId: 'session-eliminated-time-adjustment',
      participantCount: 5,
      phaseDeadline: new Date('2026-08-26T00:00:00.000Z'),
    });
    if (sessionResult.isErr()) throw new Error('Expected a valid Mafia Game Session.');

    const session = sessionResult.value;
    expect(session.advanceDayPhase(timeAt(1))).toEqual({
      value: { type: 'phase-advanced', phase: 'nomination' },
    });
    for (const participantId of [
      'participant-1',
      'participant-2',
      'participant-3',
      'participant-4',
      'participant-5',
    ]) {
      expect(session.submitNomination(participantId, 'participant-1', timeAt(1))).toEqual({
        value: undefined,
      });
    }
    expect(session.advanceDayPhase(timeAt(3))).toEqual({
      value: { type: 'phase-advanced', phase: 'final-defence' },
    });
    expect(session.advanceDayPhase(timeAt(5))).toEqual({
      value: { type: 'phase-advanced', phase: 'verdict' },
    });
    for (const participantId of [
      'participant-1',
      'participant-2',
      'participant-3',
      'participant-4',
      'participant-5',
    ]) {
      expect(session.submitVerdict(participantId, 'eliminate', timeAt(5))).toEqual({
        value: undefined,
      });
    }
    expect(session.advanceDayPhase(timeAt(7))).toEqual({
      value: { type: 'participant-eliminated', participantId: 'participant-1' },
    });

    expect(session.adjustPhaseTime('participant-1', 10, timeAt(7))).toEqual({
      error: { type: 'dead-participant', participantId: 'participant-1' },
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

  it('resolves a tied nomination without eliminating and requires a strict verdict majority', () => {
    const gameModule = new MafiaGameModule(() => 0, {
      dayDiscussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
    });
    const sessionResult = gameModule.create({
      sessionId: 'session-1',
      participantCount: 5,
      phaseDeadline: new Date('2026-08-26T00:00:00.000Z'),
    });
    expect(sessionResult.isOk()).toBe(true);
    if (sessionResult.isErr()) {
      throw new Error('Expected a valid Mafia Game Session.');
    }

    const session = sessionResult.value;
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:01.000Z'))).toMatchObject({
      value: { type: 'phase-advanced', phase: 'nomination' },
    });
    session.submitNomination(
      'participant-1',
      'participant-2',
      new Date('2026-08-26T00:00:01.000Z'),
    );
    session.submitNomination(
      'participant-2',
      'participant-3',
      new Date('2026-08-26T00:00:01.000Z'),
    );
    const nominationProjection = session.projectionFor('participant-1', 2);
    if (nominationProjection.isErr()) throw new Error('Expected a projection.');
    expect(nominationProjection.value.personal.vote).toEqual({
      phase: 'nomination',
      targetParticipantId: 'participant-2',
    });
    expect(nominationProjection.value.public.voteStatus).toEqual({
      phase: 'nomination',
      submittedParticipantIds: ['participant-1', 'participant-2'],
    });
    expect(nominationProjection.value.public.completedVoteRecords).toEqual([]);
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:02.000Z'))).toMatchObject({
      value: { type: 'day-restarted', reason: 'nomination-tie' },
    });
    const tiedNominationProjection = session.projectionFor('participant-1', 3);
    if (tiedNominationProjection.isErr()) throw new Error('Expected a projection.');
    expect(tiedNominationProjection.value.public.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'record',
          outcome: expect.objectContaining({
            type: 'day-changed',
            dayNumber: 1,
          }),
        }),
        expect.objectContaining({
          type: 'record',
          outcome: expect.objectContaining({
            type: 'phase-changed',
            dayNumber: 1,
            phase: 'day-discussion',
          }),
        }),
        expect.objectContaining({
          type: 'record',
          outcome: expect.objectContaining({
            type: 'phase-changed',
            dayNumber: 1,
            phase: 'nomination',
          }),
        }),
        expect.objectContaining({
          type: 'record',
          outcome: expect.objectContaining({
            type: 'nomination-resolved',
            voteCounts: expect.arrayContaining([
              { participantId: 'participant-2', voteCount: 1 },
              { participantId: 'participant-3', voteCount: 1 },
            ]),
          }),
        }),
        expect.objectContaining({
          type: 'record',
          outcome: expect.objectContaining({
            type: 'day-changed',
            dayNumber: 2,
          }),
        }),
        expect.objectContaining({
          type: 'record',
          outcome: expect.objectContaining({
            type: 'phase-changed',
            dayNumber: 2,
            phase: 'day-discussion',
          }),
        }),
      ]),
    );

    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:03.000Z'))).toMatchObject({
      value: { type: 'phase-advanced', phase: 'nomination' },
    });
    session.submitNomination(
      'participant-1',
      'participant-2',
      new Date('2026-08-26T00:00:03.000Z'),
    );
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:04.000Z'))).toMatchObject({
      value: { type: 'phase-advanced', phase: 'final-defence' },
    });
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:05.000Z'))).toMatchObject({
      value: { type: 'phase-advanced', phase: 'verdict' },
    });
    session.submitVerdict('participant-1', 'eliminate', new Date('2026-08-26T00:00:05.000Z'));
    session.submitVerdict('participant-3', 'eliminate', new Date('2026-08-26T00:00:05.000Z'));
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:06.000Z'))).toMatchObject({
      value: { type: 'day-restarted', reason: 'no-majority' },
    });
  });

  it('reveals only Allegiance and completes when the last Mafia is eliminated', () => {
    const gameModule = new MafiaGameModule(() => 0, {
      dayDiscussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
    });
    const sessionResult = gameModule.create({
      sessionId: 'session-2',
      participantCount: 5,
      phaseDeadline: new Date('2026-08-26T00:00:00.000Z'),
    });
    if (sessionResult.isErr()) throw new Error('Expected a valid Mafia Game Session.');
    const session = sessionResult.value;
    session.advanceDayPhase(new Date('2026-08-26T00:00:01.000Z'));
    for (const participantId of ['participant-1', 'participant-2', 'participant-3']) {
      session.submitNomination(
        participantId,
        'participant-5',
        new Date('2026-08-26T00:00:01.000Z'),
      );
    }
    session.advanceDayPhase(new Date('2026-08-26T00:00:02.000Z'));
    session.advanceDayPhase(new Date('2026-08-26T00:00:03.000Z'));
    for (const participantId of ['participant-1', 'participant-2', 'participant-3']) {
      session.submitVerdict(participantId, 'eliminate', new Date('2026-08-26T00:00:03.000Z'));
    }
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:04.000Z'))).toMatchObject({
      value: { type: 'game-completed', winner: 'Citizen' },
    });
    const projectionResult = session.projectionFor('participant-1', 9);
    if (projectionResult.isErr()) throw new Error('Expected a projection.');
    const projection = projectionResult.value;
    expect(projection.public.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'record',
          outcome: expect.objectContaining({ type: 'allegiance-reveal', allegiance: 'Mafia' }),
        }),
        expect.objectContaining({
          type: 'record',
          outcome: expect.objectContaining({ type: 'victory', allegiance: 'Citizen' }),
        }),
        expect.objectContaining({
          type: 'record',
          outcome: expect.objectContaining({ type: 'phase-changed', phase: 'completed' }),
        }),
      ]),
    );
    expect(projection.public.completedVoteRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'nomination' }),
        expect.objectContaining({ phase: 'verdict' }),
      ]),
    );
    expect(projection.public.completedVoteRecords[0]?.votes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: 'participant-1',
          targetParticipantId: 'participant-5',
        }),
      ]),
    );
    expect(JSON.stringify(projection.public.timeline)).not.toContain('Detective');
  });
});
