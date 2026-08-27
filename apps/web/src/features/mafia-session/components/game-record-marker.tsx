import { Marker, MarkerContent, MarkerIcon } from '@repo/ui/components/marker';
import { ScrollTextIcon } from 'lucide-react';
import { match } from 'ts-pattern';

import type { MafiaGameProjection } from '../api/api';

type GameRecordMarkerProps = {
  outcome: Extract<
    MafiaGameProjection['public']['timeline'][number],
    { type: 'record' }
  >['outcome'];
  completedVoteRecords: MafiaGameProjection['public']['completedVoteRecords'];
  participantNames: Map<string, string>;
};

const outcomeCopy = (
  outcome: GameRecordMarkerProps['outcome'],
  participantNames: GameRecordMarkerProps['participantNames'],
) =>
  match(outcome)
    .with({ type: 'nomination-resolved' }, (value) =>
      value.result === 'nominated'
        ? `Day ${value.dayNumber}: ${participantNames.get(value.nominatedParticipantId ?? '') ?? 'A participant'} was nominated with ${value.leadingVoteCount} vote${value.leadingVoteCount === 1 ? '' : 's'}.`
        : value.result === 'nomination-tie'
          ? `Day ${value.dayNumber}: nomination ended in a tie at ${value.leadingVoteCount} vote${value.leadingVoteCount === 1 ? '' : 's'}.`
          : `Day ${value.dayNumber}: no nomination was submitted.`,
    )
    .with({ type: 'verdict-resolved' }, (value) => {
      const name = participantNames.get(value.participantId) ?? 'The nominated participant';
      const result =
        value.result === 'eliminate'
          ? 'was eliminated'
          : value.result === 'verdict-tie'
            ? 'was spared after a tied verdict'
            : 'was spared because elimination did not reach a majority';
      return `Day ${value.dayNumber}: ${name} ${result}.`;
    })
    .with({ type: 'day-changed' }, (value) => `Day ${value.dayNumber} began.`)
    .with(
      { type: 'phase-changed', phase: 'day-discussion' },
      (value) => `Day ${value.dayNumber}: discussion phase started.`,
    )
    .with(
      { type: 'phase-changed', phase: 'nomination' },
      (value) => `Day ${value.dayNumber}: nomination phase started.`,
    )
    .with(
      { type: 'phase-changed', phase: 'final-defence' },
      (value) => `Day ${value.dayNumber}: final defence phase started.`,
    )
    .with(
      { type: 'phase-changed', phase: 'verdict' },
      (value) => `Day ${value.dayNumber}: verdict phase started.`,
    )
    .with({ type: 'phase-changed', phase: 'completed' }, () => 'The game is complete.')
    .with(
      { type: 'allegiance-reveal' },
      (value) =>
        `${participantNames.get(value.participantId) ?? 'Participant'} was ${value.allegiance}.`,
    )
    .with({ type: 'victory' }, (value) => `${value.allegiance} team wins.`)
    .exhaustive();

const nominationVoteTotals = (
  outcome: Extract<GameRecordMarkerProps['outcome'], { type: 'nomination-resolved' }>,
  participantNames: GameRecordMarkerProps['participantNames'],
) =>
  outcome.voteCounts
    .map(
      ({ participantId, voteCount }) =>
        `${participantNames.get(participantId) ?? 'Participant'} ${voteCount}`,
    )
    .join(', ');

export function GameRecordMarker({
  outcome,
  completedVoteRecords,
  participantNames,
}: GameRecordMarkerProps) {
  return (
    <div className="my-4">
      <Marker variant="separator">
        <MarkerIcon>
          <ScrollTextIcon />
        </MarkerIcon>
        <MarkerContent className="max-w-[calc(100%-3rem)]">
          {outcomeCopy(outcome, participantNames)}
          {outcome.type === 'nomination-resolved' && outcome.voteCounts.length > 0 ? (
            <span className="block">
              Vote totals: {nominationVoteTotals(outcome, participantNames)}
            </span>
          ) : null}
          {outcome.type === 'verdict-resolved' ? (
            <span className="block">
              Eliminate {outcome.eliminateVotes}, spare {outcome.spareVotes}.
            </span>
          ) : null}
        </MarkerContent>
      </Marker>
      {outcome.type === 'victory' && completedVoteRecords.length > 0 ? (
        <details className="mt-2 text-xs text-[#625e55]">
          <summary className="cursor-pointer font-medium">View every vote</summary>
          <div className="mt-2 flex flex-col gap-3">
            {completedVoteRecords.map((record) => (
              <section key={record.id} className="border border-[#22221e]/25 p-2">
                <p className="font-medium">
                  Day {record.dayNumber} /{' '}
                  {record.phase === 'nomination' ? 'Nomination' : 'Verdict'}
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {record.votes.map((vote) => (
                    <li key={vote.participantId}>
                      {participantNames.get(vote.participantId) ?? 'Participant'}:{' '}
                      {'targetParticipantId' in vote
                        ? `nominated ${participantNames.get(vote.targetParticipantId) ?? 'Participant'}`
                        : vote.vote}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
