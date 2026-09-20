import type { MafiaGameProjection } from '@repo/mafia/client';
/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- each selectable participant needs a bound game action. */
import { Button } from '@repo/ui/components/button';
import { cn } from 'cn';
import { map } from 'remeda';

import { useGameTranslation } from '../../i18n/use-game-translation';
import type { ParticipantSelection } from '../control-room/phase-interaction';
import { ParticipantItem } from './participant-item';
import { ParticipantRoleSelect } from './participant-role-select';

export function ParticipantList({
  participants,
  currentParticipantId,
  knownRoles,
  selection,
  isCompleted,
}: {
  participants: MafiaGameProjection['public']['participants'];
  currentParticipantId: string;
  knownRoles: MafiaGameProjection['personal']['knownRoles'];
  selection: ParticipantSelection | undefined;
  isCompleted: boolean;
}) {
  const { t } = useGameTranslation();
  const knownRolesMap = new Map(
    map(knownRoles, ({ participantId, role }) => [participantId, role] as const),
  );

  return (
    <ul className="grid grid-cols-4 justify-center gap-1 lg:grid-cols-1 lg:justify-normal">
      {map(participants, (participant) => {
        const role = knownRolesMap.get(participant.id);
        const canSelect = selection !== undefined && participant.alive;
        const isSelected = selection?.selectedParticipantId === participant.id;

        return (
          <li
            className="flex aspect-square h-full min-h-0 w-full min-w-0 shrink-0 flex-col justify-start gap-1 border border-transparent bg-[#ded6c8] bg-clip-padding px-2 py-2.5 text-left text-xs font-medium whitespace-nowrap text-[#22221e] lg:aspect-auto lg:min-h-12 lg:flex-row lg:items-center lg:justify-between lg:gap-3"
            key={participant.id}
          >
            {canSelect ? (
              <Button
                aria-label={t('participants.choose', {
                  actionLabel: t(`actionLabels.${selection.actionLabel}`),
                  participantName: participant.name,
                })}
                aria-pressed={isSelected}
                className={cn(
                  'h-5 w-full flex-1 border-0 px-0 text-[#22221e] hover:bg-[#d1c8b8] active:translate-y-px lg:-mx-2 lg:px-2',
                  isSelected &&
                    'border-[#746956] bg-[#c9bba7] text-[#22221e] shadow-[inset_0_0_0_1px_rgb(34_34_30/0.12)] hover:bg-[#bfb09b]',
                )}
                disabled={selection.disabled}
                onClick={() => selection.onSelect(participant.id)}
                type="button"
                variant="ghost"
              >
                <ParticipantItem
                  currentParticipantId={currentParticipantId}
                  participant={participant}
                  role={role}
                />
              </Button>
            ) : (
              <ParticipantItem
                currentParticipantId={currentParticipantId}
                participant={participant}
                role={role}
              />
            )}
            <ParticipantRoleSelect
              currentParticipantId={currentParticipantId}
              participant={participant}
              role={role}
              isCompleted={isCompleted}
            />
          </li>
        );
      })}
    </ul>
  );
}
