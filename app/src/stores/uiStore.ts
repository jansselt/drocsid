import { create } from 'zustand';
import type { Message } from '../types';

interface UiStoreState {
  showChannelSidebar: boolean;
  showMemberSidebar: boolean;
  replyingTo: Message | null;

  toggleChannelSidebar: () => void;
  toggleMemberSidebar: () => void;
  setShowChannelSidebar: (show: boolean) => void;
  setReplyingTo: (msg: Message | null) => void;
}

export const useUiStore = create<UiStoreState>((set) => ({
  showChannelSidebar: JSON.parse(localStorage.getItem('drocsid_show_channel_sidebar') ?? 'true'),
  showMemberSidebar: JSON.parse(localStorage.getItem('drocsid_show_member_sidebar') ?? 'true'),
  replyingTo: null,

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

  setShowChannelSidebar: (show) => set({ showChannelSidebar: show }),

  setReplyingTo: (msg) => set({ replyingTo: msg }),
}));
