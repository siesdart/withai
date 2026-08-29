import { Badge } from '@repo/ui/components/badge';
import { cn } from '@repo/ui/lib/utils';

import type { MafiaGameProjection } from '../../api/client';

export function ParticipantItem({
  currentParticipantId,
  participant,
  role,
}: {
  currentParticipantId: string;
  participant: MafiaGameProjection['public']['participants'][number];
  role: MafiaGameProjection['personal']['knownRoles'][number]['role'] | undefined;
}) {
  return (
    <>
      <div className="flex w-full min-w-0 items-center lg:w-auto">
        <span
          className={cn(
            'min-w-0 truncate text-sm',
            !participant.alive && 'text-[#625e55] line-through',
          )}
        >
          {participant.name}
        </span>
        {participant.id === currentParticipantId ? (
          <span className="ml-1 text-xs text-[#625e55]">(you)</span>
        ) : null}
      </div>
      {role ? (
        <Badge
          className={cn(
            role === 'Mafia'
              ? 'border-[#a43b31]/35 bg-[#f1d0c7] text-[#8d2f27]'
              : 'border-[#67806d]/35 bg-[#d5e0d1] text-[#3d5b42]',
          )}
        >
          {role}
        </Badge>
      ) : null}
    </>
  );
}
