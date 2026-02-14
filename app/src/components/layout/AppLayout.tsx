import { useEffect, useRef, useState } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { gateway } from '../../api/gateway';
import { ServerSidebar } from './ServerSidebar';
import { ChannelSidebar } from './ChannelSidebar';
import { ChatArea } from '../chat/ChatArea';
import { MemberSidebar } from './MemberSidebar';
import { QuickSwitcher } from '../common/QuickSwitcher';
import './AppLayout.css';

const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export function AppLayout() {
  const initGatewayHandlers = useServerStore((s) => s.initGatewayHandlers);
  const setServers = useServerStore((s) => s.setServers);
  const restoreNavigation = useServerStore((s) => s.restoreNavigation);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const showChannelSidebar = useServerStore((s) => s.showChannelSidebar);
  const showMemberSidebar = useServerStore((s) => s.showMemberSidebar);
  const toggleChannelSidebar = useServerStore((s) => s.toggleChannelSidebar);
  const toggleMemberSidebar = useServerStore((s) => s.toggleMemberSidebar);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isIdleRef = useRef(false);

  useEffect(() => {
    // Set up gateway READY handler
    gateway.onReady = (data) => {
      setServers(data.servers);
      restoreNavigation();
    };

    // Set up dispatch event handlers
    const cleanup = initGatewayHandlers();

    return () => {
      gateway.onReady = null;
      cleanup();
    };
  }, [initGatewayHandlers, setServers, restoreNavigation]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSwitcher((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
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

  // Idle detection: go idle after 5 minutes of no focus/activity
  useEffect(() => {
    const goIdle = () => {
      if (!isIdleRef.current) {
        isIdleRef.current = true;
        gateway.sendPresenceUpdate('idle');
      }
    };

    const goOnline = () => {
      if (isIdleRef.current) {
        isIdleRef.current = false;
        gateway.sendPresenceUpdate('online');
      }
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(goIdle, IDLE_TIMEOUT);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        idleTimerRef.current = setTimeout(goIdle, IDLE_TIMEOUT);
      } else {
        goOnline();
      }
    };

    // Start idle timer
    idleTimerRef.current = setTimeout(goIdle, IDLE_TIMEOUT);

    // Reset on user activity
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('mousemove', goOnline);
    window.addEventListener('keydown', goOnline);

    return () => {
      clearTimeout(idleTimerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('mousemove', goOnline);
      window.removeEventListener('keydown', goOnline);
    };
  }, []);

  return (
    <div className="app-layout">
      <ServerSidebar />
      {showChannelSidebar && <ChannelSidebar />}
      <ChatArea />
      {activeServerId && showMemberSidebar && <MemberSidebar />}
      {showSwitcher && <QuickSwitcher onClose={() => setShowSwitcher(false)} />}
    </div>
  );
}
