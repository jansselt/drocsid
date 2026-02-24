import { useEffect, useState } from 'react';
import { unfurlUrl } from '../../api/client';
import type { LinkPreviewData } from '../../types';

// Module-level cache to avoid refetching on re-renders
const cache = new Map<string, LinkPreviewData | null>();

interface LinkPreviewProps {
  url: string;
}

export function LinkPreview({ url }: LinkPreviewProps) {
  const [data, setData] = useState<LinkPreviewData | null | undefined>(
    cache.has(url) ? cache.get(url) : undefined,
  );

  useEffect(() => {
    if (cache.has(url)) {
      setData(cache.get(url)!);
      return;
    }

    let cancelled = false;
    unfurlUrl(url)
      .then((result) => {
        // Only cache if we got something useful
        const useful = result.title ? result : null;
        cache.set(url, useful);
        if (!cancelled) setData(useful);
      })
      .catch(() => {
        cache.set(url, null);
        if (!cancelled) setData(null);
      });

    return () => { cancelled = true; };
  }, [url]);

  // Still loading or failed or no useful data
  if (!data) return null;

  return (
    <div className="md-link-preview">
      <div className="md-link-preview-body">
        {data.site_name && (
          <span className="md-link-preview-site">{data.site_name}</span>
        )}
        <a
          className="md-link-preview-title"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {data.title}
        </a>
        {data.description && (
          <span className="md-link-preview-desc">{data.description}</span>
        )}
      </div>
      {data.image && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img className="md-link-preview-image" src={data.image} alt="" />
        </a>
      )}
    </div>
  );
}
