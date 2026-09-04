import React, { useState, useEffect, useMemo } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  Alert, 
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/utils/supabase';
import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

type LeagueMembership = {
  leagueId: string;
  leagueName: string;
  teamName: string;
  changesUsed: number;
  changesRemaining: number;
};

export default function GenericProfileScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [userLeagues, setUserLeagues] = useState<LeagueMembership[]>([]);
  const [editingLeagueId, setEditingLeagueId] = useState<string | null>(null);
  const [teamNameDraft, setTeamNameDraft] = useState('');
  const [renamingLeagueId, setRenamingLeagueId] = useState<string | null>(null);

  const notifyUser = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
      return;
    }
    Alert.alert(title, message);
  };

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
        .select('league_id, team_name, team_name_change_count, leagues(name)')
        .eq('user_id', user.id);

      if (memberships) {
        const formatted = memberships.map((m: any) => ({
          leagueId: m.league_id,
          leagueName: m.leagues?.name || 'League',
          teamName: m.team_name || 'Unnamed Team',
          changesUsed: Number(m.team_name_change_count || 0),
          changesRemaining: Math.max(0, 3 - Number(m.team_name_change_count || 0)),
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
        if (newPassword.trim().length < 8) {
          throw new Error('Your new password must be at least 8 characters long.');
        }
        const { error: aErr } = await supabase.auth.updateUser({ password: newPassword });
        if (aErr) throw aErr;
        setNewPassword('');
      }

      notifyUser('Success', 'Profile settings successfully updated.');
    } catch (err: any) {
      notifyUser('Update Interrupted', err.message);
    } finally {
      setUpdating(false);
    }
  };

  const beginTeamRename = (membership: LeagueMembership) => {
    setEditingLeagueId(membership.leagueId);
    setTeamNameDraft(membership.teamName);
  };

  const cancelTeamRename = () => {
    setEditingLeagueId(null);
    setTeamNameDraft('');
  };

  const handleTeamRename = async (membership: LeagueMembership) => {
    const nextName = teamNameDraft.trim();
    if (!nextName) {
      notifyUser('Team Name Required', 'Enter a team name before saving.');
      return;
    }

    try {
      setRenamingLeagueId(membership.leagueId);
      const { data, error } = await supabase.rpc('change_my_team_name', {
        p_league_id: membership.leagueId,
        p_team_name: nextName,
      });
      if (error) throw error;

      const rawResult = Array.isArray(data) ? data[0] : data;
      const result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
      if (!result?.success) {
        const code = String(result?.error || 'TEAM_NAME_CHANGE_FAILED').toUpperCase();
        if (code.includes('TEAM_NAME_TAKEN')) {
          throw new Error('Another manager in this league is already using that team name.');
        }
        if (code.includes('TEAM_NAME_CHANGE_LIMIT_REACHED')) {
          throw new Error('You have used all three team-name changes for this league season.');
        }
        if (code.includes('INVALID_TEAM_NAME')) {
          throw new Error('Team names must contain text and be no longer than 50 characters.');
        }
        throw new Error('Your team name could not be changed. Please try again.');
      }

      setUserLeagues(current => current.map(item => item.leagueId === membership.leagueId
        ? {
            ...item,
            teamName: result.team_name || nextName,
            changesUsed: Number(result.changes_used ?? item.changesUsed),
            changesRemaining: Number(result.changes_remaining ?? item.changesRemaining),
          }
        : item));
      cancelTeamRename();
      notifyUser(
        result.unchanged ? 'No Change Needed' : 'Team Name Updated',
        result.unchanged
          ? 'That is already your current team name.'
          : `${result.changes_remaining} team-name ${result.changes_remaining === 1 ? 'change' : 'changes'} remaining this season.`
      );
    } catch (err: any) {
      notifyUser('Rename Failed', err?.message || 'Your team name could not be changed.');
    } finally {
      setRenamingLeagueId(null);
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
      <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16 }}
        keyboardShouldPersistTaps="handled"
      >
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
            userLeagues.map(item => (
              <View key={item.leagueId} style={styles.teamCard}>
                <View style={styles.teamCardHeader}>
                  <View style={styles.teamIdentity}>
                    <Text style={styles.leagueName}>{item.leagueName}</Text>
                    {editingLeagueId === item.leagueId ? (
                      <TextInput
                        style={[styles.input, styles.teamNameInput]}
                        value={teamNameDraft}
                        onChangeText={setTeamNameDraft}
                        autoCapitalize="words"
                        maxLength={50}
                        autoFocus
                        selectTextOnFocus
                      />
                    ) : (
                      <Text style={styles.teamName}>{item.teamName}</Text>
                    )}
                  </View>

                  {editingLeagueId !== item.leagueId && (
                    <TouchableOpacity
                      style={[styles.renameButton, item.changesRemaining === 0 && styles.renameButtonDisabled]}
                      onPress={() => beginTeamRename(item)}
                      disabled={item.changesRemaining === 0}
                    >
                      <Text style={[styles.renameButtonText, item.changesRemaining === 0 && styles.renameButtonTextDisabled]}>
                        RENAME
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Text style={styles.renameAllowance}>
                  {item.changesRemaining === 0
                    ? 'Team-name change limit reached'
                    : `${item.changesRemaining} of 3 team-name changes remaining`}
                </Text>

                {editingLeagueId === item.leagueId && (
                  <View style={styles.renameActions}>
                    <TouchableOpacity style={styles.cancelRenameButton} onPress={cancelTeamRename} disabled={renamingLeagueId === item.leagueId}>
                      <Text style={styles.cancelRenameText}>CANCEL</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.saveRenameButton} onPress={() => handleTeamRename(item)} disabled={renamingLeagueId === item.leagueId}>
                      {renamingLeagueId === item.leagueId
                        ? <ActivityIndicator size="small" color={colors.accentForeground} />
                        : <Text style={styles.saveRenameText}>SAVE TEAM NAME</Text>}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safeContainer: { flex: 1, backgroundColor: colors.background },
  keyboardView: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  title: { ...appTypography.screenTitle, color: colors.textPrimary, textTransform: 'uppercase', marginBottom: appSpacing.xl },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: appSpacing.lg, borderRadius: appRadius.medium },
  label: { ...appTypography.label, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 6 },
  input: { backgroundColor: colors.backgroundDeep, borderColor: colors.border, borderWidth: 1, color: colors.textPrimary, padding: 12, borderRadius: appRadius.small, marginBottom: 16 },
  disabledInput: { color: colors.textDisabled, backgroundColor: colors.surfaceMuted },
  btn: { backgroundColor: colors.accentFill, padding: 14, alignItems: 'center', borderRadius: appRadius.small, marginTop: 10 },
  btnText: { color: colors.accentForeground, fontWeight: '900', fontSize: 13 },
  leagueSection: { marginTop: 24 },
  sectionTitle: { ...appTypography.sectionTitle, color: colors.accent, textTransform: 'uppercase', marginBottom: 12 },
  teamCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 14, borderRadius: appRadius.medium, marginBottom: 8 },
  teamCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teamIdentity: { flex: 1, minWidth: 0 },
  leagueName: { color: colors.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  teamName: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', marginTop: 2 },
  teamNameInput: { marginTop: 7, marginBottom: 0 },
  renameAllowance: { color: colors.textMuted, fontSize: 10, fontWeight: '700', marginTop: 8 },
  renameButton: { borderWidth: 1, borderColor: colors.accentBorder, backgroundColor: colors.accentSoft, borderRadius: appRadius.small, paddingHorizontal: 12, paddingVertical: 9 },
  renameButtonDisabled: { borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  renameButtonText: { color: colors.accent, fontSize: 10, fontWeight: '900' },
  renameButtonTextDisabled: { color: colors.textDisabled },
  renameActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  cancelRenameButton: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.small, paddingVertical: 11 },
  cancelRenameText: { color: colors.textSecondary, fontSize: 10, fontWeight: '900' },
  saveRenameButton: { flex: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentFill, borderRadius: appRadius.small, paddingVertical: 11 },
  saveRenameText: { color: colors.accentForeground, fontSize: 10, fontWeight: '900' },
  emptyText: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' }
});
