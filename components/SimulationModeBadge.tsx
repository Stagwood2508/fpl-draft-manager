import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';

import { AppColors, appRadius, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

export default function SimulationModeBadge() {
  const router = useRouter();
  const { activeLeagueId } = useAppSession();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [active, setActive] = useState(false);
  const [commissioner, setCommissioner] = useState(false);

  const check = useCallback(async () => {
    if (!activeLeagueId) {
      setActive(false);
      return;
    }
    const { data, error } = await supabase.rpc('get_gameweek_simulation_status', { p_league_id: activeLeagueId });
    if (!error) {
      setActive(Boolean((data as any)?.active_run));
      setCommissioner(Boolean((data as any)?.is_commissioner));
    }
  }, [activeLeagueId]);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), 30000);
    return () => clearInterval(timer);
  }, [check]);

  if (!active) return null;
  return (
    <TouchableOpacity
      style={styles.badge}
      disabled={!commissioner}
      onPress={() => router.push('/(admin)/gameweek-simulator')}
      accessibilityLabel="Gameweek simulation mode active"
    >
      <Text style={styles.text}>SIM</Text>
    </TouchableOpacity>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: appRadius.pill,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  text: { ...appTypography.label, color: colors.warning, fontSize: 9 },
});
