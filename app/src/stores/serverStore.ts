import { create } from 'zustand';
import type {
  Server,
  Channel,
  Message,
  MessageCreateEvent,
  MessageUpdateEvent,
  MessageDeleteEvent,
  ReactionAddEvent,
  ReactionRemoveEvent,
  MessagePinEvent,
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
} from '../types';
import * as api from '../api/client';
import { gateway } from '../api/gateway';
import { useAuthStore } from './authStore';
import {
  playMessageSound,
  playMentionSound,
  playVoiceJoinSound,
  playVoiceLeaveSound,
} from '../utils/notificationSounds';

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

  // Voice
  voiceChannelId: string | null; // channel we're connected to
  voiceToken: string | null;
  voiceUrl: string | null;
  voiceSelfMute: boolean;
  voiceSelfDeaf: boolean;
  voiceStates: Map<string, VoiceState[]>; // channel_id -> voice states
  speakingUsers: Set<string>; // user_ids currently speaking (from LiveKit)

  // Actions
  setView: (view: ViewMode) => void;
  setServers: (servers: Server[]) => void;
  setActiveServer: (serverId: string) => void;
  setActiveChannel: (channelId: string) => void;
  loadChannels: (serverId: string) => Promise<void>;
  loadMessages: (channelId: string) => Promise<void>;
  loadMoreMessages: (channelId: string) => Promise<boolean>;
  sendMessage: (channelId: string, content: string) => Promise<void>;
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
  closeDm: (channelId: string) => Promise<void>;
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

  restoreNavigation: () => void;

  initGatewayHandlers: () => () => void;
}

const TYPING_TIMEOUT = 8000;

export const useServerStore = create<ServerState>((set, get) => ({
  view: 'servers',
  servers: [],
  channels: new Map(),
  roles: new Map(),
  activeServerId: null,
  activeChannelId: null,
  messages: new Map(),
  reactions: new Map(),
  users: new Map(),
  voiceChannelId: null,
  voiceToken: null,
  voiceUrl: null,
  voiceSelfMute: false,
  voiceSelfDeaf: false,
  voiceStates: new Map(),
  speakingUsers: new Set(),
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
    set({ activeServerId: serverId, activeChannelId: null, activeThreadId: null, view: 'servers' });
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
    set({ activeChannelId: channelId, activeThreadId: null });
    const { messages, loadMessages } = get();
    if (!messages.has(channelId)) {
      loadMessages(channelId);
    }
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
      return { messages, reactions };
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

  sendMessage: async (channelId, content) => {
    await api.sendMessage(channelId, content);
  },

  addMessage: (message) => {
    if (message.author) {
      set((state) => {
        const users = new Map(state.users);
        users.set(message.author!.id, message.author!);
        return { users };
      });
    }

    // Notification sounds — only for messages from other users
    const currentUser = useAuthStore.getState().user;
    if (currentUser && message.author_id !== currentUser.id) {
      const state = get();
      const isDm = state.dmChannels.some((c) => c.id === message.channel_id);
      const content = message.content ?? '';
      const isMention =
        content.includes(`@${currentUser.username}`) ||
        content.includes(`<@${currentUser.id}>`);

      if (isMention) {
        playMentionSound();
      } else if (isDm) {
        playMessageSound();
      }
    }

    set((state) => {
      const messages = new Map(state.messages);
      const channelMessages = messages.get(message.channel_id) || [];
      if (channelMessages.some((m) => m.id === message.id)) return state;
      messages.set(message.channel_id, [...channelMessages, message]);
      return { messages };
    });
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
    await api.pinMessage(channelId, messageId);
  },

  unpinMessage: async (channelId, messageId) => {
    await api.unpinMessage(channelId, messageId);
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

  setActiveDmChannel: (channelId) => {
    set({ activeChannelId: channelId, activeServerId: null, activeThreadId: null, view: 'home' });
    const { messages, loadMessages } = get();
    if (!messages.has(channelId)) {
      loadMessages(channelId);
    }
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

    // Load current voice states for this channel
    get().loadVoiceStates(channelId);
  },

  voiceLeave: async () => {
    const channelId = get().voiceChannelId;
    if (channelId) {
      await api.voiceLeave(channelId).catch(() => {});
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
              // User joined/updated in a channel
              const channelStates = (voiceStates.get(ev.channel_id) || []).filter(
                (s) => s.user_id !== ev.user_id,
              );
              channelStates.push({
                user_id: ev.user_id,
                channel_id: ev.channel_id,
                self_mute: ev.self_mute,
                self_deaf: ev.self_deaf,
              });
              voiceStates.set(ev.channel_id, channelStates);
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
        case 'PRESENCE_UPDATE': {
          const ev = data as PresenceUpdateEvent;
          set((state) => {
            const presences = new Map(state.presences);
            // Don't let the server's broadcast overwrite our own invisible status
            const myId = useAuthStore.getState().user?.id;
            if (ev.user_id === myId && ev.status === 'offline' && presences.get(myId) === 'invisible') {
              return state;
            }
            presences.set(ev.user_id, ev.status);
            return { presences };
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
