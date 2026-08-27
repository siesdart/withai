import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const BOTTOM_THRESHOLD_PX = 48;

export function usePublicChatAutoScroll(latestMessageId: string | undefined) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldFollowLatestRef = useRef(true);
  const previousLatestMessageIdRef = useRef<string | undefined>(undefined);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return undefined;
    }

    const updateFollowLatest = () => {
      const distanceFromBottom =
        scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      shouldFollowLatestRef.current = distanceFromBottom <= BOTTOM_THRESHOLD_PX;

      if (shouldFollowLatestRef.current) {
        setUnreadMessageCount(0);
      }
    };

    scrollContainer.addEventListener('scroll', updateFollowLatest, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', updateFollowLatest);
    };
  }, []);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const previousLatestMessageId = previousLatestMessageIdRef.current;
    previousLatestMessageIdRef.current = latestMessageId;

    if (!latestMessageId || !scrollContainer) {
      return;
    }

    if (shouldFollowLatestRef.current) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      setUnreadMessageCount(0);
      return;
    }

    if (previousLatestMessageId) {
      setUnreadMessageCount((count) => count + 1);
    }
  }, [latestMessageId]);

  const scrollToLatest = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    shouldFollowLatestRef.current = true;
    setUnreadMessageCount(0);
    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
  }, []);

  return { scrollContainerRef, scrollToLatest, unreadMessageCount };
}
