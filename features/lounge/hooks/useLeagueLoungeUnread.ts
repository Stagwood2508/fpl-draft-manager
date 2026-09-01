import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/utils/supabase';

export function useLeagueLoungeUnread(leagueId: string | null, currentUserId: string | null) {
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!leagueId || !currentUserId) {
      setUnreadCount(0);
      return;
    }

    const { data: readState } = await supabase
      .from('league_lounge_reads')
      .select('last_read_at')
      .eq('league_id', leagueId)
      .eq('user_id', currentUserId)
      .maybeSingle();

    let query = supabase
      .from('league_lounge_messages')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .is('deleted_at', null)
      .neq('author_id', currentUserId);

    if (readState?.last_read_at) query = query.gt('created_at', readState.last_read_at);
    const { count, error } = await query;
    if (!error) setUnreadCount(count || 0);
  }, [currentUserId, leagueId]);

  useEffect(() => {
    void refresh();
    if (!leagueId || !currentUserId) return;

    const channel = supabase
      .channel(`lounge-unread-${leagueId}-${currentUserId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'league_lounge_messages', filter: `league_id=eq.${leagueId}`,
      }, () => void refresh())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'league_lounge_reads', filter: `user_id=eq.${currentUserId}`,
      }, () => void refresh())
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [currentUserId, leagueId, refresh]);

  return { unreadCount, refreshUnread: refresh };
}
