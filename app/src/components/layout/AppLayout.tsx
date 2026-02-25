import { useEffect, useRef, useState, useCallback } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { gateway } from '../../api/gateway';
import { initAudio } from '../../utils/notificationSounds';
import { initSoundboardPlayback } from '../../utils/soundboardAudio';
import { requestNotificationPermission } from '../../utils/browserNotifications';
import { ServerSidebar } from './ServerSidebar';
import { ChannelSidebar } from './ChannelSidebar';
import { ChatArea } from '../chat/ChatArea';
import { MemberSidebar } from './MemberSidebar';
import { QuickSwitcher } from '../common/QuickSwitcher';
import { BugReportModal } from '../feedback/BugReportModal';
import { KeyboardShortcutsDialog } from '../common/KeyboardShortcutsDialog';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useFaviconBadge } from '../../hooks/useFaviconBadge';
import { useTrayBadge } from '../../hooks/useTrayBadge';
import { isTauri } from '../../api/instance';
import './AppLayout.css';

const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export function AppLayout() {
  const initGatewayHandlers = useServerStore((s) => s.initGatewayHandlers);
  const setServers = useServerStore((s) => s.setServers);
  const setReadStates = useServerStore((s) => s.setReadStates);
  const setNotificationPrefs = useServerStore((s) => s.setNotificationPrefs);
  const setBookmarkedIds = useServerStore((s) => s.setBookmarkedIds);
  const restoreNavigation = useServerStore((s) => s.restoreNavigation);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const showChannelSidebar = useServerStore((s) => s.showChannelSidebar);
  const showMemberSidebar = useServerStore((s) => s.showMemberSidebar);
  const toggleChannelSidebar = useServerStore((s) => s.toggleChannelSidebar);
  const toggleMemberSidebar = useServerStore((s) => s.toggleMemberSidebar);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [bugReport, setBugReport] = useState<{ open: boolean; prefill: string }>({ open: false, prefill: '' });
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isIdleRef = useRef(false);

  useDocumentTitle();
  useFaviconBadge();
  useTrayBadge();

  useEffect(() => {
    // Set up gateway READY handler
    gateway.onReady = (data) => {
      setServers(data.servers);
      if (data.read_states) {
        setReadStates(data.read_states);
      }
      if (data.notification_preferences) {
        setNotificationPrefs(data.notification_preferences);
      }
      if (data.bookmarked_message_ids) {
        setBookmarkedIds(data.bookmarked_message_ids);
      }
      restoreNavigation();
    };

    // Set up dispatch event handlers
    const cleanup = initGatewayHandlers();
    const cleanupSoundboard = initSoundboardPlayback(
      () => useServerStore.getState().voiceSelfDeaf,
    );

    return () => {
      gateway.onReady = null;
      cleanup();
      cleanupSoundboard();
    };
  }, [initGatewayHandlers, setServers, setReadStates, setNotificationPrefs, setBookmarkedIds, restoreNavigation]);

  // Unlock audio context on first user interaction (browser autoplay policy)
  useEffect(() => {
    const unlock = () => {
      initAudio();
      requestNotificationPermission();
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('click', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);

  // Handle push notification clicks (service worker → app navigation)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handler = (event: MessageEvent) => {
      if (event.data?.type !== 'NOTIFICATION_CLICK' || !event.data.url) return;

      const url: string = event.data.url;
      // Parse /channels/<server_id>/<channel_id> or /channels/@me/<channel_id>
      const match = url.match(/^\/channels\/([^/]+)\/([^/]+)$/);
      if (!match) return;

      const [, serverOrMe, channelId] = match;
      const store = useServerStore.getState();
      if (serverOrMe === '@me') {
        store.setActiveDmChannel(channelId);
      } else {
        store.setActiveServer(serverOrMe);
        store.setActiveChannel(channelId);
      }
    };

    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSwitcher((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '?') {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        toggleChannelSidebar();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !e.shiftKey) {
        e.preventDefault();
        toggleMemberSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleChannelSidebar, toggleMemberSidebar]);

  // Bug report modal via custom event
  const handleOpenBugReport = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail || '';
    setBugReport({ open: true, prefill: typeof detail === 'string' ? detail : '' });
  }, []);

  useEffect(() => {
    window.addEventListener('open-bug-report', handleOpenBugReport);
    return () => window.removeEventListener('open-bug-report', handleOpenBugReport);
  }, [handleOpenBugReport]);

  // Idle detection: go idle after 5 minutes of inactivity.
  // In Tauri, polls system-level idle time (D-Bus) so switching to other apps
  // doesn't falsely mark the user idle. In web, uses in-window events.
  useEffect(() => {
    const goIdle = () => {
      // Never go idle while in a voice channel
      if (useServerStore.getState().voiceChannelId) return;
      if (!isIdleRef.current) {
        isIdleRef.current = true;
        gateway.sendPresenceUpdate('idle');
      }
    };

    let lastOnlineSent = 0;
    const goOnline = () => {
      const now = Date.now();
      // Always re-send if we were idle; throttle to every 30s otherwise
      // to recover from any client/server state mismatch
      if (isIdleRef.current || now - lastOnlineSent > 30_000) {
        isIdleRef.current = false;
        lastOnlineSent = now;
        gateway.sendPresenceUpdate('online');
      }
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(goIdle, IDLE_TIMEOUT);
    };

    // Tauri: poll system idle time instead of relying on in-window events
    let systemIdleInterval: ReturnType<typeof setInterval> | undefined;
    if (isTauri()) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        systemIdleInterval = setInterval(async () => {
          try {
            const idleMs = await invoke<number>('get_system_idle_ms');
            if (idleMs >= IDLE_TIMEOUT) {
              goIdle();
            } else {
              goOnline();
            }
          } catch {
            // D-Bus not available — fall through to in-window events
          }
        }, 30_000); // Check every 30s
      });
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        idleTimerRef.current = setTimeout(goIdle, IDLE_TIMEOUT);
      } else {
        goOnline();
      }
    };

    // Start idle timer
    idleTimerRef.current = setTimeout(goIdle, IDLE_TIMEOUT);

    // Reset on user activity (mousemove, keydown, click, scroll, touch)
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('mousemove', goOnline);
    window.addEventListener('keydown', goOnline);
    window.addEventListener('mousedown', goOnline);
    window.addEventListener('scroll', goOnline, true);

    return () => {
      clearTimeout(idleTimerRef.current);
      if (systemIdleInterval) clearInterval(systemIdleInterval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('mousemove', goOnline);
      window.removeEventListener('keydown', goOnline);
      window.removeEventListener('mousedown', goOnline);
      window.removeEventListener('scroll', goOnline, true);
    };
  }, []);

  return (
    <div className="app-layout">
      <ServerSidebar />
      {showChannelSidebar && <ChannelSidebar />}
      <ChatArea />
      {activeServerId && showMemberSidebar && <MemberSidebar />}
      {showSwitcher && <QuickSwitcher onClose={() => setShowSwitcher(false)} />}
      {bugReport.open && (
        <BugReportModal
          prefill={bugReport.prefill}
          onClose={() => setBugReport({ open: false, prefill: '' })}
        />
      )}
      {showShortcuts && (
        <KeyboardShortcutsDialog onClose={() => setShowShortcuts(false)} />
      )}
    </div>
  );
}
