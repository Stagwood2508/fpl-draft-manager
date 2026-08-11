import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import type { AppColors } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';

// Helper function for web & native alert safety
const notifyUser = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

export default function CreateLeagueScreen() {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
    const { refreshLeagueMembership } = useAppSession();
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [size, setSize] = useState('8');
  const [rosterType, setRosterType] = useState<'STRICT' | 'FLEXIBLE'>('STRICT');
  const [createdLeagueId, setCreatedLeagueId] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreateLeaguePipeline = async () => {
    const cleanName = name.trim();
    const cleanTeamName = teamName.trim();

    if (!cleanName || !cleanTeamName) {
      notifyUser('Missing Fields', 'Please provide both a League Name and your Team Name.');
      return;
    }

    try {
      setLoading(true);
      
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr || !session?.user) {
        notifyUser('Session Expired', 'Please sign out and log back in.');
        router.replace('/(auth)/login');
        return;
      }
      const user = session.user;

      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      // 1. Insert into leagues table
      const { data: league, error: lErr } = await supabase
        .from('leagues')
        .insert({ 
          name: cleanName, 
          commissioner_id: user.id, 
          status: 'PRE_DRAFT',
          invite_code: inviteCode,
          max_size: parseInt(size, 10) || 8
        })
        .select()
        .single();

      if (lErr) {
        console.error('Error inserting league:', lErr);
        throw lErr;
      }
      if (!league) throw new Error('League record could not be generated.');

      // 2. Add commissioner to league_members
      const { error: memberErr } = await supabase
        .from('league_members')
        .insert({ 
          league_id: league.id, 
          user_id: user.id,
          team_name: cleanTeamName,
          role: 'COMMISSIONER',
          draft_order: 1
        });

      if (memberErr) {
        if (memberErr.code === '23505') {
          throw new Error('That team name is already taken in this league.');
        }
        console.error('Error inserting member:', memberErr);
        throw memberErr;
      }
      
      // 3. Seed Configurations (Saving roster_type choice)
const { error: settingsErr } = await supabase
  .from('league_settings')
  .insert({
    league_id: league.id,
    draft_clock_duration: 60,
    roster_type: rosterType,
    trade_cutoff_rule: 'WAIVER_DEADLINE',
    dropped_player_rule: 'NEXT_WAIVER',
    initial_waiver_order_rule: 'REVERSE_DRAFT',
  });

if (settingsErr) {
  console.error('Error creating league settings:', settingsErr);
  throw settingsErr;
}

      // 4. Initialize draft session state
const { error: draftSessionErr } = await supabase
  .from('draft_sessions')
  .insert({
    league_id: league.id,
    draft_status: 'WAITING_ROOM',
    current_round: 1,
    current_pick_index: 1,
    current_picker_id: user.id,
    pick_deadline: new Date().toISOString(),
  });

if (draftSessionErr) {
  console.error('Error creating draft session:', draftSessionErr);
  throw draftSessionErr;
}

      // 5. 🌟 PERSIST NEW LEAGUE AS ACTIVE IN ASYNC STORAGE & LOCAL STORAGE
      await AsyncStorage.setItem('active_league_id', league.id);
      if (Platform.OS === 'web') {
        window.localStorage.setItem('active_league_id', league.id);
      }

      setCreatedLeagueId(league.id);
      setCreatedCode(inviteCode);
    } catch (err: any) {
      console.error('League Creation Crash:', JSON.stringify(err, null, 2));
      const exactErrorMsg = err?.message || err?.details || err?.hint || JSON.stringify(err);
      notifyUser('Database Rejection', exactErrorMsg);
    } finally {
      setLoading(false);
    }
  };

const handleEnterDashboard = async () => {
  if (!createdLeagueId) {
    notifyUser(
      'League Error',
      'The new league could not be identified. Please reload and try again.'
    );
    return;
  }

  try {
    setLoading(true);

    await AsyncStorage.setItem(
      'active_league_id',
      createdLeagueId
    );

    const membershipConfirmed =
      await refreshLeagueMembership();

    if (!membershipConfirmed) {
      throw new Error(
        'Your league was created, but your membership could not be verified.'
      );
    }

    console.log(
      '🚀 [ROUTING] Membership verified. Entering dashboard...'
    );

    router.replace({
      pathname: '/(tabs)/dashboard',
      params: {
        leagueId: createdLeagueId,
      },
    });
  } catch (err: any) {
    console.error('Navigation Error:', err);

    notifyUser(
      'Dashboard Error',
      err?.message ||
        'The dashboard could not be opened.'
    );
  } finally {
    setLoading(false);
  }
};

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Construct New League</Text>
      
      {!createdCode ? (
        <>
          <Text style={styles.label}>League Name</Text>
          <TextInput 
            style={styles.input} 
            placeholder="e.g., The Elite Draft Group" 
            placeholderTextColor="#444" 
            value={name} 
            onChangeText={setName} 
            autoCapitalize="words"
          />

          <Text style={styles.label}>Your Team Name</Text>
          <TextInput 
            style={styles.input} 
            placeholder="e.g., Horsemen of Doom" 
            placeholderTextColor="#444" 
            value={teamName} 
            onChangeText={setTeamName} 
            autoCapitalize="words"
          />

          <Text style={styles.label}>Roster Type Strategy</Text>
          <View style={styles.rosterTypeRow}>
            <TouchableOpacity 
              style={[styles.rosterTypeBtn, rosterType === 'STRICT' && styles.rosterTypeBtnActive]}
              onPress={() => setRosterType('STRICT')}
            >
              <Text style={[styles.rosterTypeText, rosterType === 'STRICT' && styles.rosterTypeTextActive]}>
                STRICT (2-5-5-3)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.rosterTypeBtn, rosterType === 'FLEXIBLE' && styles.rosterTypeBtnActive]}
              onPress={() => setRosterType('FLEXIBLE')}
            >
              <Text style={[styles.rosterTypeText, rosterType === 'FLEXIBLE' && styles.rosterTypeTextActive]}>
                FLEXIBLE (OPEN)
              </Text>
            </TouchableOpacity>
          </View>
          
          <Text style={styles.label}>Max Size Constraints</Text>
          <TextInput 
            style={styles.input} 
            keyboardType="numeric" 
            value={size} 
            onChangeText={setSize} 
          />

          <TouchableOpacity 
            style={[styles.btn, loading && styles.btnDisabled]} 
            onPress={handleCreateLeaguePipeline} 
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.black} size="small" />
            ) : (
              <Text style={styles.btnText}>GENERATE LEAGUE</Text>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.codeContainer}>
          <Text style={styles.successText}>League Created Successfully!</Text>
          <Text style={styles.codeLabel}>YOUR INVITATION CODE</Text>
          <Text style={styles.codeDisplay}>{createdCode}</Text>
          <Text style={styles.hint}>Share this token directly with your rival managers.</Text>

<TouchableOpacity
  style={[
    styles.btn,
    { marginTop: 30 },
    loading && styles.btnDisabled,
  ]}
  onPress={handleEnterDashboard}
  disabled={loading}
>
  {loading ? (
    <ActivityIndicator color={colors.black} size="small" />
  ) : (
    <Text style={styles.btnText}>
      ENTER MY SQUAD DASHBOARD
    </Text>
  )}
</TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', color: colors.textPrimary, textTransform: 'uppercase', marginBottom: 20 },
  label: { fontSize: 11, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, color: colors.textPrimary, padding: 14, borderRadius: 2, marginBottom: 16 },
  rosterTypeRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  rosterTypeBtn: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, padding: 12, alignItems: 'center', borderRadius: 2 },
  rosterTypeBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  rosterTypeText: { color: colors.textSecondary, fontSize: 10, fontWeight: '800' },
  rosterTypeTextActive: { color: colors.accent },
  btn: { backgroundColor: colors.accent, padding: 16, alignItems: 'center', borderRadius: 2, marginTop: 10 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.black, fontWeight: '900', fontSize: 13 },
  codeContainer: { alignItems: 'center', backgroundColor: colors.surface, padding: 24, borderWidth: 1, borderColor: colors.accent },
  successText: { color: colors.textPrimary, fontWeight: '800', fontSize: 16, marginBottom: 16 },
  codeLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800' },
  codeDisplay: { color: colors.accent, fontSize: 36, fontWeight: '900', letterSpacing: 4, marginVertical: 10 },
  hint: { color: colors.textMuted, fontSize: 11, textAlign: 'center', fontWeight: '600' }
});
