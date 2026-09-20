import type { MafiaGameProjection } from '@repo/mafia/client';
import { Marker, MarkerContent, MarkerIcon } from '@repo/ui/components/marker';
import { cn } from 'cn';
import type { TFunction } from 'i18next';
import { ScrollTextIcon } from 'lucide-react';
import { filter, map, sort, unique } from 'remeda';
import { match } from 'ts-pattern';

import { useGameTranslation } from '../../i18n/use-game-translation';

type GameRecordMarkerProps = {
  outcome: Extract<
    MafiaGameProjection['timeline'][number],
    { type: 'record' | 'personal-record' }
  >['outcome'];
  completedRecords: MafiaGameProjection['public']['completedRecords'];
  participantNames: Map<string, string>;
  isNight?: boolean;
};

const outcomeCopy = (
  outcome: GameRecordMarkerProps['outcome'],
  participantNames: GameRecordMarkerProps['participantNames'],
  t: TFunction,
) =>
  match(outcome)
    .with({ type: 'nomination-resolved', result: 'nominated' }, (value) =>
      t('records.nominated', {
        dayNumber: value.dayNumber,
        participantName:
          participantNames.get(value.nominatedParticipantId ?? '') ?? t('records.fallback'),
        count: value.leadingVoteCount,
        pluralSuffix: value.leadingVoteCount === 1 ? '' : 's',
      }),
    )
    .with({ type: 'nomination-resolved', result: 'nomination-tie' }, (value) =>
      t('records.nominationTie', {
        dayNumber: value.dayNumber,
        count: value.leadingVoteCount,
        pluralSuffix: value.leadingVoteCount === 1 ? '' : 's',
      }),
    )
    .with({ type: 'nomination-resolved', result: 'no-nomination' }, (value) =>
      t('records.noNomination', { dayNumber: value.dayNumber }),
    )
    .with({ type: 'verdict-resolved' }, (value) => {
      const participantName = participantNames.get(value.participantId) ?? t('records.fallback');
      const key = match(value.result)
        .with('eliminate', () => 'records.verdictEliminated' as const)
        .with('verdict-tie', () => 'records.verdictTied' as const)
        .with('no-majority', () => 'records.verdictNoMajority' as const)
        .exhaustive();
      return t(key, { dayNumber: value.dayNumber, participantName });
    })
    .with({ type: 'day-changed' }, (value) =>
      t('records.dayStarted', { dayNumber: value.dayNumber }),
    )
    .with({ type: 'discussion-time-adjusted' }, (value) =>
      t(
        value.adjustmentSeconds > 0
          ? 'records.discussionTimeAdded'
          : 'records.discussionTimeRemoved',
        { dayNumber: value.dayNumber },
      ),
    )
    .with({ type: 'phase-changed', phase: 'discussion' }, (value) =>
      t('records.phaseStarted', { dayNumber: value.dayNumber, phase: t('phases.discussion') }),
    )
    .with({ type: 'phase-changed', phase: 'nomination' }, (value) =>
      t('records.phaseStarted', { dayNumber: value.dayNumber, phase: t('phases.nomination') }),
    )
    .with({ type: 'phase-changed', phase: 'final-defence' }, (value) =>
      t('records.phaseStarted', { dayNumber: value.dayNumber, phase: t('phases.final-defence') }),
    )
    .with({ type: 'phase-changed', phase: 'verdict' }, (value) =>
      t('records.phaseStarted', { dayNumber: value.dayNumber, phase: t('phases.verdict') }),
    )
    .with({ type: 'phase-changed', phase: 'night' }, (value) =>
      t('records.phaseStarted', { dayNumber: value.dayNumber, phase: t('phases.night') }),
    )
    .with({ type: 'phase-changed', phase: 'completed' }, () => t('records.gameCompleted'))
    .with({ type: 'allegiance-reveal' }, (value) =>
      t('records.allegianceReveal', {
        participantName: participantNames.get(value.participantId) ?? t('records.fallback'),
        allegiance: t(`allegiances.${value.allegiance}`),
      }),
    )
    .with({ type: 'victory' }, (value) =>
      t('records.victory', { allegiance: t(`allegiances.${value.allegiance}`) }),
    )
    .with({ type: 'night-resolved', result: 'protected' }, (value) =>
      t('records.nightProtected', { dayNumber: value.dayNumber }),
    )
    .with({ type: 'night-resolved', result: 'no-death' }, (value) =>
      t('records.nightNoDeath', { dayNumber: value.dayNumber }),
    )
    .with({ type: 'night-resolved', result: 'participant-eliminated' }, (value) =>
      t('records.nightParticipantEliminated', {
        dayNumber: value.dayNumber,
        participantName: participantNames.get(value.participantId ?? '') ?? t('records.fallback'),
      }),
    )
    .with({ type: 'autonomous-public-speech-limit-reached' }, (value) =>
      t('records.discussionLimitReached', { dayNumber: value.dayNumber }),
    )
    .with({ type: 'police-investigation-result' }, (value) =>
      t('records.policeInvestigation', {
        dayNumber: value.dayNumber,
        participantName: participantNames.get(value.participantId) ?? t('records.fallback'),
        allegiance: t(`allegiances.${value.allegiance}`),
      }),
    )
    .exhaustive();

const nominationVoteTotals = (
  outcome: Extract<GameRecordMarkerProps['outcome'], { type: 'nomination-resolved' }>,
  participantNames: GameRecordMarkerProps['participantNames'],
  t: TFunction,
) =>
  map(outcome.voteCounts, ({ participantId, voteCount }) =>
    t('records.voteTotal', {
      participantName: participantNames.get(participantId) ?? t('records.fallback'),
      voteCount,
    }),
  ).join(', ');

const actionTargetCopy = (
  targetParticipantId: string | undefined,
  participantNames: GameRecordMarkerProps['participantNames'],
  t: TFunction,
) =>
  targetParticipantId
    ? (participantNames.get(targetParticipantId) ?? t('records.fallback'))
    : t('records.noAction');

export const completedRecordDays = (
  completedRecords: MafiaGameProjection['public']['completedRecords'],
) =>
  sort(
    unique([
      ...map(completedRecords.voteRecords, (record) => record.dayNumber),
      ...map(completedRecords.nightActionRecords, (record) => record.dayNumber),
    ]),
    (left, right) => left - right,
  );

export function GameRecordMarker({
  outcome,
  completedRecords,
  participantNames,
  isNight = false,
}: GameRecordMarkerProps) {
  const { t } = useGameTranslation();

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
          {outcomeCopy(outcome, participantNames, t)}
          {outcome.type === 'nomination-resolved' && outcome.voteCounts.length > 0 ? (
            <span className="block">
              {t('records.voteTotals', {
                totals: nominationVoteTotals(outcome, participantNames, t),
              })}
            </span>
          ) : null}
          {outcome.type === 'verdict-resolved' ? (
            <span className="block">
              {t('records.verdictTotals', {
                eliminateVotes: outcome.eliminateVotes,
                spareVotes: outcome.spareVotes,
              })}
            </span>
          ) : null}
        </MarkerContent>
      </Marker>
      {outcome.type === 'victory' &&
      (completedRecords.voteRecords.length > 0 ||
        completedRecords.nightActionRecords.length > 0) ? (
        <details className={cn('mt-2 text-xs', isNight ? 'text-[#c9cad5]' : 'text-[#625e55]')}>
          <summary className="cursor-pointer font-medium">{t('records.fullRecord')}</summary>
          <div className="mt-2 flex flex-col gap-3">
            {map(completedRecordDays(completedRecords), (dayNumber) => (
              <section key={dayNumber} className="border border-[#22221e]/25 p-2">
                <p className="font-medium">{t('records.day', { dayNumber })}</p>
                <div className="mt-1 flex flex-col gap-2">
                  {map(
                    filter(
                      completedRecords.nightActionRecords,
                      (record) => record.dayNumber === dayNumber,
                    ),
                    (record) => (
                      <div key={record.id}>
                        <p>{t('records.nightActions')}</p>
                        <ul className="mt-1 flex flex-col gap-1">
                          <li>
                            {t('records.mafiaTarget', {
                              targetName: record.mafiaTargetParticipantId
                                ? (participantNames.get(record.mafiaTargetParticipantId) ??
                                  t('records.fallback'))
                                : t('records.noTarget'),
                            })}
                          </li>
                          {map(record.doctorActions, (action) => (
                            <li key={`doctor-${action.participantId}`}>
                              {t('records.actionRecord', {
                                role: t('roles.Doctor'),
                                participantName:
                                  participantNames.get(action.participantId) ??
                                  t('records.fallback'),
                                targetName: actionTargetCopy(
                                  action.targetParticipantId,
                                  participantNames,
                                  t,
                                ),
                              })}
                            </li>
                          ))}
                          {map(record.policeActions, (action) => (
                            <li key={`police-${action.participantId}`}>
                              {t('records.actionRecord', {
                                role: t('roles.Police'),
                                participantName:
                                  participantNames.get(action.participantId) ??
                                  t('records.fallback'),
                                targetName: actionTargetCopy(
                                  action.targetParticipantId,
                                  participantNames,
                                  t,
                                ),
                              })}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ),
                  )}
                  {map(
                    filter(
                      completedRecords.voteRecords,
                      (record) => record.dayNumber === dayNumber,
                    ),
                    (record) => (
                      <div key={record.id}>
                        <p>
                          {t(
                            record.phase === 'nomination'
                              ? 'records.nomination'
                              : 'records.verdict',
                          )}
                        </p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {map(record.votes, (vote) => (
                            <li key={vote.participantId}>
                              {'targetParticipantId' in vote
                                ? t('records.nominatedVote', {
                                    participantName:
                                      participantNames.get(vote.participantId) ??
                                      t('records.fallback'),
                                    targetName:
                                      participantNames.get(vote.targetParticipantId) ??
                                      t('records.fallback'),
                                  })
                                : t('records.vote', {
                                    participantName:
                                      participantNames.get(vote.participantId) ??
                                      t('records.fallback'),
                                    choice: t(
                                      vote.vote === 'eliminate'
                                        ? 'records.eliminateVote'
                                        : 'records.spareVote',
                                    ),
                                  })}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
