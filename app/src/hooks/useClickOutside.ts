import { useEffect, type RefObject } from 'react';

/**
 * Calls the given callback when a mousedown event occurs outside the referenced element.
 * Uses a setTimeout(0) so the click that opened the component doesn't immediately close it.
 */
export function useClickOutside(ref: RefObject<HTMLElement | null>, callback: () => void) {
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        callback();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [ref, callback]);
}
