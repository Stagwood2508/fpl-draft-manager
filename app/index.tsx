import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/utils/supabase';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import type { AppColors } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';

export default function Index() {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { refreshLeagueMembership } = useAppSession();

  useEffect(() => {
    async function checkAuthAndNavigate() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace('/(auth)/login');
        return;
      }

      const membershipExists = await refreshLeagueMembership();

      if (membershipExists) {
        router.replace('/(tabs)/dashboard');
      } else {
        router.replace('/(auth)/onboarding');
      }
    }

    checkAuthAndNavigate();
  }, [refreshLeagueMembership, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
});
