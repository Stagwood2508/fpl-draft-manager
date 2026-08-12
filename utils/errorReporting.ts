import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/utils/supabase';

type ErrorContext = {
  errorType?: string;
  route?: string | null;
  metadata?: Record<string, unknown>;
};

const normalizeError = (value: unknown) => {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack ?? null };
  }

  if (typeof value === 'string') {
    return { message: value, stack: null };
  }

  try {
    return { message: JSON.stringify(value), stack: null };
  } catch {
    return { message: 'Unknown application error', stack: null };
  }
};

export async function reportAppError(
  error: unknown,
  context: ErrorContext = {}
): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;

    const leagueId = await AsyncStorage.getItem('active_league_id');
    const normalized = normalizeError(error);

    await supabase.from('app_error_reports').insert({
      user_id: data.user.id,
      league_id: leagueId,
      error_type: context.errorType ?? 'UNHANDLED',
      message: normalized.message.slice(0, 2000),
      stack: normalized.stack?.slice(0, 12000) ?? null,
      route: context.route?.slice(0, 500) ?? null,
      platform: Platform.OS,
      app_version: Constants.expoConfig?.version ?? 'unknown',
      metadata: context.metadata ?? {},
    });
  } catch {
    // Reporting must never trigger another user-facing failure.
  }
}

export function installGlobalErrorReporting(
  getRoute: () => string | null
): () => void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const handleError = (event: ErrorEvent) => {
      void reportAppError(event.error ?? event.message, {
        errorType: 'WINDOW_ERROR',
        route: getRoute(),
      });
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      void reportAppError(event.reason, {
        errorType: 'UNHANDLED_PROMISE',
        route: getRoute(),
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }

  const nativeErrorUtils = (globalThis as typeof globalThis & {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
      setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
    };
  }).ErrorUtils;

  if (!nativeErrorUtils?.setGlobalHandler) return () => undefined;

  const previousHandler = nativeErrorUtils.getGlobalHandler?.();
  nativeErrorUtils.setGlobalHandler((error, isFatal) => {
    void reportAppError(error, {
      errorType: isFatal ? 'NATIVE_FATAL' : 'NATIVE_ERROR',
      route: getRoute(),
    });
    previousHandler?.(error, isFatal);
  });

  return () => {
    if (previousHandler) nativeErrorUtils.setGlobalHandler?.(previousHandler);
  };
}
