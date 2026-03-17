import { useEffect } from 'react';

/**
 * Calls the given callback when the Escape key is pressed.
 */
export function useEscapeKey(callback: () => void) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') callback();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [callback]);
}
