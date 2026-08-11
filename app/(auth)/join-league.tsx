import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import type { AppColors } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';

export default function JoinLeagueScreen() {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
   const { refreshLeagueMembership } = useAppSession();
  const [inviteCode, setInviteCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoinLeague = async () => {
    const cleanCode = inviteCode.trim().toUpperCase();
    const cleanTeamName = teamName.trim();

    if (!cleanCode || !cleanTeamName) {
      Alert.alert('Missing Fields', 'Please enter both the Invitation Code and your Team Name.');
      return;
    }

    try {
      setLoading(true);

      // 1. Verify User Session
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr || !session?.user) {
        Alert.alert('Session Expired', 'Please sign out and log back in.');
        router.replace('/(auth)/login');
        return;
      }
      const user = session.user;

      // 2. Fetch League by Invite Code
      const { data: league, error: lookupErr } = await supabase
        .from('leagues')
        .select('id, name, max_size, status')
        .or(`invite_code.eq.${cleanCode},code.eq.${cleanCode}`)
        .maybeSingle();

      if (lookupErr) throw lookupErr;

      if (!league) {
        Alert.alert('Invalid Code', 'No active league was found with that invitation code.');
        return;
      }

      // 3. Execute Validated Join via Postgres RPC
      const { data: joinResult, error: rpcErr } = await supabase.rpc('join_league_with_validation', {
        p_league_id: league.id,
        p_user_id: user.id,
        p_team_name: cleanTeamName,
      });

      if (rpcErr) throw rpcErr;

      // 4. Handle RPC Capacity / Status Rejections
      const result = Array.isArray(joinResult)
  ? joinResult[0]
  : joinResult;

if (result && !result.success) {
switch (result.error) {
  case 'LEAGUE_FULL':
    Alert.alert(
      'League Full',
      `This league has already reached its maximum capacity of ${
        league.max_size || 8
      } managers.`
    );
    return;

  case 'DRAFT_ALREADY_STARTED':
    Alert.alert(
      'Draft In Progress',
      'You cannot join this league because the draft has already started or finished.'
    );
    return;

  default:
    Alert.alert(
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
  Alert.alert('Join Failed', exactErrorMsg);
} finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join Existing League</Text>

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

      <TouchableOpacity
        style={[styles.btn, loading && styles.btnDisabled]}
        onPress={handleJoinLeague}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.black} size="small" />
        ) : (
          <Text style={styles.btnText}>ENTER LEAGUE</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', color: colors.textPrimary, textTransform: 'uppercase', marginBottom: 20 },
  label: { fontSize: 11, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, color: colors.textPrimary, padding: 14, borderRadius: 2, marginBottom: 16 },
  btn: { backgroundColor: colors.accent, padding: 16, alignItems: 'center', borderRadius: 2, marginTop: 10 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.black, fontWeight: '900', fontSize: 13 },
});
