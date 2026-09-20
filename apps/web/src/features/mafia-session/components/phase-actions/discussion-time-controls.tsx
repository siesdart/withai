import { Button } from '@repo/ui/components/button';
import { MinusIcon, PlusIcon } from 'lucide-react';

import { useDiscussionTimeAdjustment } from '../../hooks/actions/use-discussion-time-adjustment';
import { useGameTranslation } from '../../i18n/use-game-translation';

type DiscussionTimeControlsProps = {
  phaseDeadline: string;
};

export function DiscussionTimeControls({ phaseDeadline }: DiscussionTimeControlsProps) {
  const { t } = useGameTranslation();
  const discussionTimeAdjustment = useDiscussionTimeAdjustment(phaseDeadline);
  const cooldown = discussionTimeAdjustment.retryAfterSeconds
    ? t('discussionTime.cooldown', {
        retryAfterSeconds: discussionTimeAdjustment.retryAfterSeconds,
      })
    : '';

  return (
    <div
      className="flex items-center justify-end gap-1 border-b border-[#22221e]/15 px-3 py-2 sm:px-5"
      aria-label={t('discussionTime.controls')}
    >
      <Button
        aria-label={t('discussionTime.remove', { seconds: 10, cooldown })}
        disabled={discussionTimeAdjustment.isSubmissionBlocked}
        onClick={discussionTimeAdjustment.adjustMinus10}
        size="sm"
        type="button"
        variant="outline"
      >
        <MinusIcon data-icon="inline-start" />
        {t('discussionTime.tenSeconds')}
      </Button>
      <Button
        aria-label={t('discussionTime.add', { seconds: 10, cooldown })}
        disabled={discussionTimeAdjustment.isSubmissionBlocked}
        onClick={discussionTimeAdjustment.adjustPlus10}
        size="sm"
        type="button"
        variant="outline"
      >
        <PlusIcon data-icon="inline-start" />
        {t('discussionTime.tenSeconds')}
      </Button>
    </div>
  );
}
