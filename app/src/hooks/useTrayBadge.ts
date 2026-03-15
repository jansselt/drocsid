import { useEffect } from 'react';
import { useServerStore } from '../stores/serverStore';
import { isDesktop } from '../api/instance';

/**
 * Syncs the total unread count (mentions + unread DMs) to the Electron
 * system tray icon badge. No-op in web builds.
 */
export function useTrayBadge() {
  const readStates = useServerStore((s) => s.readStates);
  const dmChannels = useServerStore((s) => s.dmChannels);

  useEffect(() => {
    if (!isDesktop()) return;

    let totalMentions = 0;
    for (const rs of readStates.values()) {
      totalMentions += rs.mention_count;
    }

    let unreadDms = 0;
    for (const dm of dmChannels) {
      const rs = readStates.get(dm.id);
      if (dm.last_message_id && (!rs?.last_read_message_id || dm.last_message_id > rs.last_read_message_id)) {
        unreadDms++;
      }
    }

    const badgeCount = totalMentions + unreadDms;

    (window as any).electronAPI?.updateTrayBadge(badgeCount);
  }, [readStates, dmChannels]);
}
