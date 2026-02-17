import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, themeNames, themeLabels, applyThemeToDOM } from '../themeStore';

describe('Theme Store', () => {
  beforeEach(() => {
    // Reset store to default state
    useThemeStore.setState({ theme: 'dark' });
  });

  it('should default to dark theme', () => {
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('should switch themes', () => {
    useThemeStore.getState().setTheme('nord');
    expect(useThemeStore.getState().theme).toBe('nord');
  });

  it('should have a label for every theme', () => {
    for (const name of themeNames) {
      expect(themeLabels[name]).toBeDefined();
      expect(themeLabels[name].length).toBeGreaterThan(0);
    }
  });

  it('should apply CSS variables to DOM when theme changes', () => {
    applyThemeToDOM('dracula');
    const root = document.documentElement;
    // Every theme must set all core CSS variables
    expect(root.style.getPropertyValue('--bg-base')).toBeTruthy();
    expect(root.style.getPropertyValue('--text-primary')).toBeTruthy();
    expect(root.style.getPropertyValue('--accent')).toBeTruthy();
    expect(root.style.getPropertyValue('--danger')).toBeTruthy();
  });

  it('should set extended properties for terminal theme and clear them on switch', () => {
    const root = document.documentElement;
    applyThemeToDOM('terminal');
    expect(root.style.getPropertyValue('--font-body')).toBeTruthy();
    expect(root.style.getPropertyValue('--text-glow')).toBeTruthy();

    applyThemeToDOM('dark');
    expect(root.style.getPropertyValue('--font-body')).toBeFalsy();
    expect(root.style.getPropertyValue('--text-glow')).toBeFalsy();
  });

  it('every theme should set all required CSS variables', () => {
    const requiredVars = [
      '--bg-darkest', '--bg-base', '--bg-primary', '--bg-secondary',
      '--bg-tertiary', '--bg-hover', '--bg-active',
      '--text-primary', '--text-secondary', '--text-muted',
      '--border', '--accent', '--accent-hover', '--danger',
    ];

    for (const name of themeNames) {
      applyThemeToDOM(name);
      const root = document.documentElement;
      for (const cssVar of requiredVars) {
        const value = root.style.getPropertyValue(cssVar);
        expect(value, `${name} missing ${cssVar}`).toBeTruthy();
      }
    }
  });
});
