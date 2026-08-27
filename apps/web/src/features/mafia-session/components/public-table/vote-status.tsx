import { Badge } from '@repo/ui/components/badge';
import { CheckIcon, VoteIcon } from 'lucide-react';

import type { MafiaGameProjection } from '../../api/api';

type VoteStatusProps = {
  participants: MafiaGameProjection['public']['participants'];
  voteStatus: MafiaGameProjection['public']['voteStatus'];
  currentParticipantId: string;
};

export function VoteStatus({ participants, voteStatus, currentParticipantId }: VoteStatusProps) {
  if (!voteStatus) return null;
  const submittedParticipantIds = new Set(voteStatus.submittedParticipantIds);
  const voters = participants.filter((participant) => participant.alive);
  const submittedCount = voters.filter((participant) =>
    submittedParticipantIds.has(participant.id),
  ).length;

  return (
    <section className="border-y border-[#22221e]/25 py-3" aria-labelledby="vote-status-heading">
      <div className="flex items-center justify-between gap-3">
        <h3 id="vote-status-heading" className="flex items-center gap-2 text-sm font-medium">
          <VoteIcon aria-hidden="true" className="size-4" /> Voting progress
        </h3>
        <Badge variant="outline">
          {submittedCount} / {voters.length} submitted
        </Badge>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
        {voters.map((participant) => {
          const hasSubmitted = submittedParticipantIds.has(participant.id);
          const isYou = participant.id === currentParticipantId;
          return (
            <li
              key={participant.id}
              className="flex min-w-0 items-center gap-1.5 text-xs text-[#625e55]"
            >
              <CheckIcon
                aria-hidden="true"
                className={hasSubmitted ? 'size-3 text-[#a43b31]' : 'size-3 opacity-30'}
              />
              <span className="truncate">
                {participant.name}
                {isYou ? ' (you)' : ''}
              </span>
              <span className="sr-only">{hasSubmitted ? 'has voted' : 'has not voted'}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-[#625e55]">Choices stay private until the game ends.</p>
    </section>
  );
}
