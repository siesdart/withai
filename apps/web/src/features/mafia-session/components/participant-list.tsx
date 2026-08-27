import { Badge } from '@repo/ui/components/badge';
import { cn } from '@repo/ui/lib/utils';

import type { MafiaGameProjection } from '../api/api';

export function ParticipantList({
  participants,
  currentParticipantId,
  revealedAllegiances,
}: {
  participants: MafiaGameProjection['public']['participants'];
  currentParticipantId: string;
  revealedAllegiances: ReadonlyMap<string, 'Mafia' | 'Citizen'>;
}) {
  return (
    <ul className="mt-4 flex flex-col gap-1">
      {participants.map((participant) => (
        <li
          key={participant.id}
          className="flex min-w-0 items-center justify-between gap-3 bg-[#ded6c8] px-2 py-2.5"
        >
          <div className="min-w-0">
            <span className={cn('truncate', !participant.alive && 'text-[#625e55] line-through')}>
              {participant.name}
            </span>
            {participant.id === currentParticipantId ? (
              <span className="ml-1 text-xs text-[#625e55]">(you)</span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!participant.alive && revealedAllegiances.get(participant.id) ? (
              <Badge variant="secondary">{revealedAllegiances.get(participant.id)}</Badge>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
