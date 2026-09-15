import { map } from 'remeda';

import { mafiaGameConfig } from './config';

export const mafiaRoles = ['Mafia', 'Police', 'Doctor', 'Citizen'] as const;
export type MafiaRole = (typeof mafiaRoles)[number];
export type MafiaAllegiance = 'Mafia' | 'Citizen';
export type MafiaParticipant = { id: string; name: string; alive: boolean; role: MafiaRole };
export type MafiaPersonalInformation = {
  participantId: string;
  role: MafiaRole;
  allegiance: MafiaAllegiance;
  vote:
    | { phase: 'nomination'; targetParticipantId: string }
    | { phase: 'verdict'; vote: 'eliminate' | 'spare' }
    | undefined;
  nightAction:
    | { type: 'mafia-target'; targetParticipantId: string }
    | { type: 'doctor-protection'; targetParticipantId: string }
    | {
        type: 'police-investigation';
        targetParticipantId: string;
      }
    | undefined;
  knownRoles: ReadonlyArray<{ participantId: string; role: MafiaRole }>;
};
export type RandomInt = (maxExclusive: number) => number;

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

const allegianceFor = (role: MafiaRole): MafiaAllegiance =>
  role === 'Mafia' ? 'Mafia' : 'Citizen';
export const mafiaRoleCountsFor = (participantCount: number): Record<MafiaRole, number> => {
  const mafiaCount = participantCount <= mafiaGameConfig.mafiaRoleThreshold ? 1 : 2;
  return {
    Mafia: mafiaCount,
    Police: 1,
    Doctor: 1,
    Citizen: participantCount - mafiaCount - 2,
  };
};
const assignRoles = (participantCount: number): MafiaRole[] => {
  const counts = mafiaRoleCountsFor(participantCount);
  return mafiaRoles.flatMap((role) => Array<MafiaRole>(counts[role]).fill(role));
};
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
export function createParticipants(
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
export const toPersonalInformation = (participant: MafiaParticipant): MafiaPersonalInformation => ({
  participantId: participant.id,
  role: participant.role,
  allegiance: allegianceFor(participant.role),
  vote: undefined,
  nightAction: undefined,
  knownRoles: [],
});
export { allegianceFor };
