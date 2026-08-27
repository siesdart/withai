import { countBy, filter, map, pipe, sort } from 'remeda';

export type NominationVoteCount = { participantId: string; voteCount: number };
export type NominationResolution =
  | {
      type: 'nominated';
      participantId: string;
      leadingVoteCount: number;
      voteCounts: ReadonlyArray<NominationVoteCount>;
    }
  | { type: 'no-nomination'; leadingVoteCount: 0; voteCounts: ReadonlyArray<NominationVoteCount> }
  | {
      type: 'nomination-tie';
      leadingVoteCount: number;
      voteCounts: ReadonlyArray<NominationVoteCount>;
    };

export function resolveNomination(votes: ReadonlyMap<string, string>): NominationResolution {
  const voteCounts = pipe(
    Object.entries(countBy([...votes.values()], (target) => target)),
    map(([participantId, voteCount]) => ({ participantId, voteCount })),
    sort(
      (left, right) =>
        right.voteCount - left.voteCount || left.participantId.localeCompare(right.participantId),
    ),
  );
  const highest = voteCounts[0]?.voteCount ?? 0;
  const leaders = pipe(
    voteCounts,
    filter(({ voteCount }) => voteCount === highest),
    map(({ participantId }) => participantId),
  );
  if (leaders.length === 0) return { type: 'no-nomination', leadingVoteCount: 0, voteCounts };
  return leaders.length === 1
    ? { type: 'nominated', participantId: leaders[0], leadingVoteCount: highest, voteCounts }
    : { type: 'nomination-tie', leadingVoteCount: highest, voteCounts };
}

export type VerdictResolution = {
  type: 'eliminate' | 'verdict-tie' | 'no-majority';
  eliminateVotes: number;
  spareVotes: number;
  requiredEliminateVotes: number;
};

export function resolveVerdict(
  votes: ReadonlyMap<string, 'eliminate' | 'spare'>,
  livingParticipantCount: number,
): VerdictResolution {
  const voteCounts = countBy([...votes.values()], (vote) => vote);
  const eliminateVotes = voteCounts.eliminate ?? 0;
  const spareVotes = voteCounts.spare ?? 0;
  const requiredEliminateVotes = Math.floor(livingParticipantCount / 2) + 1;
  const type =
    eliminateVotes >= requiredEliminateVotes
      ? 'eliminate'
      : eliminateVotes > 0 && eliminateVotes === spareVotes
        ? 'verdict-tie'
        : 'no-majority';
  return { type, eliminateVotes, spareVotes, requiredEliminateVotes };
}
