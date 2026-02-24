import { create } from 'zustand';
import type { User } from '../types';
import * as api from '../api/client';
import { gateway } from '../api/gateway';
import { useThemeStore, applyThemeToDOM } from './themeStore';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, inviteCode?: string) => Promise<void>;
  logout: () => void;
}

async function applyUserTheme(themePref: string | undefined) {
  if (!themePref) return;
  if (themePref.startsWith('custom:')) {
    try {
      const customThemes = await api.getCustomThemes();
      useThemeStore.getState().setCustomThemes(customThemes);
      applyThemeToDOM(themePref, customThemes);
      useThemeStore.setState({ theme: themePref });
    } catch {
      // Fall back to dark if custom themes can't be loaded
      useThemeStore.getState().setTheme('dark');
    }
  } else {
    useThemeStore.getState().setTheme(themePref);
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  init: async () => {
    const hasTokens = api.loadTokens();
    if (!hasTokens) {
      set({ isLoading: false });
      return;
    }

    try {
      const user = await api.getMe();
      await applyUserTheme(user.theme_preference);
      set({ user, isAuthenticated: true, isLoading: false });
      gateway.connect();
    } catch {
      api.clearTokens();
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    const response = await api.login(email, password);
    api.setTokens(response.access_token, response.refresh_token);
    await applyUserTheme(response.user.theme_preference);
    set({ user: response.user, isAuthenticated: true });
    gateway.connect();
  },

  register: async (username, email, password, inviteCode) => {
    const response = await api.register(username, email, password, inviteCode);
    api.setTokens(response.access_token, response.refresh_token);
    await applyUserTheme(response.user.theme_preference);
    set({ user: response.user, isAuthenticated: true });
    gateway.connect();
  },

  logout: () => {
    api.clearTokens();
    gateway.disconnect();
    localStorage.removeItem('drocsid_nav');
    set({ user: null, isAuthenticated: false });
  },
}));
