import { useMessageScroller } from '@repo/ui/components/message-scroller';
import { useCallback, useEffectEvent, useLayoutEffect, useRef, type UIEvent } from 'react';

type ScrollMetrics = Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>;

const scrollEndTolerance = 1;

export const hasReachedScrollEnd = ({ clientHeight, scrollHeight, scrollTop }: ScrollMetrics) =>
  scrollTop >= scrollHeight - clientHeight - scrollEndTolerance;

export function useResumeAutoScrollAtEnd(timelineItemCount: number) {
  const { scrollToEnd } = useMessageScroller();
  const isAtScrollEndRef = useRef(true);
  const previousTimelineItemCountRef = useRef(timelineItemCount);
  const scrollToEndOnTimelineChange = useEffectEvent(scrollToEnd);

  useLayoutEffect(() => {
    const hasNewTimelineItem = timelineItemCount > previousTimelineItemCountRef.current;
    previousTimelineItemCountRef.current = timelineItemCount;

    if (hasNewTimelineItem && isAtScrollEndRef.current) {
      scrollToEndOnTimelineChange();
    }
  }, [timelineItemCount]);

  return useCallback((event: UIEvent<HTMLDivElement>) => {
    isAtScrollEndRef.current = hasReachedScrollEnd(event.currentTarget);
  }, []);
}
