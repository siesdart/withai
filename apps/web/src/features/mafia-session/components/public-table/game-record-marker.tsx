import { Marker, MarkerContent, MarkerIcon } from '@repo/ui/components/marker';
import { cn } from '@repo/ui/lib/utils';
import { ScrollTextIcon } from 'lucide-react';
import { map } from 'remeda';
import { match } from 'ts-pattern';

import type { MafiaGameProjection } from '../../api/client';

type GameRecordMarkerProps = {
  outcome: Extract<
    MafiaGameProjection['public']['timeline'][number],
    { type: 'record' }
  >['outcome'];
  completedVoteRecords: MafiaGameProjection['public']['completedVoteRecords'];
  participantNames: Map<string, string>;
  isNight?: boolean;
};

const outcomeCopy = (
  outcome: GameRecordMarkerProps['outcome'],
  participantNames: GameRecordMarkerProps['participantNames'],
) =>
  match(outcome)
    .with(
      { type: 'nomination-resolved', result: 'nominated' },
      (value) =>
        `Day ${value.dayNumber}: ${participantNames.get(value.nominatedParticipantId ?? '') ?? 'A participant'} was nominated with ${value.leadingVoteCount} vote${value.leadingVoteCount === 1 ? '' : 's'}.`,
    )
    .with(
      { type: 'nomination-resolved', result: 'nomination-tie' },
      (value) =>
        `Day ${value.dayNumber}: nomination ended in a tie at ${value.leadingVoteCount} vote${value.leadingVoteCount === 1 ? '' : 's'}.`,
    )
    .with(
      { type: 'nomination-resolved', result: 'no-nomination' },
      (value) => `Day ${value.dayNumber}: no nomination was submitted.`,
    )
    .with({ type: 'verdict-resolved' }, (value) => {
      const name = participantNames.get(value.participantId) ?? 'The nominated participant';
      const result = match(value)
        .with({ result: 'eliminate' }, () => 'was eliminated')
        .with({ result: 'verdict-tie' }, () => 'was spared after a tied verdict')
        .with(
          { result: 'no-majority' },
          () => 'was spared because elimination did not reach a majority',
        )
        .exhaustive();
      return `Day ${value.dayNumber}: ${name} ${result}.`;
    })
    .with({ type: 'day-changed' }, (value) => `Day ${value.dayNumber}: day has begun.`)
    .with(
      { type: 'discussion-time-adjusted' },
      (value) =>
        `Day ${value.dayNumber}: ${value.adjustmentSeconds > 0 ? 'added' : 'removed'} 10 seconds from the timer.`,
    )
    .with(
      { type: 'phase-changed', phase: 'discussion' },
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
    .with(
      { type: 'phase-changed', phase: 'night' },
      (value) => `Day ${value.dayNumber}: night has begun.`,
    )
    .with({ type: 'phase-changed', phase: 'completed' }, () => 'The game is complete.')
    .with(
      { type: 'allegiance-reveal' },
      (value) =>
        `${participantNames.get(value.participantId) ?? 'Participant'} was ${value.allegiance}.`,
    )
    .with({ type: 'victory' }, (value) => `${value.allegiance} team wins.`)
    .with(
      { type: 'night-resolved', result: 'protected' },
      (value) => `Day ${value.dayNumber}: Doctor saved the targeted Participant overnight.`,
    )
    .with(
      { type: 'night-resolved', result: 'no-death' },
      (value) => `Day ${value.dayNumber}: no Participant was eliminated overnight.`,
    )
    .with(
      { type: 'night-resolved', result: 'participant-eliminated' },
      (value) =>
        `Day ${value.dayNumber}: ${participantNames.get(value.participantId ?? '') ?? 'A participant'} was eliminated overnight.`,
    )
    .exhaustive();

const nominationVoteTotals = (
  outcome: Extract<GameRecordMarkerProps['outcome'], { type: 'nomination-resolved' }>,
  participantNames: GameRecordMarkerProps['participantNames'],
) =>
  map(
    outcome.voteCounts,
    ({ participantId, voteCount }) =>
      `${participantNames.get(participantId) ?? 'Participant'} ${voteCount}`,
  ).join(', ');

export function GameRecordMarker({
  outcome,
  completedVoteRecords,
  participantNames,
  isNight = false,
}: GameRecordMarkerProps) {
  return (
    <div
      className={cn(
        'my-4',
        isNight &&
          'text-[#c9cad5] **:data-[slot=marker]:text-[#c9cad5] [&_[data-slot=marker]::after]:bg-[#565968] [&_[data-slot=marker]::before]:bg-[#565968]',
      )}
    >
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
        <details className={cn('mt-2 text-xs', isNight ? 'text-[#c9cad5]' : 'text-[#625e55]')}>
          <summary className="cursor-pointer font-medium">View every vote</summary>
          <div className="mt-2 flex flex-col gap-3">
            {map(completedVoteRecords, (record) => (
              <section key={record.id} className="border border-[#22221e]/25 p-2">
                <p className="font-medium">
                  Day {record.dayNumber} /{' '}
                  {record.phase === 'nomination' ? 'Nomination' : 'Verdict'}
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {map(record.votes, (vote) => (
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
