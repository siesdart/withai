export type NominationResolution =
  | { type: 'nominated'; participantId: string }
  | { type: 'no-nomination' }
  | { type: 'nomination-tie' };

export function resolveNomination(votes: ReadonlyMap<string, string>): NominationResolution {
  const counts = new Map<string, number>();
  for (const target of votes.values()) counts.set(target, (counts.get(target) ?? 0) + 1);
  const highest = Math.max(0, ...counts.values());
  const leaders = [...counts.entries()]
    .filter(([, count]) => count === highest)
    .map(([participantId]) => participantId);
  if (leaders.length === 0) return { type: 'no-nomination' };
  return leaders.length === 1
    ? { type: 'nominated', participantId: leaders[0] }
    : { type: 'nomination-tie' };
}

export type VerdictResolution = 'eliminate' | 'verdict-tie' | 'no-majority';

export function resolveVerdict(
  votes: ReadonlyMap<string, 'eliminate' | 'spare'>,
  livingParticipantCount: number,
): VerdictResolution {
  const eliminateVotes = [...votes.values()].filter((vote) => vote === 'eliminate').length;
  const spareVotes = [...votes.values()].filter((vote) => vote === 'spare').length;
  if (eliminateVotes > livingParticipantCount / 2) return 'eliminate';
  return eliminateVotes > 0 && eliminateVotes === spareVotes ? 'verdict-tie' : 'no-majority';
}
