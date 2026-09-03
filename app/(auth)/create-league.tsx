import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/utils/supabase';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import AuthScreenFrame from '@/components/AuthScreenFrame';
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
  const { selectActiveLeague } = useAppSession();
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
      const { data: createResult, error: createError } = await supabase.rpc(
        'create_league_atomic',
        {
          p_name: cleanName,
          p_team_name: cleanTeamName,
          p_max_size: parseInt(size, 10) || 8,
          p_roster_type: rosterType,
        }
      );

      if (createError) throw createError;

      const result = Array.isArray(createResult) ? createResult[0] : createResult;
      if (!result?.success || !result?.league_id || !result?.invite_code) {
        throw new Error(result?.error || 'League record could not be generated.');
      }

      setCreatedLeagueId(result.league_id);
      setCreatedCode(result.invite_code);
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

    await selectActiveLeague(createdLeagueId);

    console.log(
      '🚀 [ROUTING] Membership verified. Entering dashboard...'
    );

    router.replace('/(tabs)/dashboard');
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
    <AuthScreenFrame contentStyle={styles.container}>
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
              <ActivityIndicator color={colors.accentForeground} size="small" />
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
    <ActivityIndicator color={colors.accentForeground} size="small" />
  ) : (
    <Text style={styles.btnText}>
      ENTER MY SQUAD DASHBOARD
    </Text>
  )}
</TouchableOpacity>
        </View>
      )}
    </AuthScreenFrame>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { backgroundColor: colors.background, padding: 20, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', color: colors.textPrimary, textTransform: 'uppercase', marginBottom: 20 },
  label: { fontSize: 11, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, color: colors.textPrimary, padding: 14, borderRadius: 2, marginBottom: 16 },
  rosterTypeRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  rosterTypeBtn: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, padding: 12, alignItems: 'center', borderRadius: 2 },
  rosterTypeBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  rosterTypeText: { color: colors.textSecondary, fontSize: 10, fontWeight: '800' },
  rosterTypeTextActive: { color: colors.accent },
  btn: { backgroundColor: colors.accentFill, padding: 16, alignItems: 'center', borderRadius: 2, marginTop: 10 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.accentForeground, fontWeight: '900', fontSize: 13 },
  codeContainer: { alignItems: 'center', backgroundColor: colors.surface, padding: 24, borderWidth: 1, borderColor: colors.accent },
  successText: { color: colors.textPrimary, fontWeight: '800', fontSize: 16, marginBottom: 16 },
  codeLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800' },
  codeDisplay: { color: colors.accent, fontSize: 36, fontWeight: '900', letterSpacing: 4, marginVertical: 10 },
  hint: { color: colors.textMuted, fontSize: 11, textAlign: 'center', fontWeight: '600' }
});
