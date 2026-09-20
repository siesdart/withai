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

import { useGameTranslation } from '../../i18n/use-game-translation';

type MafiaRole = MafiaGameProjection['personal']['role'];

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
  const { t } = useGameTranslation();
  const possibleRoles = getPossibleRolesFor(currentParticipantId, participant, role, isCompleted);

  return (
    <Select value={possibleRoles.length === 1 ? possibleRoles[0] : undefined}>
      <SelectTrigger
        aria-label={t('participants.roleMemo', { participantName: participant.name })}
        className="w-full max-w-20 gap-1 border-[#746956]/45 bg-[#f4efe7] px-1.5 text-[0.65rem]"
        size="sm"
      >
        <SelectValue placeholder={role ? t(`roles.${role}`) : t('participants.unknown')} />
      </SelectTrigger>
      <SelectContent>
        {possibleRoles.length > 1 ? (
          <SelectItem>{role ? t(`roles.${role}`) : t('participants.unknown')}</SelectItem>
        ) : null}
        {map(possibleRoles, (r) => (
          <SelectItem key={r} value={r}>
            {t(`roles.${r}`)}
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
): readonly MafiaRole[] {
  if (isCompleted) {
    return role ? [role] : [];
  }

  if (role === undefined) {
    return mafiaRoles;
  }

  if (role === 'Citizen' && participant.id !== currentParticipantId) {
    return ['Police', 'Doctor', 'Citizen'] satisfies MafiaRole[];
  }

  return [role];
}
