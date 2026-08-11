import { useContext } from 'react';

import { AppearanceContext } from '@/features/appearance/context/AppearanceContext';

export function useAppTheme() {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error('useAppTheme must be used inside AppearanceProvider.');
  }
  return context;
}
