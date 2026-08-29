import { Button } from '@repo/ui/components/button';
import { MinusIcon, PlusIcon } from 'lucide-react';

import { useDiscussionTimeAdjustment } from '../../hooks/actions/use-discussion-time-adjustment';

type DiscussionTimeControlsProps = {
  sessionId: string;
  phaseDeadline: string;
};

export function DiscussionTimeControls({ sessionId, phaseDeadline }: DiscussionTimeControlsProps) {
  const discussionTimeAdjustment = useDiscussionTimeAdjustment(sessionId, phaseDeadline);
  const cooldownLabel = discussionTimeAdjustment.retryAfterSeconds
    ? ` Available again in ${discussionTimeAdjustment.retryAfterSeconds} seconds.`
    : '';

  return (
    <div
      className="flex items-center justify-end gap-1 border-b border-[#22221e]/15 px-3 py-2 sm:px-5"
      aria-label="Discussion time controls"
    >
      <Button
        aria-label={`Remove 10 seconds from the discussion timer.${cooldownLabel}`}
        disabled={discussionTimeAdjustment.isSubmissionBlocked}
        onClick={discussionTimeAdjustment.adjustMinus10}
        size="sm"
        type="button"
        variant="outline"
      >
        <MinusIcon data-icon="inline-start" />
        10s
      </Button>
      <Button
        aria-label={`Add 10 seconds to the discussion timer.${cooldownLabel}`}
        disabled={discussionTimeAdjustment.isSubmissionBlocked}
        onClick={discussionTimeAdjustment.adjustPlus10}
        size="sm"
        type="button"
        variant="outline"
      >
        <PlusIcon data-icon="inline-start" />
        10s
      </Button>
    </div>
  );
}
