import { supabase } from './supabase';

/**
 * Starts the protected server-side FPL import. The Edge Function verifies that
 * the caller is the app owner before using its service-role client to write
 * official player, fixture, and match-stat data.
 */
export async function synchronizeFplPlayerPool(): Promise<{
  success: boolean;
  count: number;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke('sync-fpl-player-pool');

  if (error) {
    return { success: false, count: 0, error: error.message };
  }

  if (!data?.success) {
    return { success: false, count: 0, error: data?.error || 'The FPL sync did not complete.' };
  }

  return { success: true, count: Number(data.count) || 0 };
}
