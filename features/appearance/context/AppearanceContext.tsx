import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform, useColorScheme } from 'react-native';

import {
  AppColors,
  darkAppColors,
  lightAppColors,
} from '@/constants/theme';

export type AppearancePreference = 'dark' | 'light' | 'system';

interface AppearanceContextValue {
  colors: AppColors;
  preference: AppearancePreference;
  resolvedMode: 'dark' | 'light';
  appearanceReady: boolean;
  setPreference: (preference: AppearancePreference) => Promise<void>;
  toggleMode: () => Promise<void>;
}

const STORAGE_KEY = 'app_appearance_preference';

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<AppearancePreference>('dark');
  const [appearanceReady, setAppearanceReady] = useState(false);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then(value => {
        if (!active) return;
        if (value === 'dark' || value === 'light' || value === 'system') {
          setPreferenceState(value);
        }
      })
      .catch(error => {
        console.warn('[APPEARANCE] Unable to load preference:', error);
      })
      .finally(() => {
        if (active) setAppearanceReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const resolvedMode: 'dark' | 'light' = preference === 'system'
    ? (systemScheme === 'light' ? 'light' : 'dark')
    : preference;
  const colors = resolvedMode === 'light' ? lightAppColors : darkAppColors;

  const setPreference = useCallback(async (nextPreference: AppearancePreference) => {
    setPreferenceState(nextPreference);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, nextPreference);
    } catch (error) {
      console.warn('[APPEARANCE] Unable to save preference:', error);
    }
  }, []);

  const toggleMode = useCallback(async () => {
    await setPreference(resolvedMode === 'dark' ? 'light' : 'dark');
  }, [resolvedMode, setPreference]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.style.colorScheme = resolvedMode;
    document.body.style.backgroundColor = colors.background;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    themeMeta?.setAttribute('content', colors.backgroundDeep);
  }, [colors, resolvedMode]);

  const value = useMemo<AppearanceContextValue>(() => ({
    colors,
    preference,
    resolvedMode,
    appearanceReady,
    setPreference,
    toggleMode,
  }), [appearanceReady, colors, preference, resolvedMode, setPreference, toggleMode]);

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export { AppearanceContext };
