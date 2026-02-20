import { create } from 'zustand';
import type {
  Server,
  Channel,
  Message,
  MessageCreateEvent,
  MessageUpdateEvent,
  MessageDeleteEvent,
  MessageAckEvent,
  ReactionAddEvent,
  ReactionRemoveEvent,
  MessagePinEvent,
  ReadState,
  User,
  Role,
  RoleCreateEvent,
  RoleUpdateEvent,
  RoleDeleteEvent,
  ReactionGroup,
  RelationshipWithUser,
  DmChannelCreateEvent,
  RelationshipUpdateEvent,
  ThreadCreateEvent,
  TypingStartEvent,
  ThreadMetadata,
  SearchResult,
  VoiceState,
  VoiceStateUpdateEvent,
  PresenceUpdateEvent,
  ServerMemberWithUser,
  ServerMemberAddEvent,
  MemberRoleUpdateEvent,
  NotificationPreference,
  NotificationLevel,
  SoundboardSound,
  SoundboardSoundCreateEvent,
  SoundboardSoundDeleteEvent,
  SoundboardPlayEvent,
} from '../types';
import * as api from '../api/client';
import { getApiUrl } from '../api/instance';
import { gateway } from '../api/gateway';
import { useAuthStore } from './authStore';
import {
  playMessageSound,
  playMentionSound,
  playVoiceJoinSound,
  playVoiceLeaveSound,
} from '../utils/notificationSounds';
import { showBrowserNotification } from '../utils/browserNotifications';

type ViewMode = 'servers' | 'home';

interface TypingUser {
  userId: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface ServerState {
  // View mode
  view: ViewMode;

  // Server state
  servers: Server[];
  channels: Map<string, Channel[]>; // server_id -> channels
  roles: Map<string, Role[]>; // server_id -> roles
  activeServerId: string | null;
  activeChannelId: string | null;
  messages: Map<string, Message[]>; // channel_id -> messages
  reactions: Map<string, ReactionGroup[]>; // message_id -> reaction groups
  channelAccessOrder: string[]; // LRU tracking: most recently accessed at end
  users: Map<string, User>; // user_id -> User (cache)

  // DM state
  dmChannels: Channel[];
  dmRecipients: Map<string, User[]>; // channel_id -> recipients

  // Relationships
  relationships: RelationshipWithUser[];

  // Threads
  threads: Map<string, Channel[]>; // parent_channel_id -> thread channels
  threadMetadata: Map<string, ThreadMetadata>; // channel_id -> metadata
  activeThreadId: string | null;

  // Typing indicators
  typingUsers: Map<string, TypingUser[]>; // channel_id -> typing users

  // Search
  searchResults: SearchResult[] | null;
  searchQuery: string;

  // Members & Presence
  members: Map<string, ServerMemberWithUser[]>; // server_id -> enriched members
  presences: Map<string, string>; // user_id -> status (online/idle/dnd/offline)

  // UI: sidebar visibility
  showChannelSidebar: boolean;
  showMemberSidebar: boolean;

  // Read states (unread tracking)
  readStates: Map<string, ReadState>; // channel_id -> ReadState

  // Notification preferences
  notificationPrefs: Map<string, NotificationPreference>; // target_id -> pref

  // Reply
  replyingTo: Message | null;

  // Voice
  voiceChannelId: string | null; // channel we're connected to
  voiceToken: string | null;
  voiceUrl: string | null;
  voiceSelfMute: boolean;
  voiceSelfDeaf: boolean;
  voiceStates: Map<string, VoiceState[]>; // channel_id -> voice states
  speakingUsers: Set<string>; // user_ids currently speaking (from LiveKit)

  // Soundboard
  soundboardSounds: Map<string, SoundboardSound[]>; // server_id -> sounds

  // Actions
  setView: (view: ViewMode) => void;
  setServers: (servers: Server[]) => void;
  setActiveServer: (serverId: string) => void;
  setActiveChannel: (channelId: string) => void;
  loadChannels: (serverId: string) => Promise<void>;
  loadMessages: (channelId: string) => Promise<void>;
  loadMoreMessages: (channelId: string) => Promise<boolean>;
  setReplyingTo: (msg: Message | null) => void;
  sendMessage: (channelId: string, content: string, replyToId?: string) => Promise<void>;
  addMessage: (message: MessageCreateEvent) => void;
  updateMessage: (event: MessageUpdateEvent) => void;
  deleteMessage: (event: MessageDeleteEvent) => void;
  addServer: (server: Server) => void;
  removeServer: (serverId: string) => void;
  createServer: (name: string) => Promise<void>;
  createChannel: (serverId: string, name: string, channelType: string) => Promise<void>;
  loadRoles: (serverId: string) => Promise<void>;
  editMessage: (channelId: string, messageId: string, content: string) => Promise<void>;
  removeMessage: (channelId: string, messageId: string) => Promise<void>;
  addReaction: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  removeReaction: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  pinMessage: (channelId: string, messageId: string) => Promise<void>;
  unpinMessage: (channelId: string, messageId: string) => Promise<void>;

  // DM actions
  loadDmChannels: () => Promise<void>;
  openDm: (recipientId: string) => Promise<void>;
  createGroupDm: (recipientIds: string[], name?: string) => Promise<void>;
  closeDm: (channelId: string) => Promise<void>;
  addGroupDmRecipients: (channelId: string, recipientIds: string[]) => Promise<void>;
  setActiveDmChannel: (channelId: string) => void;

  // Relationship actions
  loadRelationships: () => Promise<void>;
  sendFriendRequest: (targetId: string) => Promise<void>;
  acceptFriend: (targetId: string) => Promise<void>;
  removeFriend: (targetId: string) => Promise<void>;
  blockUser: (targetId: string) => Promise<void>;

  // Thread actions
  openThread: (threadId: string) => void;
  closeThread: () => void;
  createThread: (channelId: string, name: string, messageId?: string) => Promise<void>;
  loadThreads: (channelId: string) => Promise<void>;

  // Search actions
  search: (query: string, serverId?: string) => Promise<void>;
  clearSearch: () => void;

  // Typing
  sendTyping: (channelId: string) => void;

  // Member & Presence actions
  loadMembers: (serverId: string) => Promise<void>;
  updateMyStatus: (status: string) => Promise<void>;

  // Voice actions
  voiceJoin: (channelId: string) => Promise<void>;
  voiceLeave: () => Promise<void>;
  voiceToggleMute: () => Promise<void>;
  voiceToggleDeaf: () => Promise<void>;
  loadVoiceStates: (channelId: string) => Promise<void>;
  setSpeakingUsers: (userIds: Set<string>) => void;

  // Soundboard actions
  loadSoundboard: (serverId: string) => Promise<void>;
  playSoundboard: (serverId: string, soundId: string) => Promise<void>;

  // Read state actions
  setReadStates: (readStates: ReadState[]) => void;
  ackChannel: (channelId: string) => void;

  // Notification preference actions
  setNotificationPrefs: (prefs: NotificationPreference[]) => void;
  updateNotificationPref: (
    targetId: string,
    targetType: 'channel' | 'server',
    level: NotificationLevel,
    muted: boolean,
  ) => Promise<void>;

  toggleChannelSidebar: () => void;
  toggleMemberSidebar: () => void;

  restoreNavigation: () => void;

  initGatewayHandlers: () => () => void;
}

const TYPING_TIMEOUT = 8000;
const MAX_CACHED_CHANNELS = 5;

// Track the beforeunload handler for voice cleanup on tab close
let voiceBeforeUnloadHandler: (() => void) | null = null;
function removeVoiceBeforeUnload() {
  if (voiceBeforeUnloadHandler) {
    window.removeEventListener('beforeunload', voiceBeforeUnloadHandler);
    voiceBeforeUnloadHandler = null;
  }
}

function touchLru(order: string[], channelId: string): string[] {
  const filtered = order.filter((id) => id !== channelId);
  filtered.push(channelId);
  return filtered;
}

function evictLruChannels(
  messages: Map<string, Message[]>,
  reactions: Map<string, ReactionGroup[]>,
  channelAccessOrder: string[],
): { messages: Map<string, Message[]>; reactions: Map<string, ReactionGroup[]>; channelAccessOrder: string[] } {
  if (channelAccessOrder.length <= MAX_CACHED_CHANNELS) {
    return { messages, reactions, channelAccessOrder };
  }

  const newMessages = new Map(messages);
  const newReactions = new Map(reactions);
  const newOrder = [...channelAccessOrder];

  while (newOrder.length > MAX_CACHED_CHANNELS) {
    const evictedChannelId = newOrder.shift()!;
    const evictedMsgs = newMessages.get(evictedChannelId);
    if (evictedMsgs) {
      for (const msg of evictedMsgs) {
        newReactions.delete(msg.id);
      }
      newMessages.delete(evictedChannelId);
    }
  }

  return { messages: newMessages, reactions: newReactions, channelAccessOrder: newOrder };
}

function updateLastMessageId(
  state: { channels: Map<string, Channel[]>; dmChannels: Channel[] },
  channelId: string,
  messageId: string,
): { channels: Map<string, Channel[]>; dmChannels: Channel[] } {
  const channels = new Map(state.channels);
  for (const [serverId, serverChannels] of channels) {
    const idx = serverChannels.findIndex((c) => c.id === channelId);
    if (idx !== -1) {
      const updated = [...serverChannels];
      updated[idx] = { ...updated[idx], last_message_id: messageId };
      channels.set(serverId, updated);
      break;
    }
  }
  const dmChannels = state.dmChannels.map((c) =>
    c.id === channelId ? { ...c, last_message_id: messageId } : c,
  );
  return { channels, dmChannels };
}

export const useServerStore = create<ServerState>((set, get) => ({
  view: 'servers',
  servers: [],
  channels: new Map(),
  roles: new Map(),
  activeServerId: null,
  activeChannelId: null,
  messages: new Map(),
  reactions: new Map(),
  channelAccessOrder: [],
  users: new Map(),
  showChannelSidebar: JSON.parse(localStorage.getItem('drocsid_show_channel_sidebar') ?? 'true'),
  showMemberSidebar: JSON.parse(localStorage.getItem('drocsid_show_member_sidebar') ?? 'true'),
  readStates: new Map(),
  notificationPrefs: new Map(),
  replyingTo: null,
  voiceChannelId: null,
  voiceToken: null,
  voiceUrl: null,
  voiceSelfMute: false,
  voiceSelfDeaf: false,
  voiceStates: new Map(),
  speakingUsers: new Set(),
  soundboardSounds: new Map(),
  members: new Map(),
  presences: new Map(),
  dmChannels: [],
  dmRecipients: new Map(),
  relationships: [],
  threads: new Map(),
  threadMetadata: new Map(),
  activeThreadId: null,
  typingUsers: new Map(),
  searchResults: null,
  searchQuery: '',

  setView: (view) => {
    set({ view, activeServerId: null, activeChannelId: null, activeThreadId: null });
    if (view === 'home') {
      get().loadDmChannels();
      get().loadRelationships();
    }
  },

  setServers: (servers) => set({ servers }),

  setActiveServer: (serverId) => {
    set({ activeServerId: serverId, activeChannelId: null, activeThreadId: null, view: 'servers', threads: new Map(), threadMetadata: new Map() });
    const { channels, loadChannels, roles, loadRoles, members, loadMembers } = get();
    if (!channels.has(serverId)) {
      loadChannels(serverId);
    } else {
      const serverChannels = channels.get(serverId) || [];
      const firstText = serverChannels.find((c) => c.channel_type === 'text');
      if (firstText) {
        get().setActiveChannel(firstText.id);
      }
    }
    if (!roles.has(serverId)) {
      loadRoles(serverId);
    }
    if (!members.has(serverId)) {
      loadMembers(serverId);
    }
  },

  setActiveChannel: (channelId) => {
    set((state) => ({
      activeChannelId: channelId,
      activeThreadId: null,
      channelAccessOrder: touchLru(state.channelAccessOrder, channelId),
    }));
    const { messages, loadMessages } = get();
    if (!messages.has(channelId)) {
      loadMessages(channelId);
    }
    // Auto-ack when switching to a channel
    get().ackChannel(channelId);
  },

  loadChannels: async (serverId) => {
    const serverChannels = await api.getServerChannels(serverId);
    set((state) => {
      const channels = new Map(state.channels);
      channels.set(serverId, serverChannels);
      return { channels };
    });

    const firstText = serverChannels.find((c) => c.channel_type === 'text');
    if (firstText && get().activeServerId === serverId) {
      get().setActiveChannel(firstText.id);
    }
  },

  loadMessages: async (channelId) => {
    const msgs = await api.getMessages(channelId, { limit: 50 });
    msgs.reverse();
    set((state) => {
      const messages = new Map(state.messages);
      messages.set(channelId, msgs);
      const reactions = new Map(state.reactions);
      for (const msg of msgs) {
        if (msg.reactions && msg.reactions.length > 0) {
          reactions.set(msg.id, msg.reactions);
        }
      }
      const channelAccessOrder = touchLru(state.channelAccessOrder, channelId);
      return evictLruChannels(messages, reactions, channelAccessOrder);
    });
  },

  loadMoreMessages: async (channelId) => {
    const existing = get().messages.get(channelId) || [];
    if (existing.length === 0) return false;

    const oldestId = existing[0].id;
    const older = await api.getMessages(channelId, { before: oldestId, limit: 50 });
    if (older.length === 0) return false;

    older.reverse();
    set((state) => {
      const messages = new Map(state.messages);
      const current = messages.get(channelId) || [];
      messages.set(channelId, [...older, ...current]);
      const reactions = new Map(state.reactions);
      for (const msg of older) {
        if (msg.reactions && msg.reactions.length > 0) {
          reactions.set(msg.id, msg.reactions);
        }
      }
      return { messages, reactions };
    });
    return true;
  },

  setReplyingTo: (msg) => set({ replyingTo: msg }),

  sendMessage: async (channelId, content, replyToId) => {
    await api.sendMessage(channelId, content, replyToId);
  },

  addMessage: (message) => {
    // Notification sounds & browser notifications — only for messages from other users
    const currentUser = useAuthStore.getState().user;
    if (currentUser && message.author_id !== currentUser.id) {
      const state = get();
      const isDm = state.dmChannels.some((c) => c.id === message.channel_id);
      const content = message.content ?? '';
      const isMention =
        content.includes(`@${currentUser.username}`) ||
        content.includes(`<@${currentUser.id}>`) ||
        content.includes('@everyone') ||
        content.includes('@here');

      const authorName =
        message.author?.display_name || message.author?.username || 'Someone';
      const preview =
        content.length > 100 ? content.slice(0, 100) + '...' : content;

      // Find server_id for navigation
      let serverId: string | null = null;
      for (const [sid, serverChannels] of state.channels) {
        if (serverChannels.some((c) => c.id === message.channel_id)) {
          serverId = sid;
          break;
        }
      }

      // Check notification preferences (channel > server > default 'all')
      const channelPref = state.notificationPrefs.get(message.channel_id);
      const serverPref = serverId
        ? state.notificationPrefs.get(serverId)
        : undefined;
      const effectivePref = channelPref || serverPref;
      const isMuted = effectivePref?.muted ?? false;
      const level = effectivePref?.notification_level ?? 'all';

      // DND suppresses all notifications
      const myPresence = state.presences.get(currentUser.id);
      const isDnd = myPresence === 'dnd';

      // Determine if we should notify
      const shouldNotify =
        !isDnd &&
        !isMuted &&
        (level === 'all' ||
          (level === 'mentions' && (isMention || isDm)));

      if (shouldNotify) {
        if (isMention) {
          playMentionSound();
          showBrowserNotification(
            `${authorName} mentioned you`,
            preview,
            () => {
              if (serverId) {
                get().setActiveServer(serverId);
                get().setActiveChannel(message.channel_id);
              } else if (isDm) {
                get().setView('home');
                get().setActiveDmChannel(message.channel_id);
              }
            },
            `mention-${message.channel_id}`,
          );
        } else if (isDm) {
          playMessageSound();
          showBrowserNotification(
            authorName,
            preview,
            () => {
              get().setView('home');
              get().setActiveDmChannel(message.channel_id);
            },
            `dm-${message.channel_id}`,
          );
        }
      }
    }

    set((state) => {
      const result: Partial<ServerState> = {};

      // Cache author only if not already known (skip redundant Map clones)
      if (message.author && !state.users.has(message.author.id)) {
        const users = new Map(state.users);
        users.set(message.author.id, message.author);
        result.users = users;
      }

      // If channel was LRU-evicted, don't create a partial cache entry
      const channelMessages = state.messages.get(message.channel_id);
      if (channelMessages) {
        if (channelMessages.some((m) => m.id === message.id)) {
          // Duplicate message — still update last_message_id
          Object.assign(result, updateLastMessageId(state, message.channel_id, message.id));
          return Object.keys(result).length > 0 ? result : state;
        }
        const messages = new Map(state.messages);
        messages.set(message.channel_id, [...channelMessages, message]);
        result.messages = messages;
      }

      Object.assign(result, updateLastMessageId(state, message.channel_id, message.id));
      return Object.keys(result).length > 0 ? result : state;
    });

    // Auto-ack if this is the active channel
    if (get().activeChannelId === message.channel_id) {
      get().ackChannel(message.channel_id);
    }
  },

  updateMessage: (event) => {
    set((state) => {
      const messages = new Map(state.messages);
      const channelMessages = messages.get(event.channel_id);
      if (!channelMessages) return state;

      const updated = channelMessages.map((m) =>
        m.id === event.id
          ? { ...m, content: event.content, edited_at: event.edited_at }
          : m,
      );
      messages.set(event.channel_id, updated);

      const reactions = new Map(state.reactions);
      reactions.set(event.id, event.reactions);

      return { messages, reactions };
    });
  },

  deleteMessage: (event) => {
    set((state) => {
      const messages = new Map(state.messages);
      const channelMessages = messages.get(event.channel_id);
      if (!channelMessages) return state;
      messages.set(
        event.channel_id,
        channelMessages.filter((m) => m.id !== event.id),
      );

      const reactions = new Map(state.reactions);
      reactions.delete(event.id);

      return { messages, reactions };
    });
  },

  addServer: (server) => {
    set((state) => {
      if (state.servers.some((s) => s.id === server.id)) return state;
      return { servers: [...state.servers, server] };
    });
  },

  removeServer: (serverId) => {
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== serverId),
      activeServerId: state.activeServerId === serverId ? null : state.activeServerId,
      activeChannelId: state.activeServerId === serverId ? null : state.activeChannelId,
    }));
  },

  createServer: async (name) => {
    await api.createServer(name);
  },

  createChannel: async (serverId, name, channelType) => {
    await api.createChannel(serverId, name, channelType);
    // Channel will appear via CHANNEL_CREATE gateway event
  },

  loadRoles: async (serverId) => {
    try {
      const serverRoles = await api.getServerRoles(serverId);
      set((state) => {
        const roles = new Map(state.roles);
        roles.set(serverId, serverRoles);
        return { roles };
      });
    } catch {
      // May fail if user doesn't have permission
    }
  },

  editMessage: async (channelId, messageId, content) => {
    await api.editMessage(channelId, messageId, content);
  },

  removeMessage: async (channelId, messageId) => {
    await api.deleteMessage(channelId, messageId);
  },

  addReaction: async (channelId, messageId, emoji) => {
    await api.addReaction(channelId, messageId, emoji);
  },

  removeReaction: async (channelId, messageId, emoji) => {
    await api.removeReaction(channelId, messageId, emoji);
  },

  pinMessage: async (channelId, messageId) => {
    // Optimistic update
    set((state) => {
      const messages = new Map(state.messages);
      const channelMessages = messages.get(channelId);
      if (channelMessages) {
        messages.set(channelId, channelMessages.map((m) =>
          m.id === messageId ? { ...m, pinned: true } : m,
        ));
      }
      return { messages };
    });
    try {
      await api.pinMessage(channelId, messageId);
    } catch (err) {
      // Revert on failure
      set((state) => {
        const messages = new Map(state.messages);
        const channelMessages = messages.get(channelId);
        if (channelMessages) {
          messages.set(channelId, channelMessages.map((m) =>
            m.id === messageId ? { ...m, pinned: false } : m,
          ));
        }
        return { messages };
      });
      throw err;
    }
  },

  unpinMessage: async (channelId, messageId) => {
    // Optimistic update
    set((state) => {
      const messages = new Map(state.messages);
      const channelMessages = messages.get(channelId);
      if (channelMessages) {
        messages.set(channelId, channelMessages.map((m) =>
          m.id === messageId ? { ...m, pinned: false } : m,
        ));
      }
      return { messages };
    });
    try {
      await api.unpinMessage(channelId, messageId);
    } catch (err) {
      // Revert on failure
      set((state) => {
        const messages = new Map(state.messages);
        const channelMessages = messages.get(channelId);
        if (channelMessages) {
          messages.set(channelId, channelMessages.map((m) =>
            m.id === messageId ? { ...m, pinned: true } : m,
          ));
        }
        return { messages };
      });
      throw err;
    }
  },

  // ── DM Actions ───────────────────────────────────────

  loadDmChannels: async () => {
    const channels = await api.getDmChannels();
    set({ dmChannels: channels });

    for (const ch of channels) {
      try {
        const recipients = await api.getDmRecipients(ch.id);
        set((state) => {
          const dmRecipients = new Map(state.dmRecipients);
          dmRecipients.set(ch.id, recipients);
          const users = new Map(state.users);
          for (const r of recipients) {
            users.set(r.id, r);
          }
          return { dmRecipients, users };
        });
      } catch {
        // ignore
      }
    }
  },

  openDm: async (recipientId) => {
    const channel = await api.createDm(recipientId);
    set((state) => {
      const dmChannels = state.dmChannels.some((c) => c.id === channel.id)
        ? state.dmChannels
        : [channel, ...state.dmChannels];
      return {
        dmChannels,
        view: 'home' as ViewMode,
        activeServerId: null,
        activeChannelId: channel.id,
        activeThreadId: null,
      };
    });
    get().loadMessages(channel.id);
    try {
      const recipients = await api.getDmRecipients(channel.id);
      set((state) => {
        const dmRecipients = new Map(state.dmRecipients);
        dmRecipients.set(channel.id, recipients);
        const users = new Map(state.users);
        for (const r of recipients) {
          users.set(r.id, r);
        }
        return { dmRecipients, users };
      });
    } catch {
      // ignore
    }
  },

  createGroupDm: async (recipientIds, name) => {
    const channel = await api.createGroupDm(recipientIds, name);
    set((state) => {
      const dmChannels = state.dmChannels.some((c) => c.id === channel.id)
        ? state.dmChannels
        : [channel, ...state.dmChannels];
      return {
        dmChannels,
        view: 'home' as ViewMode,
        activeServerId: null,
        activeChannelId: channel.id,
        activeThreadId: null,
      };
    });
    get().loadMessages(channel.id);
    try {
      const recipients = await api.getDmRecipients(channel.id);
      set((state) => {
        const dmRecipients = new Map(state.dmRecipients);
        dmRecipients.set(channel.id, recipients);
        const users = new Map(state.users);
        for (const r of recipients) {
          users.set(r.id, r);
        }
        return { dmRecipients, users };
      });
    } catch {
      // ignore
    }
  },

  closeDm: async (channelId) => {
    try {
      await api.closeDm(channelId);
      set((state) => ({
        dmChannels: state.dmChannels.filter((c) => c.id !== channelId),
        activeChannelId: state.activeChannelId === channelId ? null : state.activeChannelId,
      }));
    } catch {
      // ignore
    }
  },

  addGroupDmRecipients: async (channelId, recipientIds) => {
    const recipients = await api.addGroupDmRecipients(channelId, recipientIds);
    set((state) => {
      const dmRecipients = new Map(state.dmRecipients);
      dmRecipients.set(channelId, recipients);
      const users = new Map(state.users);
      for (const r of recipients) {
        users.set(r.id, r);
      }
      return { dmRecipients, users };
    });
  },

  setActiveDmChannel: (channelId) => {
    set((state) => ({
      activeChannelId: channelId,
      activeServerId: null,
      activeThreadId: null,
      view: 'home' as ViewMode,
      channelAccessOrder: touchLru(state.channelAccessOrder, channelId),
    }));
    const { messages, loadMessages } = get();
    if (!messages.has(channelId)) {
      loadMessages(channelId);
    }
    // Auto-ack when switching to a DM channel
    get().ackChannel(channelId);
  },

  // ── Relationship Actions ─────────────────────────────

  loadRelationships: async () => {
    try {
      const rels = await api.getRelationships();
      set({ relationships: rels });
      set((state) => {
        const users = new Map(state.users);
        for (const r of rels) {
          users.set(r.user.id, r.user);
        }
        return { users };
      });
    } catch {
      // ignore
    }
  },

  sendFriendRequest: async (targetId) => {
    await api.sendFriendRequest(targetId);
    get().loadRelationships();
  },

  acceptFriend: async (targetId) => {
    await api.acceptFriendRequest(targetId);
    get().loadRelationships();
  },

  removeFriend: async (targetId) => {
    await api.removeRelationship(targetId);
    get().loadRelationships();
  },

  blockUser: async (targetId) => {
    await api.blockUser(targetId);
    get().loadRelationships();
  },

  // ── Thread Actions ───────────────────────────────────

  openThread: (threadId) => {
    set({ activeThreadId: threadId });
    const { messages, loadMessages } = get();
    if (!messages.has(threadId)) {
      loadMessages(threadId);
    }
  },

  closeThread: () => set({ activeThreadId: null }),

  createThread: async (channelId, name, messageId) => {
    const result = await api.createThread(channelId, name, messageId);
    set((state) => {
      const threads = new Map(state.threads);
      const existing = threads.get(channelId) || [];
      threads.set(channelId, [...existing, result.channel]);

      const threadMetadata = new Map(state.threadMetadata);
      threadMetadata.set(result.channel.id, result.metadata);

      return { threads, threadMetadata, activeThreadId: result.channel.id };
    });
    get().loadMessages(result.channel.id);
  },

  loadThreads: async (channelId) => {
    try {
      const threadList = await api.getThreads(channelId);
      set((state) => {
        const threads = new Map(state.threads);
        threads.set(channelId, threadList);
        return { threads };
      });
    } catch {
      // ignore
    }
  },

  // ── Search Actions ───────────────────────────────────

  search: async (query, serverId) => {
    set({ searchQuery: query });
    const results = await api.searchMessages(query, { server_id: serverId });
    set({ searchResults: results });
  },

  clearSearch: () => set({ searchResults: null, searchQuery: '' }),

  // ── Typing ───────────────────────────────────────────

  sendTyping: (channelId) => {
    api.sendTyping(channelId).catch(() => {});
  },

  // ── Member & Presence Actions ──────────────────────

  loadMembers: async (serverId) => {
    try {
      const memberList = await api.getServerMembers(serverId);
      set((state) => {
        const members = new Map(state.members);
        members.set(serverId, memberList);
        // Also cache user data and presence
        const users = new Map(state.users);
        const presences = new Map(state.presences);
        for (const m of memberList) {
          users.set(m.user_id, m.user);
          presences.set(m.user_id, m.status);
        }
        return { members, users, presences };
      });
    } catch {
      // ignore
    }
  },

  updateMyStatus: async (status) => {
    try {
      await api.updateMe({ status });
      gateway.sendPresenceUpdate(status);
      // Set own presence locally so the UI reflects the chosen status immediately
      // (the server broadcasts "offline" for invisible, so we must set it here)
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        set((state) => {
          const presences = new Map(state.presences);
          presences.set(userId, status);
          return { presences };
        });
      }
    } catch {
      // ignore
    }
  },

  // ── Voice Actions ──────────────────────────────────

  voiceJoin: async (channelId) => {
    // Leave current voice channel if any
    const current = get().voiceChannelId;
    if (current) {
      await api.voiceLeave(current).catch(() => {});
    }

    const resp = await api.voiceJoin(channelId, get().voiceSelfMute, get().voiceSelfDeaf);
    set({
      voiceChannelId: channelId,
      voiceToken: resp.token,
      voiceUrl: resp.url,
    });
    playVoiceJoinSound();

    // Register beforeunload handler so closing the tab sends a leave beacon
    removeVoiceBeforeUnload();
    const handler = () => {
      const chId = get().voiceChannelId;
      if (chId) {
        const token = api.getAccessToken();
        if (token) {
          // sendBeacon is guaranteed to fire during page unload
          navigator.sendBeacon(
            `${getApiUrl()}/channels/${chId}/voice/leave?token=${encodeURIComponent(token)}`,
          );
        }
      }
    };
    voiceBeforeUnloadHandler = handler;
    window.addEventListener('beforeunload', handler);

    // Load current voice states for this channel
    get().loadVoiceStates(channelId);
  },

  voiceLeave: async () => {
    removeVoiceBeforeUnload();
    const channelId = get().voiceChannelId;
    if (channelId) {
      await api.voiceLeave(channelId).catch(() => {});
      playVoiceLeaveSound();
    }
    set({
      voiceChannelId: null,
      voiceToken: null,
      voiceUrl: null,
      voiceSelfMute: false,
      voiceSelfDeaf: false,
    });
  },

  voiceToggleMute: async () => {
    const channelId = get().voiceChannelId;
    if (!channelId) return;
    const newMute = !get().voiceSelfMute;
    set({ voiceSelfMute: newMute });
    await api.voiceUpdateState(channelId, newMute, undefined).catch(() => {});
  },

  voiceToggleDeaf: async () => {
    const channelId = get().voiceChannelId;
    if (!channelId) return;
    const newDeaf = !get().voiceSelfDeaf;
    // Deafening also mutes
    const newMute = newDeaf ? true : get().voiceSelfMute;
    set({ voiceSelfDeaf: newDeaf, voiceSelfMute: newMute });
    await api.voiceUpdateState(channelId, newMute, newDeaf).catch(() => {});
  },

  setSpeakingUsers: (userIds) => set({ speakingUsers: userIds }),

  loadSoundboard: async (serverId) => {
    try {
      const sounds = await api.getSoundboardSounds(serverId);
      set((state) => {
        const soundboardSounds = new Map(state.soundboardSounds);
        soundboardSounds.set(serverId, sounds);
        return { soundboardSounds };
      });
    } catch (e) {
      console.error('[soundboard] Failed to load sounds:', e);
    }
  },

  playSoundboard: async (serverId, soundId) => {
    try {
      await api.playSoundboardSound(serverId, soundId);
    } catch (e) {
      console.error('[soundboard] Failed to play sound:', e);
    }
  },

  loadVoiceStates: async (channelId) => {
    try {
      const states = await api.voiceGetStates(channelId);
      set((state) => {
        const voiceStates = new Map(state.voiceStates);
        voiceStates.set(channelId, states);
        return { voiceStates };
      });
    } catch {
      // ignore
    }
  },

  // ── Read State Actions ──────────────────────────────

  setReadStates: (readStatesArray) => {
    set(() => {
      const readStates = new Map<string, ReadState>();
      for (const rs of readStatesArray) {
        readStates.set(rs.channel_id, rs);
      }
      return { readStates };
    });
  },

  ackChannel: (channelId) => {
    // Find the latest message ID for this channel
    const state = get();
    const channelMessages = state.messages.get(channelId);
    let latestMessageId: string | null = null;

    if (channelMessages && channelMessages.length > 0) {
      latestMessageId = channelMessages[channelMessages.length - 1].id;
    } else {
      // Check last_message_id from channel data
      for (const [, serverChannels] of state.channels) {
        const ch = serverChannels.find((c) => c.id === channelId);
        if (ch?.last_message_id) {
          latestMessageId = ch.last_message_id;
          break;
        }
      }
      if (!latestMessageId) {
        const dmCh = state.dmChannels.find((c) => c.id === channelId);
        if (dmCh?.last_message_id) {
          latestMessageId = dmCh.last_message_id;
        }
      }
    }

    if (!latestMessageId) return;

    // Check if already acked up to this point
    const existing = state.readStates.get(channelId);
    if (existing?.last_read_message_id && existing.last_read_message_id >= latestMessageId) {
      return;
    }

    // Optimistic update
    set((s) => {
      const readStates = new Map(s.readStates);
      readStates.set(channelId, {
        channel_id: channelId,
        last_read_message_id: latestMessageId,
        mention_count: 0,
      });
      return { readStates };
    });

    // Fire and forget API call
    api.ackChannel(channelId, latestMessageId).catch(() => {});
  },

  setNotificationPrefs: (prefs) => {
    set(() => {
      const notificationPrefs = new Map<string, NotificationPreference>();
      for (const p of prefs) {
        notificationPrefs.set(p.target_id, p);
      }
      return { notificationPrefs };
    });
  },

  updateNotificationPref: async (targetId, targetType, level, muted) => {
    // Optimistic update
    set((state) => {
      const notificationPrefs = new Map(state.notificationPrefs);
      notificationPrefs.set(targetId, {
        target_id: targetId,
        target_type: targetType,
        notification_level: level,
        muted,
      });
      return { notificationPrefs };
    });
    try {
      await api.setNotificationPreference(targetId, targetType, level, muted);
    } catch {
      // Revert on failure
      const prefs = await api.getNotificationPreferences();
      get().setNotificationPrefs(prefs);
    }
  },

  toggleChannelSidebar: () => {
    set((state) => {
      const next = !state.showChannelSidebar;
      localStorage.setItem('drocsid_show_channel_sidebar', JSON.stringify(next));
      return { showChannelSidebar: next };
    });
  },

  toggleMemberSidebar: () => {
    set((state) => {
      const next = !state.showMemberSidebar;
      localStorage.setItem('drocsid_show_member_sidebar', JSON.stringify(next));
      return { showMemberSidebar: next };
    });
  },

  restoreNavigation: () => {
    try {
      const saved = localStorage.getItem('drocsid_nav');
      if (!saved) return;
      const nav = JSON.parse(saved) as {
        view?: string;
        serverId?: string | null;
        channelId?: string | null;
      };
      if (nav.view === 'servers' && nav.serverId) {
        get().setActiveServer(nav.serverId);
        // setActiveServer auto-selects first text channel, but we want to restore the exact channel
        if (nav.channelId) {
          // Wait for channels to load then restore
          const checkAndRestore = () => {
            const channels = get().channels.get(nav.serverId!);
            if (channels && channels.some((c) => c.id === nav.channelId)) {
              get().setActiveChannel(nav.channelId!);
            }
          };
          // Try immediately (channels may be cached), then retry after a short delay
          checkAndRestore();
          setTimeout(checkAndRestore, 500);
        }
      } else if (nav.view === 'home') {
        get().setView('home');
        if (nav.channelId) {
          get().setActiveDmChannel(nav.channelId);
        }
      }
    } catch {
      // ignore corrupt localStorage
    }
  },

  // ── Gateway Handlers ─────────────────────────────────

  initGatewayHandlers: () => {
    const removeHandler = gateway.addHandler((event, data) => {
      switch (event) {
        case 'MESSAGE_CREATE':
          get().addMessage(data as MessageCreateEvent);
          break;
        case 'MESSAGE_UPDATE':
          get().updateMessage(data as MessageUpdateEvent);
          break;
        case 'MESSAGE_DELETE':
          get().deleteMessage(data as MessageDeleteEvent);
          break;
        case 'CHANNEL_MESSAGES_PURGE': {
          const { channel_id } = data as { channel_id: string };
          set((state) => {
            const messages = new Map(state.messages);
            messages.set(channel_id, []);
            return { messages };
          });
          break;
        }
        case 'REACTION_ADD': {
          const reaction = data as ReactionAddEvent;
          set((state) => {
            const reactions = new Map(state.reactions);
            const groups = reactions.get(reaction.message_id) || [];
            const existing = groups.find((g) => g.emoji_name === reaction.emoji_name);
            if (existing) {
              reactions.set(
                reaction.message_id,
                groups.map((g) =>
                  g.emoji_name === reaction.emoji_name
                    ? { ...g, count: g.count + 1 }
                    : g,
                ),
              );
            } else {
              reactions.set(reaction.message_id, [
                ...groups,
                {
                  emoji_name: reaction.emoji_name,
                  emoji_id: reaction.emoji_id,
                  count: 1,
                  me: false,
                },
              ]);
            }
            return { reactions };
          });
          break;
        }
        case 'REACTION_REMOVE': {
          const reaction = data as ReactionRemoveEvent;
          set((state) => {
            const reactions = new Map(state.reactions);
            const groups = reactions.get(reaction.message_id) || [];
            const updated = groups
              .map((g) =>
                g.emoji_name === reaction.emoji_name
                  ? { ...g, count: g.count - 1 }
                  : g,
              )
              .filter((g) => g.count > 0);
            reactions.set(reaction.message_id, updated);
            return { reactions };
          });
          break;
        }
        case 'MESSAGE_PIN': {
          const pin = data as MessagePinEvent;
          set((state) => {
            const messages = new Map(state.messages);
            const channelMessages = messages.get(pin.channel_id);
            if (!channelMessages) return state;
            messages.set(
              pin.channel_id,
              channelMessages.map((m) =>
                m.id === pin.message_id ? { ...m, pinned: pin.pinned } : m,
              ),
            );
            return { messages };
          });
          break;
        }
        case 'SERVER_CREATE':
          get().addServer(data as Server);
          break;
        case 'SERVER_MEMBER_ADD': {
          const ev = data as ServerMemberAddEvent;
          set((state) => {
            // Cache the user
            const users = new Map(state.users);
            users.set(ev.user.id, ev.user);

            // Add to members list if loaded for this server
            const members = new Map(state.members);
            const existing = members.get(ev.server_id);
            if (existing && !existing.some((m) => m.user_id === ev.member.user_id)) {
              members.set(ev.server_id, [
                ...existing,
                {
                  ...ev.member,
                  user: ev.user,
                  status: 'online',
                  role_ids: [],
                },
              ]);
            }

            return { users, members };
          });
          break;
        }
        case 'SERVER_DELETE': {
          const { id } = data as { id: string };
          get().removeServer(id);
          break;
        }
        case 'CHANNEL_CREATE': {
          const channel = data as Channel;
          if (channel.server_id) {
            set((state) => {
              const channels = new Map(state.channels);
              const existing = channels.get(channel.server_id!) || [];
              channels.set(channel.server_id!, [...existing, channel]);
              return { channels };
            });
          }
          break;
        }
        case 'CHANNEL_UPDATE': {
          const channel = data as Channel;
          if (channel.server_id) {
            set((state) => {
              const channels = new Map(state.channels);
              const existing = channels.get(channel.server_id!) || [];
              channels.set(
                channel.server_id!,
                existing.map((c) => (c.id === channel.id ? channel : c)),
              );
              return { channels };
            });
          }
          break;
        }
        case 'CHANNEL_DELETE': {
          const { id, server_id } = data as { id: string; server_id: string };
          set((state) => {
            const channels = new Map(state.channels);
            const existing = channels.get(server_id) || [];
            channels.set(
              server_id,
              existing.filter((c) => c.id !== id),
            );
            return {
              channels,
              activeChannelId: state.activeChannelId === id ? null : state.activeChannelId,
            };
          });
          break;
        }
        case 'ROLE_CREATE': {
          const role = data as RoleCreateEvent;
          set((state) => {
            const roles = new Map(state.roles);
            const existing = roles.get(role.server_id) || [];
            if (existing.some((r) => r.id === role.id)) return state;
            roles.set(role.server_id, [...existing, role]);
            return { roles };
          });
          break;
        }
        case 'ROLE_UPDATE': {
          const role = data as RoleUpdateEvent;
          set((state) => {
            const roles = new Map(state.roles);
            const existing = roles.get(role.server_id) || [];
            roles.set(
              role.server_id,
              existing.map((r) => (r.id === role.id ? role : r)),
            );
            return { roles };
          });
          break;
        }
        case 'ROLE_DELETE': {
          const { server_id, role_id } = data as RoleDeleteEvent;
          set((state) => {
            const roles = new Map(state.roles);
            const existing = roles.get(server_id) || [];
            roles.set(
              server_id,
              existing.filter((r) => r.id !== role_id),
            );
            return { roles };
          });
          break;
        }
        case 'MEMBER_ROLE_UPDATE': {
          const ev = data as MemberRoleUpdateEvent;
          set((state) => {
            const members = new Map(state.members);
            const existing = members.get(ev.server_id);
            if (existing) {
              members.set(
                ev.server_id,
                existing.map((m) =>
                  m.user_id === ev.user_id ? { ...m, role_ids: ev.role_ids } : m,
                ),
              );
            }
            return { members };
          });
          break;
        }
        case 'DM_CHANNEL_CREATE': {
          const ev = data as DmChannelCreateEvent;
          set((state) => {
            const dmChannels = state.dmChannels.some((c) => c.id === ev.channel.id)
              ? state.dmChannels
              : [ev.channel, ...state.dmChannels];
            const dmRecipients = new Map(state.dmRecipients);
            dmRecipients.set(ev.channel.id, ev.recipients);
            const users = new Map(state.users);
            for (const r of ev.recipients) {
              users.set(r.id, r);
            }
            return { dmChannels, dmRecipients, users };
          });
          break;
        }
        case 'DM_RECIPIENT_ADD': {
          const ev = data as DmChannelCreateEvent;
          set((state) => {
            const dmRecipients = new Map(state.dmRecipients);
            dmRecipients.set(ev.channel.id, ev.recipients);
            const users = new Map(state.users);
            for (const r of ev.recipients) {
              users.set(r.id, r);
            }
            return { dmRecipients, users };
          });
          break;
        }
        case 'RELATIONSHIP_UPDATE': {
          const ev = data as RelationshipUpdateEvent;
          if (ev.rel_type) {
            get().loadRelationships();
          } else {
            set((state) => ({
              relationships: state.relationships.filter(
                (r) => r.target_id !== ev.target_id,
              ),
            }));
          }
          break;
        }
        case 'THREAD_CREATE': {
          const ev = data as ThreadCreateEvent;
          set((state) => {
            const threads = new Map(state.threads);
            const existing = threads.get(ev.parent_channel_id) || [];
            if (!existing.some((t) => t.id === ev.channel.id)) {
              threads.set(ev.parent_channel_id, [...existing, ev.channel]);
            }
            const threadMetadata = new Map(state.threadMetadata);
            threadMetadata.set(ev.channel.id, ev.metadata);
            return { threads, threadMetadata };
          });
          break;
        }
        case 'TYPING_START': {
          const ev = data as TypingStartEvent;
          set((state) => {
            const typingUsers = new Map(state.typingUsers);
            const channelTyping = (typingUsers.get(ev.channel_id) || []).filter(
              (t) => t.userId !== ev.user_id,
            );

            const existing = (typingUsers.get(ev.channel_id) || []).find(
              (t) => t.userId === ev.user_id,
            );
            if (existing) {
              clearTimeout(existing.timeout);
            }

            const timeout = setTimeout(() => {
              set((s) => {
                const tu = new Map(s.typingUsers);
                const ct = (tu.get(ev.channel_id) || []).filter(
                  (t) => t.userId !== ev.user_id,
                );
                tu.set(ev.channel_id, ct);
                return { typingUsers: tu };
              });
            }, TYPING_TIMEOUT);

            channelTyping.push({ userId: ev.user_id, timeout });
            typingUsers.set(ev.channel_id, channelTyping);
            return { typingUsers };
          });
          break;
        }
        case 'VOICE_STATE_UPDATE': {
          const ev = data as VoiceStateUpdateEvent;

          // Play join/leave sounds for other users in our voice channel
          const currentUser = useAuthStore.getState().user;
          const myVoiceChannel = get().voiceChannelId;
          if (currentUser && ev.user_id !== currentUser.id && myVoiceChannel) {
            // Was user previously in our channel?
            const wasInOurChannel = (get().voiceStates.get(myVoiceChannel) || [])
              .some((s) => s.user_id === ev.user_id);

            if (ev.channel_id === myVoiceChannel && !wasInOurChannel) {
              playVoiceJoinSound();
            } else if (ev.channel_id !== myVoiceChannel && wasInOurChannel) {
              playVoiceLeaveSound();
            }
          }

          set((state) => {
            const voiceStates = new Map(state.voiceStates);

            if (ev.channel_id) {
              // User joined/updated in a channel — update in place to preserve order
              const channelStates = voiceStates.get(ev.channel_id) || [];
              const idx = channelStates.findIndex((s) => s.user_id === ev.user_id);
              const newState = {
                user_id: ev.user_id,
                channel_id: ev.channel_id,
                self_mute: ev.self_mute,
                self_deaf: ev.self_deaf,
              };
              if (idx >= 0) {
                const updated = [...channelStates];
                updated[idx] = newState;
                voiceStates.set(ev.channel_id, updated);
              } else {
                voiceStates.set(ev.channel_id, [...channelStates, newState]);
              }
            }

            // Remove from any other channels (user can only be in one)
            for (const [chId, states] of voiceStates) {
              if (chId !== ev.channel_id) {
                const filtered = states.filter((s) => s.user_id !== ev.user_id);
                if (filtered.length !== states.length) {
                  voiceStates.set(chId, filtered);
                }
              }
            }

            // If channel_id is null, user left voice entirely
            if (!ev.channel_id) {
              for (const [chId, states] of voiceStates) {
                const filtered = states.filter((s) => s.user_id !== ev.user_id);
                if (filtered.length !== states.length) {
                  voiceStates.set(chId, filtered);
                }
              }
            }

            return { voiceStates };
          });
          break;
        }
        case 'MESSAGE_ACK': {
          const ev = data as MessageAckEvent;
          set((state) => {
            const readStates = new Map(state.readStates);
            readStates.set(ev.channel_id, {
              channel_id: ev.channel_id,
              last_read_message_id: ev.message_id,
              mention_count: 0,
            });
            return { readStates };
          });
          break;
        }
        case 'SOUNDBOARD_SOUND_CREATE': {
          const ev = data as SoundboardSoundCreateEvent;
          set((state) => {
            const soundboardSounds = new Map(state.soundboardSounds);
            const existing = soundboardSounds.get(ev.server_id) || [];
            if (!existing.some((s) => s.id === ev.id)) {
              soundboardSounds.set(ev.server_id, [...existing, ev as SoundboardSound]);
            }
            return { soundboardSounds };
          });
          break;
        }
        case 'SOUNDBOARD_SOUND_DELETE': {
          const ev = data as SoundboardSoundDeleteEvent;
          set((state) => {
            const soundboardSounds = new Map(state.soundboardSounds);
            const existing = soundboardSounds.get(ev.server_id) || [];
            soundboardSounds.set(
              ev.server_id,
              existing.filter((s) => s.id !== ev.sound_id),
            );
            return { soundboardSounds };
          });
          break;
        }
        case 'SOUNDBOARD_PLAY': {
          const ev = data as SoundboardPlayEvent;
          window.dispatchEvent(
            new CustomEvent('drocsid-soundboard-play', { detail: ev }),
          );
          break;
        }
        case 'PRESENCE_UPDATE': {
          const ev = data as PresenceUpdateEvent;
          set((state) => {
            const myId = useAuthStore.getState().user?.id;
            // Don't let the server's broadcast overwrite our own invisible status
            if (ev.user_id === myId && ev.status === 'offline' && state.presences.get(myId) === 'invisible') {
              return state;
            }

            const currentStatus = state.presences.get(ev.user_id);
            const statusChanged = currentStatus !== ev.status;

            const existingUser = state.users.get(ev.user_id);
            const newCustomStatus = ev.custom_status ?? null;
            const customStatusChanged = existingUser && existingUser.custom_status !== newCustomStatus;

            if (!statusChanged && !customStatusChanged) return state;

            const result: Partial<ServerState> = {};

            if (statusChanged) {
              const presences = new Map(state.presences);
              presences.set(ev.user_id, ev.status);
              result.presences = presences;
            }

            if (customStatusChanged) {
              const users = new Map(state.users);
              users.set(ev.user_id, { ...existingUser!, custom_status: newCustomStatus });
              result.users = users;
            }

            // Also update the auth store user if it's us
            if (ev.user_id === myId) {
              const authUser = useAuthStore.getState().user;
              if (authUser) {
                useAuthStore.setState({ user: { ...authUser, custom_status: newCustomStatus } });
              }
            }

            return result;
          });
          break;
        }
      }
    });

    return removeHandler;
  },
}));

// Persist navigation state to localStorage
useServerStore.subscribe((state, prev) => {
  if (
    state.view !== prev.view ||
    state.activeServerId !== prev.activeServerId ||
    state.activeChannelId !== prev.activeChannelId
  ) {
    localStorage.setItem(
      'drocsid_nav',
      JSON.stringify({
        view: state.view,
        serverId: state.activeServerId,
        channelId: state.activeChannelId,
      }),
    );
  }
});
