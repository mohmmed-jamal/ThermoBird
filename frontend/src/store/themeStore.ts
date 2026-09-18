import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  apply: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',

      toggle: () => {
        const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
        set({ theme: next });
        applyThemeClass(next);
      },

      apply: () => {
        applyThemeClass(get().theme);
      },
    }),
    {
      name: 'thermobird-theme',
      onRehydrateStorage: () => (state) => {
        // As soon as the store rehydrates from localStorage,
        // immediately apply the saved class — prevents flash of wrong theme.
        if (state) applyThemeClass(state.theme);
      },
    }
  )
);

function applyThemeClass(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.add('light');
    root.classList.remove('dark');
  }
}
