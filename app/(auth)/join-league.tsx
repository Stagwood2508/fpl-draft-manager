import React, { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import AuthScreenFrame from '@/components/AuthScreenFrame';
import type { AppColors } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';

export default function JoinLeagueScreen() {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{ inviteCode?: string }>();
   const { refreshLeagueMembership } = useAppSession();
  const [inviteCode, setInviteCode] = useState(() => String(params.inviteCode || '').trim().toUpperCase());
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [joinError, setJoinError] = useState<{ title: string; message: string } | null>(null);

  const showJoinError = (title: string, message: string) => {
    setJoinError({ title, message });
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleJoinLeague = async () => {
    const cleanCode = inviteCode.trim().toUpperCase();
    const cleanTeamName = teamName.trim();

    if (!cleanCode || !cleanTeamName) {
      showJoinError('Missing Fields', 'Please enter both the Invitation Code and your Team Name.');
      return;
    }

    try {
      setLoading(true);
      setJoinError(null);

      // 1. Verify User Session
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr || !session?.user) {
        showJoinError('Session Expired', 'Please sign out and log back in.');
        router.replace('/(auth)/login');
        return;
      }
      // 2. Fetch League by Invite Code
      const { data: league, error: lookupErr } = await supabase
        .from('leagues')
        .select('id, name, max_size, status')
        .or(`invite_code.eq.${cleanCode},code.eq.${cleanCode}`)
        .maybeSingle();

      if (lookupErr) throw lookupErr;

      if (!league) {
        showJoinError('Invalid Code', 'No active league was found with that invitation code.');
        return;
      }

      // 3. Execute Validated Join via Postgres RPC
      const { data: joinResult, error: rpcErr } = await supabase.rpc('join_league_with_validation', {
        p_league_id: league.id,
        p_team_name: cleanTeamName,
      });

      if (rpcErr) throw rpcErr;

      // 4. Handle RPC Capacity / Status Rejections
      const rawResult = Array.isArray(joinResult) ? joinResult[0] : joinResult;
      const result = typeof rawResult === 'string'
        ? (() => {
            try {
              return JSON.parse(rawResult);
            } catch {
              return { success: false, error: rawResult };
            }
          })()
        : rawResult;

if (result && !result.success) {
const normalizedError = String(result.error || '').toUpperCase();
switch (true) {
  case normalizedError.includes('LEAGUE_FULL'):
  case normalizedError.includes('MAXIMUM CAPACITY'):
    showJoinError(
      'League Full',
      `This league has already reached its maximum capacity of ${
        league.max_size || 8
      } managers. Ask the commissioner to increase the league size or remove an inactive manager before trying again.`
    );
    return;

  case normalizedError.includes('DRAFT_ALREADY_STARTED'):
    showJoinError(
      'Draft In Progress',
      'You cannot join this league because the draft has already started or finished.'
    );
    return;

  case normalizedError.includes('TEAM_NAME_TAKEN'):
    showJoinError(
      'Team Name Taken',
      'Another manager in this league is already using that team name.'
    );
    return;

  case normalizedError.includes('AUTH_REQUIRED'):
    showJoinError(
      'Session Expired',
      'Please sign out and log back in before joining the league.'
    );
    return;

  default:
    showJoinError(
      'Join Failed',
      result.error || 'Could not join league.'
    );
    return;
}
      }

// 5. Persist the newly joined league
await AsyncStorage.setItem('active_league_id', league.id);

// 6. Refresh the shared membership state before navigating
const membershipConfirmed = await refreshLeagueMembership();

if (!membershipConfirmed) {
  throw new Error(
    'The league was joined successfully, but your membership could not be verified.'
  );
}

console.log(
  '🚀 [JOIN LEAGUE] Membership verified. Entering dashboard...'
);

// 7. Navigate only after RootLayout knows the user has a league
router.replace({
  pathname: '/(tabs)/dashboard',
  params: {
    leagueId: league.id,
  },
});

} catch (err: any) {
  console.error('Join League Crash:', JSON.stringify(err, null, 2));
  const exactErrorMsg = err?.message || err?.details || err?.hint || 'Something went wrong while joining the league.';
  const normalizedError = String(exactErrorMsg).toUpperCase();
  if (normalizedError.includes('LEAGUE_FULL') || normalizedError.includes('MAXIMUM CAPACITY')) {
    showJoinError(
      'League Full',
      'This league has already reached its maximum capacity. Ask the commissioner to increase the league size or remove an inactive manager before trying again.'
    );
  } else {
    showJoinError('Join Failed', exactErrorMsg);
  }
} finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreenFrame contentStyle={styles.container}>
      <Text style={styles.title}>Join Existing League</Text>

      {params.inviteCode ? (
        <View style={styles.inviteBanner}>
          <Text style={styles.inviteBannerLabel}>LEAGUE INVITATION</Text>
          <Text style={styles.inviteBannerText}>Your invite code has been added automatically.</Text>
        </View>
      ) : null}

      <Text style={styles.label}>Invitation Token</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g., X7K9PL"
        placeholderTextColor={colors.textMuted}
        value={inviteCode}
        onChangeText={setInviteCode}
        autoCapitalize="characters"
        maxLength={8}
      />

      <Text style={styles.label}>Your Team Name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g., Horsemen of Doom"
        placeholderTextColor={colors.textMuted}
        value={teamName}
        onChangeText={setTeamName}
        autoCapitalize="words"
      />

      {joinError && (
        <View style={styles.errorNotice} accessibilityRole="alert">
          <Text style={styles.errorNoticeTitle}>{joinError.title}</Text>
          <Text style={styles.errorNoticeMessage}>{joinError.message}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.btn, loading && styles.btnDisabled]}
        onPress={handleJoinLeague}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.accentForeground} size="small" />
        ) : (
          <Text style={styles.btnText}>ENTER LEAGUE</Text>
        )}
      </TouchableOpacity>
    </AuthScreenFrame>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { backgroundColor: colors.background, padding: 20, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', color: colors.textPrimary, textTransform: 'uppercase', marginBottom: 20 },
  inviteBanner: { padding: 12, marginBottom: 16, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: 4 },
  inviteBannerLabel: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  inviteBannerText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', marginTop: 3 },
  label: { fontSize: 11, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, color: colors.textPrimary, padding: 14, borderRadius: 2, marginBottom: 16 },
  errorNotice: { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderWidth: 1, borderRadius: 4, padding: 12, marginBottom: 8 },
  errorNoticeTitle: { color: colors.danger, fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  errorNoticeMessage: { color: colors.textPrimary, fontSize: 11, fontWeight: '600', lineHeight: 16, marginTop: 4 },
  btn: { backgroundColor: colors.accentFill, padding: 16, alignItems: 'center', borderRadius: 2, marginTop: 10 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.accentForeground, fontWeight: '900', fontSize: 13 },
});
