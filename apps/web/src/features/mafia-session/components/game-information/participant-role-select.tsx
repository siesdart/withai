import { mafiaRoles, type MafiaGameProjection } from '@repo/mafia/client';
/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- Base UI select requires an event adapter for role-note validation. */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select';
import { map } from 'remeda';

export function ParticipantRoleSelect({
  currentParticipantId,
  participant,
  role,
  isCompleted,
}: {
  currentParticipantId: string;
  participant: MafiaGameProjection['public']['participants'][number];
  role: MafiaGameProjection['personal']['knownRoles'][number]['role'] | undefined;
  isCompleted: boolean;
}) {
  const possibleRoles = getPossibleRolesFor(currentParticipantId, participant, role, isCompleted);

  return (
    <Select value={possibleRoles.length === 1 ? possibleRoles[0] : undefined}>
      <SelectTrigger
        aria-label={`${participant.name} role memo`}
        className="w-full max-w-20 gap-1 border-[#746956]/45 bg-[#f4efe7] px-1.5 text-[0.65rem]"
        size="sm"
      >
        <SelectValue placeholder={role ?? 'Unknown'} />
      </SelectTrigger>
      <SelectContent>
        {possibleRoles.length > 1 ? <SelectItem>{role ?? 'Unknown'}</SelectItem> : null}
        {map(possibleRoles, (r) => (
          <SelectItem key={r} value={r}>
            {r}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function getPossibleRolesFor(
  currentParticipantId: string,
  participant: MafiaGameProjection['public']['participants'][number],
  role: MafiaGameProjection['personal']['knownRoles'][number]['role'] | undefined,
  isCompleted: boolean,
) {
  if (isCompleted) {
    return [role];
  }

  if (role === undefined) {
    return mafiaRoles;
  }

  if (role === 'Citizen' && participant.id !== currentParticipantId) {
    return ['Police', 'Doctor', 'Citizen'];
  }

  return [role];
}
