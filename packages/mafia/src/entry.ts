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

export type MafiaGameProjection = AuthorizedGameProjection<
  MafiaPublicInformation,
  MafiaPersonalInformation
>;

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

function assignRoles(participantCount: number): MafiaRole[] {
  const mafiaCount = participantCount <= 6 ? 1 : 2;
  return [
    ...Array<MafiaRole>(mafiaCount).fill('Mafia'),
    'Detective',
    'Doctor',
    ...Array<MafiaRole>(participantCount - mafiaCount - 2).fill('Citizen'),
  ];
}

function createParticipants(participantCount: number): MafiaParticipant[] {
  return participantNames.slice(0, participantCount).map((name, index) => ({
    id: `participant-${index + 1}`,
    name,
    alive: true,
    role: assignRoles(participantCount)[index],
  }));
}

function toPersonalInformation(participant: MafiaParticipant): MafiaPersonalInformation {
  return {
    participantId: participant.id,
    role: participant.role,
    allegiance: participant.role === 'Mafia' ? 'Mafia' : 'Citizen',
  };
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

export class MafiaGameModule implements GameModule<
  MafiaSessionInput,
  MafiaPublicInformation,
  MafiaPersonalInformation
> {
  create({
    sessionId,
    participantCount,
    phaseDeadline,
  }: MafiaSessionInput): GameModuleSession<MafiaPublicInformation, MafiaPersonalInformation> {
    if (participantCount < 5 || participantCount > 10) {
      throw new Error('A Mafia Game Session requires five to ten Participants.');
    }

    return new MafiaGameSession(sessionId, phaseDeadline, createParticipants(participantCount));
  }
}
