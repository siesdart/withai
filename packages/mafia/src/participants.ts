import { map } from 'remeda';

import { mafiaGameConfig } from './config';

export type MafiaRole = 'Mafia' | 'Detective' | 'Doctor' | 'Citizen';
export type MafiaAllegiance = 'Mafia' | 'Citizen';
export type MafiaParticipant = { id: string; name: string; alive: boolean; role: MafiaRole };
export type MafiaPersonalInformation = {
  participantId: string;
  role: MafiaRole;
  allegiance: MafiaAllegiance;
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
const assignRoles = (participantCount: number): MafiaRole[] => {
  const mafiaCount = participantCount <= mafiaGameConfig.mafiaRoleThreshold ? 1 : 2;
  return [
    ...Array<MafiaRole>(mafiaCount).fill('Mafia'),
    'Detective',
    'Doctor',
    ...Array<MafiaRole>(participantCount - mafiaCount - 2).fill('Citizen'),
  ];
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
});
export { allegianceFor };
