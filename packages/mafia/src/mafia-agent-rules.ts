import { mafiaGameConfig } from './config';
import { mafiaRoleCountsFor, mafiaRoles } from './participants';

const secondsFor = (durationMs: number) => `${durationMs / 1000} seconds`;

export const mafiaAgentRulesBriefing = (participantCount: number) => {
  const roleCounts = mafiaRoleCountsFor(participantCount);
  const roleComposition = mafiaRoles
    .filter((role) => roleCounts[role] > 0)
    .map((role) => `${roleCounts[role]} ${role}`)
    .join(', ');

  return `# Mafia game rules
Social-deduction Mafia. ${participantCount} Participants. Allegiance: Mafia, Citizen. Roles: ${mafiaRoles.join(', ')}. Current setup: ${roleComposition}.

Role is a Participant's exact job: Mafia, Police, Doctor, or Citizen. Allegiance is that job's broad side to win: Mafia has Mafia Allegiance; Police, Doctor, and Citizen Roles all have Citizen Allegiance. Therefore exact Role determines Allegiance, but Allegiance never determines exact Role. The label \`Citizen\` is overloaded: as an Allegiance it means any non-Mafia Role; as a Role it means the ordinary Citizen job. Infer which meaning applies from the field or record, never from the word alone.

When start, Citizen Allegiance cannot know each other, but Mafia Allegiance know each other.

Mafia Allegiance win: living Mafia >= living Citizen. Citizens Allegiance win: no Mafia alive.

Living Participants act before each phase deadline. Night: act ${secondsFor(mafiaGameConfig.nightDurationMs)} -> Day: discuss ${secondsFor(mafiaGameConfig.discussionDurationMs)} -> nominate ${secondsFor(mafiaGameConfig.nominationDurationMs)} -> Nominee Final Defence ${secondsFor(mafiaGameConfig.finalDefenceDurationMs)} -> verdict ${secondsFor(mafiaGameConfig.verdictDurationMs)} -> again Night.

Night: Mafia may pick one living Participant to eliminate. Doctor may protect one living Participant against Mafia, self included. Police may investigate one living Participant; learns Allegiance, not exact Role. An Allegiance reveal can rule out incompatible jobs, but leaves every job in that Allegiance possible. Role claims must be assessed against this compatibility and other evidence, not rejected merely because the record names an Allegiance.

Discussion: public chat to share information, no private chat.

Nomination: pick one nominee to eliminate. Unique highest target nominated; no majority needed. Tie/no votes: nobody eliminated, Night starts.

Final Defence: say nominee only. Claim not to be eliminated.

Verdict: decide whether to eliminate the nominee. eliminate only if eliminate votes reach strict majority of all living Participants. Tie/no majority: nobody eliminated, Night starts.

While game runs, individual vote records and Night-action records private and unavailable. Outcome records show only defined aggregate counts/results.
`;
};
