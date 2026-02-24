import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock api and gateway before importing the store
const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockGetMe = vi.fn();
const mockLoadTokens = vi.fn(() => false);
const mockSetTokens = vi.fn();
const mockClearTokens = vi.fn();

vi.mock('../../api/client', () => ({
  login: (...args: unknown[]) => mockLogin(...args),
  register: (...args: unknown[]) => mockRegister(...args),
  getMe: (...args: unknown[]) => mockGetMe(...args),
  loadTokens: () => mockLoadTokens(),
  setTokens: (...args: unknown[]) => mockSetTokens(...args),
  clearTokens: () => mockClearTokens(),
}));

vi.mock('../../api/gateway', () => ({
  gateway: {
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

import { useAuthStore } from '../authStore';
import { gateway } from '../../api/gateway';

describe('Auth Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    });
  });

  describe('initial state', () => {
    it('should start unauthenticated', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('login', () => {
    it('should authenticate user and connect gateway on successful login', async () => {
      const mockUser = { id: 'u1', username: 'testuser', email: 'test@example.com' };
      mockLogin.mockResolvedValue({
        access_token: 'at-123',
        refresh_token: 'rt-456',
        user: mockUser,
      });

      await useAuthStore.getState().login('test@example.com', 'password123');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.username).toBe('testuser');
      expect(mockSetTokens).toHaveBeenCalledWith('at-123', 'rt-456');
      expect(gateway.connect).toHaveBeenCalled();
    });

    it('should propagate login errors (bad credentials)', async () => {
      mockLogin.mockRejectedValue(new Error('Unauthorized'));

      await expect(
        useAuthStore.getState().login('bad@email.com', 'wrong'),
      ).rejects.toThrow();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('logout', () => {
    it('should clear auth state and disconnect gateway', () => {
      // Set up authenticated state
      useAuthStore.setState({
        user: { id: 'u1', username: 'test' } as never,
        isAuthenticated: true,
      });

      useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(mockClearTokens).toHaveBeenCalled();
      expect(gateway.disconnect).toHaveBeenCalled();
    });
  });

  describe('init', () => {
    it('should restore session from saved tokens', async () => {
      mockLoadTokens.mockReturnValue(true);
      mockGetMe.mockResolvedValue({
        id: 'u1',
        username: 'testuser',
        email: 'test@example.com',
      });

      await useAuthStore.getState().init();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(gateway.connect).toHaveBeenCalled();
    });

    it('should clear invalid tokens and finish loading', async () => {
      mockLoadTokens.mockReturnValue(true);
      mockGetMe.mockRejectedValue(new Error('Unauthorized'));

      await useAuthStore.getState().init();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(mockClearTokens).toHaveBeenCalled();
    });

    it('should finish loading immediately when no tokens saved', async () => {
      mockLoadTokens.mockReturnValue(false);

      await useAuthStore.getState().init();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });
  });
});
