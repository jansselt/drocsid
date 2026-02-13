import { useServerStore } from '../../stores/serverStore';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import './ThreadPanel.css';

interface ThreadPanelProps {
  threadId: string;
}

export function ThreadPanel({ threadId }: ThreadPanelProps) {
  const closeThread = useServerStore((s) => s.closeThread);
  const threadMetadata = useServerStore((s) => s.threadMetadata);
  const channels = useServerStore((s) => s.channels);
  // Try to find thread channel name
  let threadName = 'Thread';
  for (const [, serverChannels] of channels) {
    const ch = serverChannels.find((c) => c.id === threadId);
    if (ch?.name) {
      threadName = ch.name;
      break;
    }
  }

  const meta = threadMetadata.get(threadId);

  return (
    <div className="thread-panel">
      <div className="thread-header">
        <div className="thread-header-info">
          <span className="thread-header-name">{threadName}</span>
          {meta && (
            <span className="thread-header-count">
              {meta.message_count} message{meta.message_count !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button className="thread-close" onClick={closeThread} title="Close Thread">
          &#x2715;
        </button>
      </div>
      <MessageList channelId={threadId} />
      <MessageInput channelId={threadId} />
    </div>
  );
}
