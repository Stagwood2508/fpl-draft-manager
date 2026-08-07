import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/utils/supabase';

export function useNotificationSummary(currentUserId: string | null) {
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnreadCount = useCallback(async () => {
    if (!currentUserId) {
      setUnreadCount(0);
      return;
    }
    const { count, error } = await supabase
      .from('user_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', currentUserId)
      .is('read_at', null);
    if (!error) setUnreadCount(count || 0);
  }, [currentUserId]);

  useEffect(() => {
    void refreshUnreadCount();
    if (!currentUserId) return;

    const topic = `notification-summary-${currentUserId}-${Date.now()}`;
    const channel = supabase
      .channel(topic)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_notifications',
        filter: `user_id=eq.${currentUserId}`,
      }, () => void refreshUnreadCount())
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [currentUserId, refreshUnreadCount]);

  return { unreadCount, refreshUnreadCount };
}
