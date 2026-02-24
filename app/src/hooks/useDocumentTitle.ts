import { useEffect } from 'react';
import { useServerStore } from '../stores/serverStore';

export function useDocumentTitle() {
  const readStates = useServerStore((s) => s.readStates);

  useEffect(() => {
    let totalMentions = 0;
    for (const rs of readStates.values()) {
      totalMentions += rs.mention_count;
    }

    document.title = totalMentions > 0 ? `(${totalMentions}) drocsid` : 'drocsid';
  }, [readStates]);
}
