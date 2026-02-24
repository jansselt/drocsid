import { useEffect, useRef } from 'react';
import { useServerStore } from '../stores/serverStore';

const FAVICON_SIZE = 32;
const BADGE_RADIUS = 7;

export function useFaviconBadge() {
  const readStates = useServerStore((s) => s.readStates);
  const originalFaviconRef = useRef<string | null>(null);
  const linkRef = useRef<HTMLLinkElement | null>(null);

  useEffect(() => {
    // Capture the original favicon on mount
    const existing = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
    if (existing) {
      originalFaviconRef.current = existing.href;
      linkRef.current = existing;
    }
  }, []);

  useEffect(() => {
    let totalMentions = 0;
    for (const rs of readStates.values()) {
      totalMentions += rs.mention_count;
    }

    const link = linkRef.current;
    if (!link) return;
    const originalHref = originalFaviconRef.current;

    if (totalMentions === 0) {
      // Restore original favicon
      if (originalHref) {
        link.href = originalHref;
      }
      return;
    }

    // Draw badge on favicon
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = FAVICON_SIZE;
      canvas.height = FAVICON_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(img, 0, 0, FAVICON_SIZE, FAVICON_SIZE);

      // Red circle badge in bottom-right
      const cx = FAVICON_SIZE - BADGE_RADIUS;
      const cy = FAVICON_SIZE - BADGE_RADIUS;
      ctx.beginPath();
      ctx.arc(cx, cy, BADGE_RADIUS, 0, 2 * Math.PI);
      ctx.fillStyle = '#ed4245';
      ctx.fill();

      link.href = canvas.toDataURL('image/png');
    };
    img.src = originalHref || '/favicon.ico';
  }, [readStates]);
}
