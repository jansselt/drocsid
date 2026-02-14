import { create } from 'zustand';
import type { User } from '../types';
import * as api from '../api/client';
import { gateway } from '../api/gateway';
import { useThemeStore, type ThemeName } from './themeStore';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
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
      if (user.theme_preference) {
        useThemeStore.getState().setTheme(user.theme_preference as ThemeName);
      }
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
    if (response.user.theme_preference) {
      useThemeStore.getState().setTheme(response.user.theme_preference as ThemeName);
    }
    set({ user: response.user, isAuthenticated: true });
    gateway.connect();
  },

  register: async (username, email, password) => {
    const response = await api.register(username, email, password);
    api.setTokens(response.access_token, response.refresh_token);
    if (response.user.theme_preference) {
      useThemeStore.getState().setTheme(response.user.theme_preference as ThemeName);
    }
    set({ user: response.user, isAuthenticated: true });
    gateway.connect();
  },

  logout: () => {
    api.clearTokens();
    gateway.disconnect();
    set({ user: null, isAuthenticated: false });
  },
}));
