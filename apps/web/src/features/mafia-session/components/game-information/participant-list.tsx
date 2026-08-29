/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- each selectable participant needs a bound game action. */
import { Button } from '@repo/ui/components/button';
import { cn } from '@repo/ui/lib/utils';
import { map } from 'remeda';

import type { MafiaGameProjection } from '../../api/client';
import { ParticipantItem } from './participant-item';

export type ParticipantSelection = {
  actionLabel: string;
  disabled: boolean;
  onSelect: (participantId: string) => void;
  selectedParticipantId: string | undefined;
};

const participantItemLayoutClassName =
  'h-full min-h-0 w-full flex-col items-start justify-start gap-1 border border-transparent bg-clip-padding bg-[#ded6c8] px-2 py-2.5 text-left text-xs font-medium whitespace-nowrap lg:min-h-12 lg:flex-row lg:items-center lg:justify-between lg:gap-3';

export function ParticipantList({
  participants,
  currentParticipantId,
  knownRoles,
  selection,
}: {
  participants: MafiaGameProjection['public']['participants'];
  currentParticipantId: string;
  knownRoles: MafiaGameProjection['personal']['knownRoles'];
  selection: ParticipantSelection | undefined;
}) {
  const knownRolesMap = new Map(
    map(knownRoles, ({ participantId, role }) => [participantId, role] as const),
  );

  return (
    <ul className="mt-4 grid grid-cols-[repeat(auto-fit,5rem)] justify-center gap-1 lg:grid-cols-1 lg:justify-normal">
      {map(participants, (participant) => {
        const role = knownRolesMap.get(participant.id);
        const canSelect = selection !== undefined && participant.alive;
        const isSelected = selection?.selectedParticipantId === participant.id;

        return (
          <li className="aspect-square min-w-0 lg:aspect-auto" key={participant.id}>
            {canSelect ? (
              <Button
                aria-label={`${selection.actionLabel}: ${participant.name}`}
                aria-pressed={isSelected}
                className={cn(
                  participantItemLayoutClassName,
                  'text-[#22221e] hover:bg-[#d1c8b8] active:translate-y-px',
                  isSelected &&
                    'border-[#746956] bg-[#c9bba7] text-[#22221e] shadow-[inset_0_0_0_1px_rgb(34_34_30/0.12)] hover:bg-[#bfb09b]',
                )}
                disabled={selection.disabled}
                onClick={() => selection.onSelect(participant.id)}
                type="button"
                variant="outline"
              >
                <ParticipantItem
                  currentParticipantId={currentParticipantId}
                  participant={participant}
                  role={role}
                />
              </Button>
            ) : (
              <div className={cn('flex shrink-0 text-[#22221e]', participantItemLayoutClassName)}>
                <ParticipantItem
                  currentParticipantId={currentParticipantId}
                  participant={participant}
                  role={role}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
