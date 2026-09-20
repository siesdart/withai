import type { MafiaGameProjection } from '@repo/mafia/client';
import { cn } from 'cn';

import { useGameTranslation } from '../../i18n/use-game-translation';

export function ParticipantItem({
  currentParticipantId,
  participant,
  role,
}: {
  currentParticipantId: string;
  participant: MafiaGameProjection['public']['participants'][number];
  role: MafiaGameProjection['personal']['knownRoles'][number]['role'] | undefined;
}) {
  const { t } = useGameTranslation();

  return (
    <div className="flex h-5 w-full min-w-0 items-center">
      <span
        className={cn(
          'min-w-0 truncate text-sm',
          !participant.alive && 'line-through',
          !participant.alive && role === 'Mafia' && 'text-[#a43b31]',
          !participant.alive && role !== 'Mafia' && 'text-[#67806d]',
        )}
      >
        {participant.name}
      </span>
      {participant.id === currentParticipantId ? (
        <span className="ml-1 text-xs text-[#625e55]">{t('participants.you')}</span>
      ) : null}
    </div>
  );
}
