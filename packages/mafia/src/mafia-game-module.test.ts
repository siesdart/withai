import { filter, map, pipe } from 'remeda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MafiaGameModule, MafiaGameSession } from './entry';

const timeAt = (milliseconds: number) => new Date(`2026-08-26T00:00:00.${milliseconds}Z`);

describe('MafiaGameModule', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-08-25T23:59:59.999Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns typed errors for invalid inputs and unknown participants', () => {
    const gameModule = new MafiaGameModule(() => 0, {
      discussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
      nightDurationMs: 1,
    });
    const invalidSession = gameModule.create({
      sessionId: 'session-1',
      participantCount: 4,
    });

    expect(invalidSession).toMatchObject({
      error: { type: 'invalid-participant-count', participantCount: 4 },
    });

    const validSession = gameModule.create({
      sessionId: 'session-1',
      participantCount: 5,
    });
    expect(validSession.isOk()).toBe(true);
    if (validSession.isErr()) {
      throw new Error('Expected a valid Mafia Game Session.');
    }

    const initialProjection = validSession.value.projectionFor('participant-1', 1);
    if (initialProjection.isErr()) throw new Error('Expected an initial projection.');
    expect(initialProjection.value.public).toMatchObject({ dayNumber: 1, phase: 'night' });
    expect(initialProjection.value.personal.knownRoles).toEqual([
      { participantId: 'participant-1', role: 'Police' },
    ]);
    const mafiaProjection = validSession.value.projectionFor('participant-5', 1);
    if (mafiaProjection.isErr()) throw new Error('Expected a Mafia projection.');
    expect(mafiaProjection.value.personal.knownRoles).toEqual([
      { participantId: 'participant-1', role: 'Citizen' },
      { participantId: 'participant-2', role: 'Citizen' },
      { participantId: 'participant-3', role: 'Citizen' },
      { participantId: 'participant-4', role: 'Citizen' },
      { participantId: 'participant-5', role: 'Mafia' },
    ]);
    expect(validSession.value.projectionFor('unknown-participant', 1)).toMatchObject({
      error: { type: 'unknown-participant', participantId: 'unknown-participant' },
    });
  });

  it('reveals every role to every participant when the game completes', () => {
    const gameModule = new MafiaGameModule(() => 0, {
      discussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
      nightDurationMs: 1,
    });
    const sessionResult = gameModule.create({
      sessionId: 'session-completed-allegiances',
      participantCount: 5,
    });
    if (sessionResult.isErr()) throw new Error('Expected a valid Mafia Game Session.');

    const session = sessionResult.value;
    session.advanceDayPhase(new Date('2026-08-26T00:00:00.000Z'));
    session.advanceDayPhase(new Date('2026-08-26T00:00:00.001Z'));
    for (const participantId of ['participant-1', 'participant-2', 'participant-3']) {
      session.submitNomination(
        participantId,
        'participant-5',
        new Date('2026-08-26T00:00:00.001Z'),
      );
    }
    session.advanceDayPhase(new Date('2026-08-26T00:00:00.002Z'));
    session.advanceDayPhase(new Date('2026-08-26T00:00:00.003Z'));
    for (const participantId of ['participant-1', 'participant-2', 'participant-3']) {
      session.submitVerdict(participantId, 'eliminate', new Date('2026-08-26T00:00:00.003Z'));
    }
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:00.004Z'))).toEqual({
      value: { type: 'game-completed', winner: 'Citizen' },
    });

    const projection = session.projectionFor('participant-1', 2);
    if (projection.isErr()) throw new Error('Expected a projection.');
    expect(projection.value.personal.knownRoles).toEqual([
      { participantId: 'participant-1', role: 'Police' },
      { participantId: 'participant-2', role: 'Doctor' },
      { participantId: 'participant-3', role: 'Citizen' },
      { participantId: 'participant-4', role: 'Citizen' },
      { participantId: 'participant-5', role: 'Mafia' },
    ]);
  });

  it('keeps Mafia Chat private while allowing Mafia to retain it after Night', () => {
    const gameModule = new MafiaGameModule(() => 0, {
      discussionDurationMs: 10,
      nominationDurationMs: 10,
      finalDefenceDurationMs: 10,
      verdictDurationMs: 10,
      nightDurationMs: 1,
    });
    const sessionResult = gameModule.create({
      sessionId: 'session-mafia-chat',
      participantCount: 5,
    });
    if (sessionResult.isErr()) throw new Error('Expected a valid Mafia Game Session.');

    const session = sessionResult.value;
    expect(
      session.submitMafiaChat(
        'participant-5',
        'Focus on Mina.',
        new Date('2026-08-25T23:59:59.999Z'),
      ),
    ).toMatchObject({ value: undefined });
    const mafiaProjection = session.projectionFor('participant-5', 1);
    const citizenProjection = session.projectionFor('participant-1', 1);
    if (mafiaProjection.isErr() || citizenProjection.isErr())
      throw new Error('Expected projections.');
    expect(mafiaProjection.value.timeline).toContainEqual(
      expect.objectContaining({
        type: 'mafia-chat',
        message: expect.objectContaining({
          participantId: 'participant-5',
          content: 'Focus on Mina.',
        }),
      }),
    );
    expect(map(mafiaProjection.value.timeline, (item) => item.id)).toEqual([
      'record-1',
      'mafia-chat-1',
    ]);
    expect(mafiaProjection.value.timeline[1]).toEqual({
      id: 'mafia-chat-1',
      type: 'mafia-chat',
      message: { dayNumber: 1, participantId: 'participant-5', content: 'Focus on Mina.' },
    });
    expect(citizenProjection.value.timeline).not.toContainEqual(
      expect.objectContaining({ type: 'mafia-chat' }),
    );

    session.advanceDayPhase(timeAt(1));
    session.submitPublicSpeech('participant-1', 'I have a public read.', timeAt(1));
    const daytimeMafiaProjection = session.projectionFor('participant-5', 2);
    const daytimeCitizenProjection = session.projectionFor('participant-1', 2);
    if (daytimeMafiaProjection.isErr() || daytimeCitizenProjection.isErr())
      throw new Error('Expected projections.');
    expect(daytimeMafiaProjection.value.timeline).toContainEqual(
      expect.objectContaining({ type: 'mafia-chat' }),
    );
    expect(map(daytimeCitizenProjection.value.timeline, (item) => item.id)).toEqual([
      'record-1',
      'record-2',
      'record-3',
      'record-4',
      'public-chat-1',
    ]);
  });

  it('shows an autonomous discussion limit record only to its intended Human Player', () => {
    const session = new MafiaGameSession(
      'session-private-discussion-limit',
      [
        { id: 'participant-1', name: 'You', alive: true, role: 'Mafia' },
        { id: 'participant-2', name: 'Agent Mafia', alive: true, role: 'Mafia' },
        { id: 'participant-3', name: 'Sora', alive: true, role: 'Citizen' },
      ],
      {
        discussionDurationMs: 1,
        nominationDurationMs: 1,
        finalDefenceDurationMs: 1,
        verdictDurationMs: 1,
        nightDurationMs: 1,
      },
    );
    session.advanceDayPhase(timeAt(0));
    expect(session.recordAutonomousPublicSpeechLimitReached('participant-1')).toEqual({
      value: undefined,
    });

    const humanProjection = session.projectionFor('participant-1', 1);
    const agentProjection = session.projectionFor('participant-2', 1);
    if (humanProjection.isErr() || agentProjection.isErr())
      throw new Error('Expected projections.');

    expect(humanProjection.value.timeline).toContainEqual({
      id: 'personal-record-1',
      type: 'personal-record',
      recipientParticipantId: 'participant-1',
      outcome: { type: 'autonomous-public-speech-limit-reached', dayNumber: 1 },
    });
    expect(agentProjection.value.timeline).not.toContainEqual(
      expect.objectContaining({ type: 'personal-record' }),
    );
  });

  it('gives each Agent only its authorized personal snapshot during private voting', () => {
    const session = new MafiaGameSession(
      'session-private-agent-context',
      [
        { id: 'participant-1', name: 'Police', alive: true, role: 'Police' },
        { id: 'participant-2', name: 'Citizen', alive: true, role: 'Citizen' },
        { id: 'participant-3', name: 'Mafia', alive: true, role: 'Mafia' },
        { id: 'participant-4', name: 'Doctor', alive: true, role: 'Doctor' },
        { id: 'participant-5', name: 'Other Citizen', alive: true, role: 'Citizen' },
      ],
      {
        discussionDurationMs: 1,
        nominationDurationMs: 1,
        finalDefenceDurationMs: 1,
        verdictDurationMs: 1,
        nightDurationMs: 1,
      },
      () => new Date('2026-08-26T00:00:00.000Z'),
    );

    session.submitMafiaChat('participant-3', 'Private target discussion.', timeAt(0));
    session.advanceDayPhase(timeAt(1));
    session.advanceDayPhase(timeAt(2));
    session.submitNomination('participant-1', 'participant-3', timeAt(2));
    session.submitNomination('participant-2', 'participant-4', timeAt(2));
    session.submitNomination('participant-3', 'participant-2', timeAt(2));

    const citizenContext = session.agentSpeechContextFor('participant-2');
    const mafiaContext = session.agentSpeechContextFor('participant-3');
    if (citizenContext.isErr() || mafiaContext.isErr()) throw new Error('Expected Agent contexts.');

    expect(citizenContext.value.personal).toEqual({
      participantId: 'participant-2',
      role: 'Citizen',
      allegiance: 'Citizen',
      vote: { phase: 'nomination', targetParticipantId: 'participant-4' },
      nightAction: undefined,
      knownRoles: [{ participantId: 'participant-2', role: 'Citizen' }],
    });
    expect(citizenContext.value.public.completedRecords).toEqual({
      voteRecords: [],
      nightActionRecords: [],
    });
    expect(citizenContext.value.timeline).not.toContainEqual(
      expect.objectContaining({ type: 'mafia-chat' }),
    );
    expect(mafiaContext.value.timeline).toContainEqual(
      expect.objectContaining({ type: 'mafia-chat' }),
    );
  });

  it('shares the last valid Mafia target and permits friendly fire', () => {
    const session = new MafiaGameSession(
      'session-shared-mafia-target',
      [
        { id: 'participant-1', name: 'Mafia One', alive: true, role: 'Mafia' },
        { id: 'participant-2', name: 'Mafia Two', alive: true, role: 'Mafia' },
        { id: 'participant-3', name: 'Sora', alive: true, role: 'Citizen' },
        { id: 'participant-4', name: 'Hana', alive: true, role: 'Citizen' },
        { id: 'participant-5', name: 'Iris', alive: true, role: 'Citizen' },
      ],
      {
        discussionDurationMs: 1,
        nominationDurationMs: 1,
        finalDefenceDurationMs: 1,
        verdictDurationMs: 1,
        nightDurationMs: 1,
      },
    );
    const now = new Date('2026-08-25T23:59:59.999Z');

    expect(session.submitMafiaTarget('participant-1', 'participant-3', now)).toEqual({
      value: undefined,
    });
    expect(session.submitMafiaTarget('participant-2', 'participant-2', now)).toEqual({
      value: undefined,
    });

    for (const participantId of ['participant-1', 'participant-2']) {
      const projection = session.projectionFor(participantId, 1);
      if (projection.isErr()) throw new Error('Expected a Mafia projection.');
      expect(projection.value.personal.nightAction).toEqual({
        type: 'mafia-target',
        targetParticipantId: 'participant-2',
      });
    }

    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:00.000Z'))).toEqual({
      value: { type: 'night-resolved', result: 'participant-eliminated' },
    });
  });

  it('allows a Police to investigate only one participant per Night', () => {
    vi.setSystemTime(timeAt(0));
    const gameModule = new MafiaGameModule(() => 0, {
      discussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
      nightDurationMs: 1,
    });
    const sessionResult = gameModule.create({
      sessionId: 'session-single-police-investigation',
      participantCount: 5,
    });
    if (sessionResult.isErr()) throw new Error('Expected a valid Mafia Game Session.');

    const session = sessionResult.value;
    const now = new Date('2026-08-26T00:00:00.000Z');
    expect(session.submitPoliceInvestigation('participant-1', 'participant-5', now)).toEqual({
      value: undefined,
    });
    expect(session.submitPoliceInvestigation('participant-1', 'participant-2', now)).toEqual({
      error: { type: 'night-action-already-submitted', participantId: 'participant-1' },
    });

    const projection = session.projectionFor('participant-1', 2);
    if (projection.isErr()) throw new Error('Expected a projection.');
    expect(projection.value.personal.nightAction).toEqual({
      type: 'police-investigation',
      targetParticipantId: 'participant-5',
    });
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:00.001Z'))).toEqual({
      value: { type: 'night-resolved', result: 'no-death' },
    });
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:00.002Z'))).toEqual({
      value: { type: 'phase-advanced', phase: 'nomination' },
    });
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:00.003Z'))).toEqual({
      value: { type: 'day-restarted', reason: 'no-nomination' },
    });
    expect(
      session.submitPoliceInvestigation(
        'participant-1',
        'participant-2',
        new Date('2026-08-26T00:00:00.003Z'),
      ),
    ).toEqual({ value: undefined });

    const secondNightProjection = session.projectionFor('participant-1', 3);
    if (secondNightProjection.isErr()) throw new Error('Expected a projection.');
    expect(secondNightProjection.value.personal.knownRoles).toEqual([
      { participantId: 'participant-5', role: 'Mafia' },
      { participantId: 'participant-2', role: 'Citizen' },
      { participantId: 'participant-1', role: 'Police' },
    ]);
  });

  it('records a Discussion Time Adjustment before immediately resolving an expired phase', () => {
    vi.setSystemTime(new Date('2026-08-25T23:59:00.000Z'));
    const gameModule = new MafiaGameModule(() => 0, {
      discussionDurationMs: 60_000,
      nominationDurationMs: 60_000,
      finalDefenceDurationMs: 60_000,
      verdictDurationMs: 60_000,
      nightDurationMs: 60_000,
    });
    const sessionResult = gameModule.create({
      sessionId: 'session-time-adjustment',
      participantCount: 5,
    });
    if (sessionResult.isErr()) throw new Error('Expected a valid Mafia Game Session.');

    const session = sessionResult.value;
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:00.000Z'))).toEqual({
      value: { type: 'night-resolved', result: 'no-death' },
    });
    const now = new Date('2026-08-26T00:00:55.000Z');
    expect(session.adjustDiscussionTime('participant-1', -10, now)).toEqual({
      value: undefined,
    });
    expect(session.advanceDayPhase(now)).toEqual({
      value: { type: 'phase-advanced', phase: 'nomination' },
    });

    const projectionResult = session.projectionFor('participant-1', 2);
    if (projectionResult.isErr()) throw new Error('Expected a projection.');
    const outcomes = pipe(
      projectionResult.value.timeline,
      filter((item) => item.type === 'record'),
      map((item) => item.outcome.type),
    );
    expect(outcomes.slice(-2)).toEqual(['discussion-time-adjusted', 'phase-changed']);
    expect(projectionResult.value.public.phase).toBe('nomination');
  });

  it('rejects a Discussion Time Adjustment outside the Discussion Phase', () => {
    const gameModule = new MafiaGameModule(() => 0, {
      discussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
      nightDurationMs: 1,
    });
    const sessionResult = gameModule.create({
      sessionId: 'session-eliminated-time-adjustment',
      participantCount: 5,
    });
    if (sessionResult.isErr()) throw new Error('Expected a valid Mafia Game Session.');

    const session = sessionResult.value;
    session.advanceDayPhase(timeAt(0));
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

    expect(session.adjustDiscussionTime('participant-1', 10, timeAt(7))).toMatchObject({
      error: { type: 'invalid-phase', phase: 'night' },
    });
  });

  it('assigns shuffled roles to participant seats using an injected random source', () => {
    const randomValues = [0, 0, 0, 0];
    const gameModule = new MafiaGameModule(() => randomValues.shift() ?? 0);
    const sessionResult = gameModule.create({
      sessionId: 'session-1',
      participantCount: 5,
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

    expect(projection.personal.role).toBe('Police');
    expect(projection.public.participants).toHaveLength(5);
    expect(projection.public.participants).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ role: expect.anything() })]),
    );
  });

  it('resolves a tied nomination without eliminating and requires a strict verdict majority', () => {
    const gameModule = new MafiaGameModule(() => 0, {
      discussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
      nightDurationMs: 1,
    });
    const sessionResult = gameModule.create({
      sessionId: 'session-1',
      participantCount: 5,
    });
    expect(sessionResult.isOk()).toBe(true);
    if (sessionResult.isErr()) {
      throw new Error('Expected a valid Mafia Game Session.');
    }

    const session = sessionResult.value;
    session.advanceDayPhase(new Date('2026-08-26T00:00:00.000Z'));
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
    expect(nominationProjection.value.public.completedRecords.voteRecords).toEqual([]);
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:02.000Z'))).toMatchObject({
      value: { type: 'day-restarted', reason: 'nomination-tie' },
    });
    const tiedNominationProjection = session.projectionFor('participant-1', 3);
    if (tiedNominationProjection.isErr()) throw new Error('Expected a projection.');
    expect(tiedNominationProjection.value.timeline).toEqual(
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
            phase: 'discussion',
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
      ]),
    );

    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:03.000Z'))).toMatchObject({
      value: { type: 'night-resolved', result: 'no-death' },
    });
    const dayTwoProjection = session.projectionFor('participant-1', 4);
    if (dayTwoProjection.isErr()) throw new Error('Expected a projection.');
    expect(dayTwoProjection.value.public.phase).toBe('discussion');
    expect(dayTwoProjection.value.public.dayNumber).toBe(2);
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:04.000Z'))).toMatchObject({
      value: { type: 'phase-advanced', phase: 'nomination' },
    });
    session.submitNomination(
      'participant-1',
      'participant-2',
      new Date('2026-08-26T00:00:04.000Z'),
    );
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:05.000Z'))).toMatchObject({
      value: { type: 'phase-advanced', phase: 'final-defence' },
    });
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:06.000Z'))).toMatchObject({
      value: { type: 'phase-advanced', phase: 'verdict' },
    });
    session.submitVerdict('participant-1', 'eliminate', new Date('2026-08-26T00:00:06.000Z'));
    session.submitVerdict('participant-3', 'eliminate', new Date('2026-08-26T00:00:06.000Z'));
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:07.000Z'))).toMatchObject({
      value: { type: 'day-restarted', reason: 'no-majority' },
    });
    const restartedProjection = session.projectionFor('participant-1', 8);
    if (restartedProjection.isErr()) throw new Error('Expected a projection.');
    expect(restartedProjection.value.public.phase).toBe('night');
  });

  it('reveals only Allegiance and completes when the last Mafia is eliminated', () => {
    const gameModule = new MafiaGameModule(() => 0, {
      discussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
      nightDurationMs: 1,
    });
    const sessionResult = gameModule.create({
      sessionId: 'session-2',
      participantCount: 5,
    });
    if (sessionResult.isErr()) throw new Error('Expected a valid Mafia Game Session.');
    const session = sessionResult.value;
    session.advanceDayPhase(new Date('2026-08-26T00:00:00.000Z'));
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
    expect(projection.timeline).toEqual(
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
    expect(projection.public.completedRecords.voteRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'nomination' }),
        expect.objectContaining({ phase: 'verdict' }),
      ]),
    );
    expect(projection.public.completedRecords.voteRecords[0]?.votes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: 'participant-1',
          targetParticipantId: 'participant-5',
        }),
      ]),
    );
    expect(JSON.stringify(projection.timeline)).not.toContain('Police');
  });

  it('resolves private Night actions with Doctor protection before beginning the next Day', () => {
    const gameModule = new MafiaGameModule(() => 0, {
      discussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
      nightDurationMs: 1,
    });
    const sessionResult = gameModule.create({
      sessionId: 'session-night-1',
      participantCount: 5,
    });
    if (sessionResult.isErr()) throw new Error('Expected a valid Mafia Game Session.');
    const session = sessionResult.value;

    session.advanceDayPhase(new Date('2026-08-26T00:00:00.000Z'));
    session.advanceDayPhase(new Date('2026-08-26T00:00:01.000Z'));
    for (const participantId of ['participant-1', 'participant-2', 'participant-4']) {
      session.submitNomination(
        participantId,
        'participant-3',
        new Date('2026-08-26T00:00:01.000Z'),
      );
    }
    session.advanceDayPhase(new Date('2026-08-26T00:00:02.000Z'));
    session.advanceDayPhase(new Date('2026-08-26T00:00:03.000Z'));
    for (const participantId of ['participant-1', 'participant-2', 'participant-4']) {
      session.submitVerdict(participantId, 'eliminate', new Date('2026-08-26T00:00:03.000Z'));
    }
    session.advanceDayPhase(new Date('2026-08-26T00:00:04.000Z'));
    const nightProjection = session.projectionFor('participant-1', 9);
    if (nightProjection.isErr()) throw new Error('Expected a projection.');
    expect(nightProjection.value.public.phase).toBe('night');

    expect(
      session.submitPoliceInvestigation(
        'participant-1',
        'participant-5',
        new Date('2026-08-26T00:00:04.000Z'),
      ),
    ).toMatchObject({
      value: undefined,
    });
    expect(
      session.submitDoctorProtection(
        'participant-2',
        'participant-4',
        new Date('2026-08-26T00:00:04.000Z'),
      ),
    ).toMatchObject({
      value: undefined,
    });
    expect(
      session.submitMafiaTarget(
        'participant-5',
        'participant-4',
        new Date('2026-08-26T00:00:04.000Z'),
      ),
    ).toMatchObject({
      value: undefined,
    });
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:05.000Z'))).toMatchObject({
      value: { type: 'night-resolved', result: 'protected' },
    });
    const projection = session.projectionFor('participant-1', 10);
    if (projection.isErr()) throw new Error('Expected a projection.');
    expect(projection.value.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'record',
          outcome: expect.objectContaining({ type: 'night-resolved', result: 'protected' }),
        }),
      ]),
    );

    expect(projection.value.public).toMatchObject({ dayNumber: 2, phase: 'discussion' });
    expect(projection.value.personal.nightAction).toEqual({
      type: 'police-investigation',
      targetParticipantId: 'participant-5',
    });
    expect(projection.value.public.participants).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'participant-4', alive: true })]),
    );
    expect(JSON.stringify(projection.value.timeline)).not.toContain('Police');
    expect(JSON.stringify(projection.value.timeline)).not.toContain('Doctor');
    expect(projection.value.public.completedRecords.nightActionRecords).toEqual([]);

    session.advanceDayPhase(new Date('2026-08-26T00:00:06.000Z'));
    for (const participantId of ['participant-1', 'participant-2', 'participant-4']) {
      session.submitNomination(
        participantId,
        'participant-5',
        new Date('2026-08-26T00:00:06.000Z'),
      );
    }
    session.advanceDayPhase(new Date('2026-08-26T00:00:07.000Z'));
    session.advanceDayPhase(new Date('2026-08-26T00:00:08.000Z'));
    for (const participantId of ['participant-1', 'participant-2', 'participant-4']) {
      session.submitVerdict(participantId, 'eliminate', new Date('2026-08-26T00:00:08.000Z'));
    }
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:09.000Z'))).toMatchObject({
      value: { type: 'game-completed', winner: 'Citizen' },
    });
    const completedProjection = session.projectionFor('participant-1', 11);
    if (completedProjection.isErr()) throw new Error('Expected a projection.');
    expect(completedProjection.value.public.completedRecords.nightActionRecords).toEqual([
      {
        id: 'night-action-record-1',
        dayNumber: 1,
        mafiaTargetParticipantId: undefined,
        doctorActions: [{ participantId: 'participant-2', targetParticipantId: undefined }],
        policeActions: [{ participantId: 'participant-1', targetParticipantId: undefined }],
      },
      {
        id: 'night-action-record-2',
        dayNumber: 2,
        mafiaTargetParticipantId: 'participant-4',
        doctorActions: [{ participantId: 'participant-2', targetParticipantId: 'participant-4' }],
        policeActions: [{ participantId: 'participant-1', targetParticipantId: 'participant-5' }],
      },
    ]);
  });

  it('eliminates an unprotected Mafia target when Police and Doctor actions are missing', () => {
    const gameModule = new MafiaGameModule(() => 0, {
      discussionDurationMs: 1,
      nominationDurationMs: 1,
      finalDefenceDurationMs: 1,
      verdictDurationMs: 1,
      nightDurationMs: 1,
    });
    const created = gameModule.create({
      sessionId: 'session-night-missing-actions',
      participantCount: 5,
    });
    if (created.isErr()) throw new Error('Expected a valid Mafia Game Session.');
    const session = created.value;
    session.advanceDayPhase(new Date('2026-08-26T00:00:00.000Z'));
    session.advanceDayPhase(new Date('2026-08-26T00:00:01.000Z'));
    for (const participantId of ['participant-1', 'participant-2', 'participant-4']) {
      session.submitNomination(
        participantId,
        'participant-3',
        new Date('2026-08-26T00:00:01.000Z'),
      );
    }
    session.advanceDayPhase(new Date('2026-08-26T00:00:02.000Z'));
    session.advanceDayPhase(new Date('2026-08-26T00:00:03.000Z'));
    for (const participantId of ['participant-1', 'participant-2', 'participant-4']) {
      session.submitVerdict(participantId, 'eliminate', new Date('2026-08-26T00:00:03.000Z'));
    }
    session.advanceDayPhase(new Date('2026-08-26T00:00:04.000Z'));
    session.submitMafiaTarget(
      'participant-5',
      'participant-4',
      new Date('2026-08-26T00:00:04.000Z'),
    );
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:05.000Z'))).toMatchObject({
      value: { type: 'night-resolved', result: 'participant-eliminated' },
    });
    const projection = session.projectionFor('participant-1', 10);
    if (projection.isErr()) throw new Error('Expected a projection.');
    expect(projection.value.public.participants).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'participant-4', alive: false })]),
    );
    expect(projection.value.personal.knownRoles).toEqual([
      { participantId: 'participant-3', role: 'Citizen' },
      { participantId: 'participant-4', role: 'Citizen' },
      { participantId: 'participant-1', role: 'Police' },
    ]);
    expect(projection.value.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'record',
          outcome: expect.objectContaining({
            type: 'allegiance-reveal',
            participantId: 'participant-4',
          }),
        }),
        expect.objectContaining({
          type: 'record',
          outcome: expect.objectContaining({
            type: 'night-resolved',
            result: 'participant-eliminated',
          }),
        }),
      ]),
    );
    const recordOutcomeTypes = pipe(
      projection.value.timeline,
      filter((item) => item.type === 'record'),
      map((item) => item.outcome.type),
    );
    const nightResolvedIndex = recordOutcomeTypes.lastIndexOf('night-resolved');
    expect(recordOutcomeTypes.slice(nightResolvedIndex - 1, nightResolvedIndex + 2)).toEqual([
      'phase-changed',
      'night-resolved',
      'allegiance-reveal',
    ]);
    expect(JSON.stringify(projection.value.timeline)).not.toContain('Doctor');
    expect(JSON.stringify(projection.value.timeline)).not.toContain('Police');

    session.advanceDayPhase(new Date('2026-08-26T00:00:06.000Z'));
    for (const participantId of ['participant-1', 'participant-2', 'participant-4']) {
      session.submitNomination(
        participantId,
        'participant-5',
        new Date('2026-08-26T00:00:06.000Z'),
      );
    }
    session.advanceDayPhase(new Date('2026-08-26T00:00:07.000Z'));
    session.advanceDayPhase(new Date('2026-08-26T00:00:08.000Z'));
    for (const participantId of ['participant-1', 'participant-2', 'participant-4']) {
      session.submitVerdict(participantId, 'eliminate', new Date('2026-08-26T00:00:08.000Z'));
    }
    expect(session.advanceDayPhase(new Date('2026-08-26T00:00:09.000Z'))).toMatchObject({
      value: { type: 'game-completed', winner: 'Citizen' },
    });
    const completedProjection = session.projectionFor('participant-1', 11);
    if (completedProjection.isErr()) throw new Error('Expected a projection.');
    expect(completedProjection.value.public.completedRecords.nightActionRecords).toEqual([
      {
        id: 'night-action-record-1',
        dayNumber: 1,
        mafiaTargetParticipantId: undefined,
        doctorActions: [{ participantId: 'participant-2', targetParticipantId: undefined }],
        policeActions: [{ participantId: 'participant-1', targetParticipantId: undefined }],
      },
      {
        id: 'night-action-record-2',
        dayNumber: 2,
        mafiaTargetParticipantId: 'participant-4',
        doctorActions: [{ participantId: 'participant-2', targetParticipantId: undefined }],
        policeActions: [{ participantId: 'participant-1', targetParticipantId: undefined }],
      },
    ]);
  });
});
