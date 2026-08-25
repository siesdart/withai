import { randomInt } from 'node:crypto';

import type { AuthorizedGameProjection, GameModule, GameModuleSession } from '@repo/game-contract';

export type MafiaSessionInput = {
  sessionId: string;
  participantCount: number;
  phaseDeadline: Date;
};

export type MafiaRole = 'Mafia' | 'Detective' | 'Doctor' | 'Citizen';

export type MafiaParticipant = {
  id: string;
  name: string;
  alive: boolean;
  role: MafiaRole;
};

export type MafiaPublicInformation = {
  phase: 'day-discussion';
  phaseDeadline: string;
  participants: ReadonlyArray<Omit<MafiaParticipant, 'role'>>;
};

export type MafiaPersonalInformation = {
  participantId: string;
  role: MafiaRole;
  allegiance: 'Mafia' | 'Citizen';
};

const participantNames = [
  'You',
  'Mina',
  'Joon',
  'Sora',
  'Hana',
  'Theo',
  'Iris',
  'Noah',
  'Yuna',
  'Eli',
] as const;

export type RandomInt = (maxExclusive: number) => number;

function assignRoles(participantCount: number): MafiaRole[] {
  const mafiaCount = participantCount <= 6 ? 1 : 2;
  return [
    ...Array<MafiaRole>(mafiaCount).fill('Mafia'),
    'Detective',
    'Doctor',
    ...Array<MafiaRole>(participantCount - mafiaCount - 2).fill('Citizen'),
  ];
}

function shuffleRoles(roles: MafiaRole[], randomIntExclusive: RandomInt): MafiaRole[] {
  const shuffledRoles = [...roles];
  for (let index = shuffledRoles.length - 1; index > 0; index -= 1) {
    const selectedIndex = randomIntExclusive(index + 1);
    [shuffledRoles[index], shuffledRoles[selectedIndex]] = [
      shuffledRoles[selectedIndex],
      shuffledRoles[index],
    ];
  }
  return shuffledRoles;
}

function createParticipants(
  participantCount: number,
  randomIntExclusive: RandomInt,
): MafiaParticipant[] {
  const roles = shuffleRoles(assignRoles(participantCount), randomIntExclusive);
  return participantNames.slice(0, participantCount).map((name, index) => ({
    id: `participant-${index + 1}`,
    name,
    alive: true,
    role: roles[index],
  }));
}

function toPersonalInformation(participant: MafiaParticipant): MafiaPersonalInformation {
  return {
    participantId: participant.id,
    role: participant.role,
    allegiance: participant.role === 'Mafia' ? 'Mafia' : 'Citizen',
  };
}

export class MafiaGameModule implements GameModule<
  MafiaSessionInput,
  MafiaPublicInformation,
  MafiaPersonalInformation
> {
  constructor(private readonly randomIntExclusive: RandomInt = randomInt) {}

  create({
    sessionId,
    participantCount,
    phaseDeadline,
  }: MafiaSessionInput): GameModuleSession<MafiaPublicInformation, MafiaPersonalInformation> {
    if (participantCount < 5 || participantCount > 10) {
      throw new Error('A Mafia Game Session requires five to ten Participants.');
    }

    return new MafiaGameSession(
      sessionId,
      phaseDeadline,
      createParticipants(participantCount, this.randomIntExclusive),
    );
  }
}

class MafiaGameSession implements GameModuleSession<
  MafiaPublicInformation,
  MafiaPersonalInformation
> {
  constructor(
    private readonly sessionId: string,
    private readonly phaseDeadline: Date,
    private readonly participants: ReadonlyArray<MafiaParticipant>,
  ) {}

  projectionFor(participantId: string, eventId: number): MafiaGameProjection {
    const participant = this.participants.find(({ id }) => id === participantId);
    if (!participant) {
      throw new Error('Participant does not belong to this Game Session.');
    }

    return {
      eventId,
      sessionId: this.sessionId,
      public: {
        phase: 'day-discussion',
        phaseDeadline: this.phaseDeadline.toISOString(),
        participants: this.participants.map(({ id, name, alive }) => ({ id, name, alive })),
      },
      personal: toPersonalInformation(participant),
    };
  }
}

export type MafiaGameProjection = AuthorizedGameProjection<
  MafiaPublicInformation,
  MafiaPersonalInformation
>;
