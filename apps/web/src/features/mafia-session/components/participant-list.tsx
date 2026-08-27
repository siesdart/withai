import type { MafiaGameProjection } from '../api/api';

export function ParticipantList({
  participants,
}: {
  participants: MafiaGameProjection['public']['participants'];
}) {
  return (
    <ul className="mt-4 flex flex-col gap-1">
      {participants.map((participant) => (
        <li
          key={participant.id}
          className="flex min-w-0 items-center justify-between gap-3 bg-[#ded6c8] px-2 py-2.5"
        >
          <span className="truncate">{participant.name}</span>
          <span className="shrink-0 text-xs text-[#625e55]">
            {participant.alive ? 'alive' : 'out'}
          </span>
        </li>
      ))}
    </ul>
  );
}
