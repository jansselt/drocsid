import { create } from 'zustand';

export type ThemeName = 'dark' | 'light' | 'midnight' | 'forest' | 'rose'
  | 'solarized-dark' | 'solarized-light' | 'dracula' | 'monokai'
  | 'gruvbox' | 'nord' | 'catppuccin' | 'tokyo-night' | 'terminal';

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
  '--font-body'?: string;
  '--text-glow'?: string;
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
  'solarized-dark': {
    '--bg-darkest': '#001e26',
    '--bg-base': '#002b36',
    '--bg-primary': '#073642',
    '--bg-secondary': '#0a4050',
    '--bg-tertiary': '#0d4d60',
    '--bg-hover': 'rgba(147, 161, 161, 0.08)',
    '--bg-active': 'rgba(147, 161, 161, 0.12)',
    '--text-primary': '#93a1a1',
    '--text-secondary': '#839496',
    '--text-muted': '#586e75',
    '--border': '#0d4a5a',
    '--accent': '#268bd2',
    '--accent-hover': '#2aa198',
    '--danger': '#dc322f',
  },
  'solarized-light': {
    '--bg-darkest': '#d6cdb5',
    '--bg-base': '#eee8d5',
    '--bg-primary': '#fdf6e3',
    '--bg-secondary': '#f5eed8',
    '--bg-tertiary': '#eee8d5',
    '--bg-hover': 'rgba(88, 110, 117, 0.06)',
    '--bg-active': 'rgba(88, 110, 117, 0.10)',
    '--text-primary': '#073642',
    '--text-secondary': '#586e75',
    '--text-muted': '#93a1a1',
    '--border': '#d3cbb6',
    '--accent': '#268bd2',
    '--accent-hover': '#2aa198',
    '--danger': '#dc322f',
  },
  dracula: {
    '--bg-darkest': '#1e1f29',
    '--bg-base': '#282a36',
    '--bg-primary': '#2d2f3d',
    '--bg-secondary': '#343746',
    '--bg-tertiary': '#44475a',
    '--bg-hover': 'rgba(248, 248, 242, 0.04)',
    '--bg-active': 'rgba(248, 248, 242, 0.08)',
    '--text-primary': '#f8f8f2',
    '--text-secondary': '#bfbfcf',
    '--text-muted': '#6272a4',
    '--border': '#44475a',
    '--accent': '#bd93f9',
    '--accent-hover': '#ff79c6',
    '--danger': '#ff5555',
  },
  monokai: {
    '--bg-darkest': '#1a1b16',
    '--bg-base': '#272822',
    '--bg-primary': '#2d2e27',
    '--bg-secondary': '#3e3d32',
    '--bg-tertiary': '#49483e',
    '--bg-hover': 'rgba(248, 248, 242, 0.04)',
    '--bg-active': 'rgba(248, 248, 242, 0.08)',
    '--text-primary': '#f8f8f2',
    '--text-secondary': '#c0bfad',
    '--text-muted': '#75715e',
    '--border': '#49483e',
    '--accent': '#a6e22e',
    '--accent-hover': '#66d9ef',
    '--danger': '#f92672',
  },
  gruvbox: {
    '--bg-darkest': '#1d2021',
    '--bg-base': '#282828',
    '--bg-primary': '#2e2e2a',
    '--bg-secondary': '#3c3836',
    '--bg-tertiary': '#504945',
    '--bg-hover': 'rgba(235, 219, 178, 0.04)',
    '--bg-active': 'rgba(235, 219, 178, 0.08)',
    '--text-primary': '#ebdbb2',
    '--text-secondary': '#bdae93',
    '--text-muted': '#928374',
    '--border': '#504945',
    '--accent': '#fabd2f',
    '--accent-hover': '#fe8019',
    '--danger': '#fb4934',
  },
  nord: {
    '--bg-darkest': '#242933',
    '--bg-base': '#2e3440',
    '--bg-primary': '#3b4252',
    '--bg-secondary': '#434c5e',
    '--bg-tertiary': '#4c566a',
    '--bg-hover': 'rgba(216, 222, 233, 0.04)',
    '--bg-active': 'rgba(216, 222, 233, 0.08)',
    '--text-primary': '#d8dee9',
    '--text-secondary': '#a5b1c2',
    '--text-muted': '#616e88',
    '--border': '#4c566a',
    '--accent': '#88c0d0',
    '--accent-hover': '#8fbcbb',
    '--danger': '#bf616a',
  },
  catppuccin: {
    '--bg-darkest': '#11111b',
    '--bg-base': '#181825',
    '--bg-primary': '#1e1e2e',
    '--bg-secondary': '#313244',
    '--bg-tertiary': '#45475a',
    '--bg-hover': 'rgba(205, 214, 244, 0.04)',
    '--bg-active': 'rgba(205, 214, 244, 0.08)',
    '--text-primary': '#cdd6f4',
    '--text-secondary': '#bac2de',
    '--text-muted': '#6c7086',
    '--border': '#45475a',
    '--accent': '#cba6f7',
    '--accent-hover': '#b4befe',
    '--danger': '#f38ba8',
  },
  'tokyo-night': {
    '--bg-darkest': '#16161e',
    '--bg-base': '#1a1b26',
    '--bg-primary': '#1f2335',
    '--bg-secondary': '#24283b',
    '--bg-tertiary': '#292e42',
    '--bg-hover': 'rgba(192, 202, 245, 0.04)',
    '--bg-active': 'rgba(192, 202, 245, 0.08)',
    '--text-primary': '#c0caf5',
    '--text-secondary': '#a9b1d6',
    '--text-muted': '#565f89',
    '--border': '#292e42',
    '--accent': '#7aa2f7',
    '--accent-hover': '#bb9af7',
    '--danger': '#f7768e',
  },
  terminal: {
    '--bg-darkest': '#000000',
    '--bg-base': '#010201',
    '--bg-primary': '#030303',
    '--bg-secondary': '#080808',
    '--bg-tertiary': '#0f0f0f',
    '--bg-hover': 'rgba(0, 255, 65, 0.06)',
    '--bg-active': 'rgba(0, 255, 65, 0.10)',
    '--text-primary': '#00ff41',
    '--text-secondary': '#00cc33',
    '--text-muted': '#005518',
    '--border': '#0a1f0a',
    '--accent': '#00ff41',
    '--accent-hover': '#50ff8a',
    '--danger': '#ff1744',
    '--font-body': '"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", monospace',
    '--text-glow': '0 0 8px rgba(0, 255, 65, 0.4)',
  },
};

const extendedProps = ['--font-body', '--text-glow'] as const;

export function applyThemeToDOM(name: ThemeName) {
  const colors = themes[name];
  if (!colors) return;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(colors)) {
    root.style.setProperty(prop, value);
  }
  // Clear extended properties not set by this theme
  for (const prop of extendedProps) {
    if (!(prop in colors)) {
      root.style.removeProperty(prop);
    }
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

export const themeNames: ThemeName[] = [
  'dark', 'light', 'midnight', 'forest', 'rose',
  'solarized-dark', 'solarized-light', 'dracula', 'monokai',
  'gruvbox', 'nord', 'catppuccin', 'tokyo-night', 'terminal',
];

export const themeLabels: Record<ThemeName, string> = {
  dark: 'Dark',
  light: 'Light',
  midnight: 'Midnight',
  forest: 'Forest',
  rose: 'Ros\u00e9',
  'solarized-dark': 'Solarized Dark',
  'solarized-light': 'Solarized Light',
  dracula: 'Dracula',
  monokai: 'Monokai',
  gruvbox: 'Gruvbox',
  nord: 'Nord',
  catppuccin: 'Catppuccin',
  'tokyo-night': 'Tokyo Night',
  terminal: 'Terminal',
};
