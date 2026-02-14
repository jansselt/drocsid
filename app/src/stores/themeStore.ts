import { create } from 'zustand';

export type ThemeName = 'dark' | 'light' | 'midnight' | 'forest' | 'rose';

interface ThemeColors {
  '--bg-darkest': string;
  '--bg-base': string;
  '--bg-primary': string;
  '--bg-secondary': string;
  '--bg-tertiary': string;
  '--bg-hover': string;
  '--bg-active': string;
  '--text-primary': string;
  '--text-secondary': string;
  '--text-muted': string;
  '--border': string;
  '--accent': string;
  '--accent-hover': string;
  '--danger': string;
}

const themes: Record<ThemeName, ThemeColors> = {
  dark: {
    '--bg-darkest': '#111214',
    '--bg-base': '#1a1b1e',
    '--bg-primary': '#1e1f23',
    '--bg-secondary': '#27282d',
    '--bg-tertiary': '#2f3136',
    '--bg-hover': 'rgba(255, 255, 255, 0.04)',
    '--bg-active': 'rgba(255, 255, 255, 0.08)',
    '--text-primary': '#e4e4e7',
    '--text-secondary': '#a1a1aa',
    '--text-muted': '#71717a',
    '--border': '#3f3f46',
    '--accent': '#6366f1',
    '--accent-hover': '#818cf8',
    '--danger': '#ef4444',
  },
  light: {
    '--bg-darkest': '#e5e7eb',
    '--bg-base': '#f3f4f6',
    '--bg-primary': '#ffffff',
    '--bg-secondary': '#f9fafb',
    '--bg-tertiary': '#e5e7eb',
    '--bg-hover': 'rgba(0, 0, 0, 0.04)',
    '--bg-active': 'rgba(0, 0, 0, 0.08)',
    '--text-primary': '#111827',
    '--text-secondary': '#4b5563',
    '--text-muted': '#9ca3af',
    '--border': '#d1d5db',
    '--accent': '#4f46e5',
    '--accent-hover': '#6366f1',
    '--danger': '#dc2626',
  },
  midnight: {
    '--bg-darkest': '#0c0a1d',
    '--bg-base': '#110f2a',
    '--bg-primary': '#161436',
    '--bg-secondary': '#1e1b47',
    '--bg-tertiary': '#262354',
    '--bg-hover': 'rgba(255, 255, 255, 0.04)',
    '--bg-active': 'rgba(255, 255, 255, 0.08)',
    '--text-primary': '#e0def4',
    '--text-secondary': '#908caa',
    '--text-muted': '#6e6a86',
    '--border': '#312e5a',
    '--accent': '#7c3aed',
    '--accent-hover': '#8b5cf6',
    '--danger': '#f43f5e',
  },
  forest: {
    '--bg-darkest': '#0a1410',
    '--bg-base': '#0f1f17',
    '--bg-primary': '#14291f',
    '--bg-secondary': '#1a3328',
    '--bg-tertiary': '#1f3d30',
    '--bg-hover': 'rgba(255, 255, 255, 0.04)',
    '--bg-active': 'rgba(255, 255, 255, 0.08)',
    '--text-primary': '#d4e7dc',
    '--text-secondary': '#8bb49b',
    '--text-muted': '#5e8a6e',
    '--border': '#2a5a3e',
    '--accent': '#10b981',
    '--accent-hover': '#34d399',
    '--danger': '#ef4444',
  },
  rose: {
    '--bg-darkest': '#1a0a14',
    '--bg-base': '#220f1b',
    '--bg-primary': '#2b1422',
    '--bg-secondary': '#35192b',
    '--bg-tertiary': '#3f1e34',
    '--bg-hover': 'rgba(255, 255, 255, 0.04)',
    '--bg-active': 'rgba(255, 255, 255, 0.08)',
    '--text-primary': '#f0dde6',
    '--text-secondary': '#c48da5',
    '--text-muted': '#8b5570',
    '--border': '#5a2942',
    '--accent': '#ec4899',
    '--accent-hover': '#f472b6',
    '--danger': '#ef4444',
  },
};

export function applyThemeToDOM(name: ThemeName) {
  const colors = themes[name];
  if (!colors) return;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(colors)) {
    root.style.setProperty(prop, value);
  }
}

interface ThemeState {
  theme: ThemeName;
  setTheme: (name: ThemeName) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'dark',
  setTheme: (name) => {
    applyThemeToDOM(name);
    set({ theme: name });
  },
}));

export const themeNames: ThemeName[] = ['dark', 'light', 'midnight', 'forest', 'rose'];

export const themeLabels: Record<ThemeName, string> = {
  dark: 'Dark',
  light: 'Light',
  midnight: 'Midnight',
  forest: 'Forest',
  rose: 'Ros\u00e9',
};
