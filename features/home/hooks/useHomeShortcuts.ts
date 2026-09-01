import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/utils/supabase';

export type HomeShortcutId =
  | 'trade_offers'
  | 'live_matches'
  | 'waivers'
  | 'transaction_history'
  | 'watchlist'
  | 'scout_players'
  | 'league_table'
  | 'my_squad'
  | 'league_lounge';

export const DEFAULT_HOME_SHORTCUTS: HomeShortcutId[] = [
  'trade_offers',
  'live_matches',
  'waivers',
  'transaction_history',
];

const isShortcutId = (value: unknown): value is HomeShortcutId =>
  typeof value === 'string' && [
    'trade_offers',
    'live_matches',
    'waivers',
    'transaction_history',
    'watchlist',
    'scout_players',
    'league_table',
    'my_squad',
    'league_lounge',
  ].includes(value);

const normalizeShortcuts = (value: unknown): HomeShortcutId[] => {
  if (!Array.isArray(value)) return DEFAULT_HOME_SHORTCUTS;
  const unique = value.filter(isShortcutId).filter((item, index, items) => items.indexOf(item) === index);
  return unique.length === 4 ? unique : DEFAULT_HOME_SHORTCUTS;
};

export function useHomeShortcuts(currentUserId: string | null) {
  const [shortcutIds, setShortcutIds] = useState<HomeShortcutId[]>(DEFAULT_HOME_SHORTCUTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!currentUserId) {
      setShortcutIds(DEFAULT_HOME_SHORTCUTS);
      return () => { active = false; };
    }

    void supabase
      .from('home_shortcut_preferences')
      .select('shortcut_ids')
      .eq('user_id', currentUserId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || error) return;
        setShortcutIds(normalizeShortcuts(data?.shortcut_ids));
      });

    return () => { active = false; };
  }, [currentUserId]);

  const saveShortcuts = useCallback(async (nextIds: HomeShortcutId[]) => {
    if (!currentUserId) return false;
    const normalized = normalizeShortcuts(nextIds);
    setSaving(true);
    try {
      const { error } = await supabase.from('home_shortcut_preferences').upsert({
        user_id: currentUserId,
        shortcut_ids: normalized,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;
      setShortcutIds(normalized);
      return true;
    } catch (error) {
      console.error('[HOME SHORTCUTS] Unable to save preferences:', error);
      return false;
    } finally {
      setSaving(false);
    }
  }, [currentUserId]);

  return { shortcutIds, saveShortcuts, saving };
}
