// Auth store removed for public mode.
// Export a minimal no-op store to preserve imports in UI components while
// ensuring no authentication actions are performed.
import { create } from 'zustand'

interface AuthState {
  user: any | null
  token: string | null
  isAuthenticated: boolean
  login: (...args: any[]) => Promise<void>
  signup: (...args: any[]) => Promise<void>
  logout: () => void
  loadUser: () => Promise<void>
}

export const useAuthStore = create<AuthState>(() => ({
  user: null,
  token: null,
  isAuthenticated: false,
  login: async () => {},
  signup: async () => {},
  logout: () => {},
  loadUser: async () => {},
}));
