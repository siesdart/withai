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
  const counts = new Map<string, number>();
  for (const target of votes.values()) counts.set(target, (counts.get(target) ?? 0) + 1);
  const voteCounts = [...counts.entries()]
    .map(([participantId, voteCount]) => ({ participantId, voteCount }))
    .toSorted(
      (left, right) =>
        right.voteCount - left.voteCount || left.participantId.localeCompare(right.participantId),
    );
  const highest = Math.max(0, ...counts.values());
  const leaders = [...counts.entries()]
    .filter(([, count]) => count === highest)
    .map(([participantId]) => participantId);
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
  const eliminateVotes = [...votes.values()].filter((vote) => vote === 'eliminate').length;
  const spareVotes = [...votes.values()].filter((vote) => vote === 'spare').length;
  const requiredEliminateVotes = Math.floor(livingParticipantCount / 2) + 1;
  const type =
    eliminateVotes >= requiredEliminateVotes
      ? 'eliminate'
      : eliminateVotes > 0 && eliminateVotes === spareVotes
        ? 'verdict-tie'
        : 'no-majority';
  return { type, eliminateVotes, spareVotes, requiredEliminateVotes };
}
