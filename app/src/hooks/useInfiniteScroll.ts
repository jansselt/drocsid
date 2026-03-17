import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Incrementally renders items in a list as the user scrolls near the bottom.
 * Returns [visibleCount, sentinelRef] — render sentinelRef as an empty element
 * after the last visible item so IntersectionObserver can detect proximity.
 */
export function useInfiniteScroll(
  totalCount: number,
  batchSize = 50,
): [number, React.RefCallback<HTMLElement>] {
  const [visibleCount, setVisibleCount] = useState(batchSize);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelNodeRef = useRef<HTMLElement | null>(null);

  // Reset when the total list changes significantly (e.g., switched server)
  const prevTotalRef = useRef(totalCount);
  useEffect(() => {
    if (totalCount !== prevTotalRef.current) {
      prevTotalRef.current = totalCount;
      setVisibleCount(batchSize);
    }
  }, [totalCount, batchSize]);

  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      // Disconnect previous observer
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }

      sentinelNodeRef.current = node;
      if (!node) return;

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            setVisibleCount((prev) => Math.min(prev + batchSize, totalCount));
          }
        },
        { rootMargin: '200px' },
      );
      observerRef.current.observe(node);
    },
    [batchSize, totalCount],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  return [Math.min(visibleCount, totalCount), sentinelRef];
}
