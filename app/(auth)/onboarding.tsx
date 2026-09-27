import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/utils/supabase';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import type { AppColors } from '@/constants/theme';
import AuthScreenFrame from '@/components/AuthScreenFrame';

export default function OnboardingScreen() {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{ inviteCode?: string }>();
  const inviteCode = String(params.inviteCode || '').trim().toUpperCase();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;

    try {
      setSigningOut(true);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.replace('/(auth)/login');
    } catch (error: any) {
      const message = error?.message || 'Your account could not be signed out. Please try again.';
      if (Platform.OS === 'web') window.alert(`Sign out failed\n\n${message}`);
      else Alert.alert('Sign out failed', message);
      setSigningOut(false);
    }
  };

  // 🛡️ Auto-forward if user is already assigned to a league
  useEffect(() => {
    const checkExistingLeague = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

const { data: member } = await supabase
  .from('league_members')
  .select('league_id')
  .eq('user_id', user.id)
  .limit(1) // 👈 Safe query for single or multi-league accounts
  .maybeSingle();

      if (member?.league_id) {
        router.replace('/(tabs)/dashboard');
      }
    };

    checkExistingLeague();
  }, []);

  return (
    <AuthScreenFrame contentStyle={styles.container}>
      <Text style={styles.title}>Ecosystem Setup</Text>
      <Text style={styles.subtitle}>Initialize your draft framework target</Text>

      <TouchableOpacity 
        style={styles.choiceCard} 
        onPress={() => router.replace('/(auth)/create-league')}
      >
        <Text style={styles.cardTitle}>🏆 CREATE A LEAGUE</Text>
        <Text style={styles.cardSub}>Set up a custom league, adjust configurations, and invite rivals.</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.choiceCard, { borderColor: colors.borderStrong }]}
        onPress={() => router.replace({
          pathname: '/(auth)/join-league',
          params: inviteCode ? { inviteCode } : {},
        })}
      >
        <Text style={[styles.cardTitle, { color: '#FFF' }]}>🤝 JOIN A LEAGUE</Text>
        <Text style={styles.cardSub}>
          {inviteCode
            ? `Your invitation code ${inviteCode} is ready to use.`
            : 'Enter an invite code provided by your league commissioner.'}
        </Text>
      </TouchableOpacity>

      <View style={styles.exitSection}>
        <Text style={styles.exitHint}>Not ready to join a league yet?</Text>
        <TouchableOpacity
          style={[styles.signOutButton, signingOut && styles.signOutButtonDisabled]}
          onPress={() => void handleSignOut()}
          disabled={signingOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          {signingOut ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Text style={styles.signOutText}>SIGN OUT</Text>
          )}
        </TouchableOpacity>
      </View>
    </AuthScreenFrame>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { justifyContent: 'center', padding: 20, backgroundColor: colors.background },
  title: { fontSize: 24, fontWeight: '900', color: colors.textPrimary, textTransform: 'uppercase' },
  subtitle: { fontSize: 13, color: colors.accent, marginBottom: 40, fontWeight: '600' },
  choiceCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent, padding: 20, borderRadius: 4, marginBottom: 16 },
  cardTitle: { color: colors.accent, fontSize: 16, fontWeight: '900' },
  cardSub: { color: colors.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 18 },
  exitSection: { alignItems: 'center', marginTop: 12 },
  exitHint: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 8 },
  signOutButton: { minHeight: 44, minWidth: 130, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18 },
  signOutButtonDisabled: { opacity: 0.6 },
  signOutText: { color: colors.textSecondary, fontSize: 12, fontWeight: '900', textDecorationLine: 'underline' },
});
