import { create } from 'zustand';
import type { VoiceState } from '../types';
import * as api from '../api/client';
import { getApiUrl } from '../api/instance';
import {
  playVoiceJoinSound,
  playVoiceLeaveSound,
} from '../utils/notificationSounds';

interface VoiceStoreState {
  voiceChannelId: string | null;
  voiceToken: string | null;
  voiceUrl: string | null;
  voiceSelfMute: boolean;
  voiceSelfDeaf: boolean;
  voiceAudioSharing: boolean;
  voiceVideoActive: boolean;
  voiceStates: Map<string, VoiceState[]>;
  speakingUsers: Set<string>;

  voiceJoin: (channelId: string) => Promise<void>;
  voiceLeave: () => Promise<void>;
  voiceToggleMute: () => Promise<void>;
  voiceToggleDeaf: () => Promise<void>;
  voiceSetAudioSharing: (sharing: boolean) => Promise<void>;
  voiceSetVideoActive: (active: boolean) => void;
  loadVoiceStates: (channelId: string) => Promise<void>;
  setSpeakingUsers: (userIds: Set<string>) => void;
}

// Track the beforeunload handler for voice cleanup on tab close
let voiceBeforeUnloadHandler: (() => void) | null = null;
function removeVoiceBeforeUnload() {
  if (voiceBeforeUnloadHandler) {
    window.removeEventListener('beforeunload', voiceBeforeUnloadHandler);
    voiceBeforeUnloadHandler = null;
  }
}

export const useVoiceStore = create<VoiceStoreState>((set, get) => ({
  voiceChannelId: null,
  voiceToken: null,
  voiceUrl: null,
  voiceSelfMute: false,
  voiceSelfDeaf: false,
  voiceAudioSharing: false,
  voiceVideoActive: false,
  voiceStates: new Map(),
  speakingUsers: new Set(),

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
      // Retry the leave API call to avoid ghost users in voice
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await api.voiceLeave(channelId);
          break;
        } catch {
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
        }
      }
      playVoiceLeaveSound();
    }
    set({
      voiceChannelId: null,
      voiceToken: null,
      voiceUrl: null,
      voiceSelfMute: false,
      voiceSelfDeaf: false,
      voiceAudioSharing: false,
      voiceVideoActive: false,
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

  voiceSetAudioSharing: async (sharing) => {
    const channelId = get().voiceChannelId;
    if (!channelId) return;
    set({ voiceAudioSharing: sharing });
    await api.voiceUpdateState(channelId, undefined, undefined, sharing).catch(() => {});
  },

  voiceSetVideoActive: (active) => set({ voiceVideoActive: active }),

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
}));
