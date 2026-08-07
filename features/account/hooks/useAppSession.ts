import { useContext } from 'react';

import { AppSessionContext } from '@/features/account/context/AppSessionContext';

export function useAppSession() {
  const context = useContext(AppSessionContext);

  if (!context) {
    throw new Error(
      'useAppSession must be used within an AppSessionProvider.'
    );
  }

  return context;
}