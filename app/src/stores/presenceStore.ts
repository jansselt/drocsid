import { create } from 'zustand';
import * as api from '../api/client';
import { gateway } from '../api/gateway';
import { useAuthStore } from './authStore';

interface TypingUser {
  userId: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface PresenceStoreState {
  presences: Map<string, string>; // user_id -> status (online/idle/dnd/offline)
  typingUsers: Map<string, TypingUser[]>; // channel_id -> typing users

  sendTyping: (channelId: string) => void;
  updateMyStatus: (status: string) => Promise<void>;

  // Internal setters used by gateway handlers and loadMembers
  setPresence: (userId: string, status: string) => void;
  setPresences: (entries: Array<{ userId: string; status: string }>) => void;
  handleTypingStart: (channelId: string, userId: string) => void;
}

const TYPING_TIMEOUT = 8000;

export const usePresenceStore = create<PresenceStoreState>((set, get) => ({
  presences: new Map(),
  typingUsers: new Map(),

  sendTyping: (channelId) => {
    api.sendTyping(channelId).catch(() => {});
  },

  updateMyStatus: async (status) => {
    try {
      await api.updateMe({ status });
      gateway.sendPresenceUpdate(status);
      // Set own presence locally so the UI reflects the chosen status immediately
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

  setPresence: (userId, status) => {
    set((state) => {
      const presences = new Map(state.presences);
      presences.set(userId, status);
      return { presences };
    });
  },

  setPresences: (entries) => {
    set((state) => {
      const presences = new Map(state.presences);
      for (const { userId, status } of entries) {
        presences.set(userId, status);
      }
      return { presences };
    });
  },

  handleTypingStart: (channelId, userId) => {
    set((state) => {
      const typingUsers = new Map(state.typingUsers);
      const channelTyping = (typingUsers.get(channelId) || []).filter(
        (t) => t.userId !== userId,
      );

      const existing = (typingUsers.get(channelId) || []).find(
        (t) => t.userId === userId,
      );
      if (existing) {
        clearTimeout(existing.timeout);
      }

      const timeout = setTimeout(() => {
        set((s) => {
          const tu = new Map(s.typingUsers);
          const ct = (tu.get(channelId) || []).filter(
            (t) => t.userId !== userId,
          );
          tu.set(channelId, ct);
          return { typingUsers: tu };
        });
      }, TYPING_TIMEOUT);

      channelTyping.push({ userId, timeout });
      typingUsers.set(channelId, channelTyping);
      return { typingUsers };
    });
  },
}));
