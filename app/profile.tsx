import React, { useState, useEffect, useMemo } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  Alert, 
  ScrollView 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/utils/supabase';
import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

export default function GenericProfileScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [userLeagues, setUserLeagues] = useState<{ leagueName: string; teamName: string }[]>([]);

  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setEmail(user.email || '');

      // 1. Fetch the manager's profile (display_name)
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle();

      if (profile) {
        setDisplayName(profile.display_name || '');
      }

      // 2. Fetch team names per league from league_members
      const { data: memberships } = await supabase
        .from('league_members')
        .select('team_name, leagues(name)')
        .eq('user_id', user.id);

      if (memberships) {
        const formatted = memberships.map((m: any) => ({
          leagueName: m.leagues?.name || 'League',
          teamName: m.team_name || 'Unnamed Team',
        }));
        setUserLeagues(formatted);
      }
    } catch (err: any) {
      console.error('Error loading profile:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    try {
      setUpdating(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Commit manager display_name change
      const { error: pErr } = await supabase
        .from('profiles')
        .upsert({ id: user.id, display_name: displayName.trim() });
      if (pErr) throw pErr;

      // 2. Commit password updates if provided
      if (newPassword.trim()) {
        const { error: aErr } = await supabase.auth.updateUser({ password: newPassword });
        if (aErr) throw aErr;
        setNewPassword('');
      }

      Alert.alert('Success', 'Profile settings successfully updated.');
    } catch (err: any) {
      Alert.alert('Update Interrupted', err.message);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeContainer} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.title}>Account Identity</Text>
        
        <View style={styles.card}>
          <Text style={styles.label}>Registered Account Email (Locked)</Text>
          <TextInput style={[styles.input, styles.disabledInput]} value={email} editable={false} />

          <Text style={styles.label}>Manager Nickname</Text>
          <TextInput 
            style={styles.input} 
            value={displayName} 
            onChangeText={setDisplayName} 
            placeholder="e.g., Gaffer Dave" 
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.label}>Change Password (Optional)</Text>
          <TextInput 
            style={styles.input} 
            secureTextEntry 
            value={newPassword} 
            onChangeText={setNewPassword} 
            placeholder="Enter a new password" 
            placeholderTextColor={colors.textMuted}
          />

          <TouchableOpacity style={styles.btn} onPress={handleUpdateProfile} disabled={updating}>
            <Text style={styles.btnText}>{updating ? 'SAVING CHANGES...' : 'UPDATE PROFILE IDENTITY'}</Text>
          </TouchableOpacity>
        </View>

        {/* Dynamic List of Registered Squads across Leagues */}
        <View style={styles.leagueSection}>
          <Text style={styles.sectionTitle}>Your Registered Squads</Text>
          {userLeagues.length === 0 ? (
            <Text style={styles.emptyText}>Not currently registered in any leagues.</Text>
          ) : (
            userLeagues.map((item, idx) => (
              <View key={idx} style={styles.teamCard}>
                <Text style={styles.leagueName}>{item.leagueName}</Text>
                <Text style={styles.teamName}>{item.teamName}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safeContainer: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  title: { ...appTypography.screenTitle, color: colors.textPrimary, textTransform: 'uppercase', marginBottom: appSpacing.xl },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: appSpacing.lg, borderRadius: appRadius.medium },
  label: { ...appTypography.label, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 6 },
  input: { backgroundColor: colors.backgroundDeep, borderColor: colors.border, borderWidth: 1, color: colors.textPrimary, padding: 12, borderRadius: appRadius.small, marginBottom: 16 },
  disabledInput: { color: colors.textDisabled, backgroundColor: colors.surfaceMuted },
  btn: { backgroundColor: colors.accent, padding: 14, alignItems: 'center', borderRadius: appRadius.small, marginTop: 10 },
  btnText: { color: colors.black, fontWeight: '900', fontSize: 13 },
  leagueSection: { marginTop: 24 },
  sectionTitle: { ...appTypography.sectionTitle, color: colors.accent, textTransform: 'uppercase', marginBottom: 12 },
  teamCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 14, borderRadius: appRadius.medium, marginBottom: 8 },
  leagueName: { color: colors.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  teamName: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', marginTop: 2 },
  emptyText: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' }
});
