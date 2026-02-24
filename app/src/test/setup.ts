import '@testing-library/jest-dom/vitest';

// Mock localStorage for tests
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const key of Object.keys(store)) delete store[key]; },
  get length() { return Object.keys(store).length; },
  key: (index: number) => Object.keys(store)[index] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock Audio for notification sounds
globalThis.Audio = class MockAudio {
  src = '';
  volume = 1;
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
  addEventListener() {}
  removeEventListener() {}
} as unknown as typeof Audio;
