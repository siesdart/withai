import { cn } from 'cn';
import { match } from 'ts-pattern';

import { useGameTranslation } from '../../i18n/use-game-translation';
import type { PhasePanel } from '../control-room/phase-interaction';
import { DiscussionTimeControls } from './discussion-time-controls';
import { FinalDefenceForm } from './final-defence-form';
import { MafiaChatForm } from './mafia-chat-form';
import { PublicSpeechForm } from './public-speech-form';
import { VerdictControls } from './verdict-controls';

export function PhaseActionPanel({ panel, isNight }: { panel: PhasePanel; isNight: boolean }) {
  const { t } = useGameTranslation();
  const secondaryTextClassName = isNight ? 'text-[#c9cad5]' : 'text-[#625e55]';

  return match(panel)
    .with({ type: 'completed' }, () => (
      <div className={cn('shrink-0 p-3 text-sm sm:p-5', secondaryTextClassName)}>
        {t('phasePanel.completedObserver')}
      </div>
    ))
    .with({ type: 'observer' }, () => (
      <div
        className={cn(
          'shrink-0 border-t p-3 text-sm sm:p-5',
          isNight ? 'border-[#565968]' : 'border-[#22221e]/25',
          secondaryTextClassName,
        )}
      >
        {t('phasePanel.eliminatedObserver')}
      </div>
    ))
    .with({ type: 'discussion' }, (p) => (
      <div className="flex shrink-0 flex-col">
        <DiscussionTimeControls phaseDeadline={p.phaseDeadline} />
        <PublicSpeechForm disabled={p.disabled} gameAction={p.gameAction} />
      </div>
    ))
    .with({ type: 'nomination' }, () => (
      <div className="shrink-0 p-3 sm:p-5">
        <h3 className="text-base font-medium">{t('phasePanel.chooseNominee')}</h3>
        <p className={cn('mt-1 text-sm', secondaryTextClassName)}>
          {t('phasePanel.selectAliveParticipant')}
        </p>
      </div>
    ))
    .with({ type: 'final-defence' }, (p) => (
      <div className="shrink-0">
        <div className={cn('p-3 sm:p-5', p.isCurrentParticipantNominated && 'pb-0 sm:pb-0')}>
          <h3 className="text-base font-medium">{t('phasePanel.finalDefence')}</h3>
          <p className={cn('mt-1 text-sm', secondaryTextClassName)}>
            {p.nominatedParticipantName
              ? t('phasePanel.nomineeHasFloor', { participantName: p.nominatedParticipantName })
              : t('phasePanel.nomineePreparingDefence')}
          </p>
        </div>
        {p.isCurrentParticipantNominated ? (
          <FinalDefenceForm disabled={p.disabled} gameAction={p.gameAction} />
        ) : null}
      </div>
    ))
    .with({ type: 'verdict' }, (p) => (
      <VerdictControls
        disabled={p.disabled}
        nominatedParticipantName={p.nominatedParticipantName}
        personalVote={p.personalVote}
        gameAction={p.gameAction}
      />
    ))
    .with({ type: 'night' }, (p) => (
      <div
        className={cn(
          'shrink-0 p-3 sm:p-5',
          p.role === 'Mafia' && 'border-[#565968] bg-[#292b35] text-[#f7f2e8]',
        )}
      >
        <h3 className="text-base font-medium">
          {match(p.role)
            .with('Mafia', () => t('phasePanel.nightPrompt.Mafia'))
            .with('Doctor', () => t('phasePanel.nightPrompt.Doctor'))
            .with('Police', () => t('phasePanel.nightPrompt.Police'))
            .with('Citizen', () => t('phasePanel.nightPrompt.Citizen'))
            .exhaustive()}
        </h3>
        <p
          className={cn(
            'mt-1 text-sm',
            p.role === 'Mafia' || isNight ? 'text-[#d8d7df]' : 'text-[#625e55]',
          )}
        >
          {p.role === 'Citizen'
            ? t('phasePanel.waitForDawn')
            : t('phasePanel.selectAliveParticipant')}
        </p>
        {p.role === 'Mafia' ? (
          <MafiaChatForm disabled={p.disabled} gameAction={p.gameAction} />
        ) : null}
      </div>
    ))
    .exhaustive();
}
