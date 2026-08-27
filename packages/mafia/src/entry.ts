import { randomInt } from 'node:crypto';

import type { AuthorizedGameProjection, GameModule, GameModuleSession } from '@repo/game-contract';
import { err, ok, type Result } from 'neverthrow';
import { filter, find, map, pipe } from 'remeda';
import { match } from 'ts-pattern';

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
  chat: ReadonlyArray<MafiaPublicChatMessage>;
};

export type MafiaPublicChatMessage = {
  id: string;
  participantId: string;
  content: string;
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

export type MafiaSessionInputError = {
  type: 'invalid-participant-count';
  participantCount: number;
};

export type MafiaProjectionError = {
  type: 'unknown-participant';
  participantId: string;
};

export type MafiaPublicSpeechError =
  | { type: 'unknown-participant'; participantId: string }
  | { type: 'dead-participant'; participantId: string }
  | { type: 'expired-phase'; phaseDeadline: string }
  | { type: 'invalid-public-speech' };

export type MafiaAgentSpeechContext = {
  participant: Pick<MafiaParticipant, 'id' | 'name'>;
  persona: string;
  public: MafiaPublicInformation;
  personal: MafiaPersonalInformation;
};

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
  return map(participantNames.slice(0, participantCount), (name, index) => ({
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
    allegiance: match(participant.role)
      .with('Mafia', () => 'Mafia' as const)
      .with('Detective', 'Doctor', 'Citizen', () => 'Citizen' as const)
      .exhaustive(),
  };
}

export class MafiaGameModule implements GameModule<
  MafiaSessionInput,
  MafiaPublicInformation,
  MafiaPersonalInformation,
  MafiaSessionInputError,
  MafiaProjectionError
> {
  constructor(private readonly randomIntExclusive: RandomInt = randomInt) {}

  create({
    sessionId,
    participantCount,
    phaseDeadline,
  }: MafiaSessionInput): Result<MafiaGameSession, MafiaSessionInputError> {
    if (participantCount < 5 || participantCount > 10) {
      return err({ type: 'invalid-participant-count', participantCount });
    }

    return ok(
      new MafiaGameSession(
        sessionId,
        phaseDeadline,
        createParticipants(participantCount, this.randomIntExclusive),
      ),
    );
  }
}

export class MafiaGameSession implements GameModuleSession<
  MafiaPublicInformation,
  MafiaPersonalInformation,
  MafiaProjectionError
> {
  constructor(
    private readonly sessionId: string,
    private readonly phaseDeadline: Date,
    private readonly participants: ReadonlyArray<MafiaParticipant>,
  ) {}

  private readonly chat: MafiaPublicChatMessage[] = [];

  submitPublicSpeech(
    participantId: string,
    content: string,
    now = new Date(),
  ): Result<void, MafiaPublicSpeechError> {
    const participant = find(this.participants, ({ id }) => id === participantId);
    if (!participant) {
      return err({ type: 'unknown-participant', participantId });
    }
    if (!participant.alive) {
      return err({ type: 'dead-participant', participantId });
    }
    if (now >= this.phaseDeadline) {
      return err({ type: 'expired-phase', phaseDeadline: this.phaseDeadline.toISOString() });
    }
    if (!content.trim() || content.length > 500) {
      return err({ type: 'invalid-public-speech' });
    }

    this.chat.push({
      id: `chat-${this.chat.length + 1}`,
      participantId,
      content: content.trim(),
    });
    return ok(undefined);
  }

  agentSpeechContextFor(
    participantId: string,
  ): Result<MafiaAgentSpeechContext, MafiaProjectionError> {
    const participant = find(this.participants, ({ id }) => id === participantId);
    if (!participant) {
      return err({ type: 'unknown-participant', participantId });
    }

    return ok({
      participant: { id: participant.id, name: participant.name },
      persona: `${participant.name} is observant and concise.`,
      public: this.publicInformation(),
      personal: toPersonalInformation(participant),
    });
  }

  livingAgentParticipantIds(humanParticipantId: string) {
    return pipe(
      this.participants,
      filter(({ id, alive }) => id !== humanParticipantId && alive),
      map(({ id }) => id),
    );
  }

  projectionFor(
    participantId: string,
    eventId: number,
  ): Result<MafiaGameProjection, MafiaProjectionError> {
    const participant = find(this.participants, ({ id }) => id === participantId);
    if (!participant) {
      return err({ type: 'unknown-participant', participantId });
    }

    return ok({
      eventId,
      sessionId: this.sessionId,
      public: {
        ...this.publicInformation(),
      },
      personal: toPersonalInformation(participant),
    });
  }

  private publicInformation(): MafiaPublicInformation {
    return {
      phase: 'day-discussion',
      phaseDeadline: this.phaseDeadline.toISOString(),
      participants: map(this.participants, ({ id, name, alive }) => ({ id, name, alive })),
      chat: [...this.chat],
    };
  }
}

export type MafiaGameProjection = AuthorizedGameProjection<
  MafiaPublicInformation,
  MafiaPersonalInformation
>;
