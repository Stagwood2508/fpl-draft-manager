import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

export default function AccountAndPrivacyScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  const deleteAccount = async () => {
    if (confirmation.trim().toUpperCase() !== 'DELETE') return;

    const execute = async () => {
      try {
        setDeleting(true);
        const { data, error } = await supabase.rpc('delete_my_account');
        if (error) throw error;
        const result = Array.isArray(data) ? data[0] : data;
        if (!result?.success) {
          if (result?.error === 'COMMISSIONER_TRANSFER_REQUIRED') {
            const names = (result.leagues ?? []).map((league: any) => league.name).join(', ');
            throw new Error(`Transfer commissioner ownership before deleting your account: ${names}.`);
          }
          throw new Error(result?.error || 'Account deletion failed.');
        }
        await supabase.auth.signOut({ scope: 'local' });
        router.replace('/(auth)/login');
      } catch (error: any) {
        Alert.alert('Account Not Deleted', error?.message || 'Please try again.');
      } finally {
        setDeleting(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Permanently delete your account and personal data? This cannot be undone.')) void execute();
    } else {
      Alert.alert('Delete Account?', 'This permanently removes your account and personal data. This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete Permanently', style: 'destructive', onPress: () => void execute() },
      ]);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Text style={styles.title}>Privacy & Account</Text>
          <TouchableOpacity onPress={() => router.back()}><Text style={styles.close}>CLOSE</Text></TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Privacy information</Text>
          <Text style={styles.body}>We store your account identity, league memberships, squads, draft and transaction activity, notification token and preferences needed to operate the fantasy league.</Text>
          <Text style={styles.body}>Crash reports and tester feedback may include the app screen, device platform, app version and technical error details. Passwords are handled by Supabase Auth and are not visible to this app.</Text>
          <Text style={styles.body}>Your information is used to provide league features, maintain reliability and investigate beta feedback. It is not sold. League activity may remain visible to other league members while your account exists.</Text>
          <Text style={styles.body}>Use the Tester Feedback screen for privacy questions or data requests. Account deletion below removes your authentication record and associated personal app data.</Text>
          <TouchableOpacity style={styles.policyButton} onPress={() => router.push('/privacy')}>
            <Text style={styles.policyButtonText}>VIEW FULL PRIVACY POLICY</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.policyButton} onPress={() => router.push('/delete-account')}>
            <Text style={styles.policyButtonText}>OPEN PUBLIC ACCOUNT-DELETION PAGE</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, styles.dangerCard]}>
          <Text style={styles.dangerTitle}>Delete account</Text>
          <Text style={styles.body}>Deletion is permanent. If you commission a league containing other managers, transfer commissioner ownership first so their league is not destroyed.</Text>
          <TextInput
            style={styles.input}
            value={confirmation}
            onChangeText={setConfirmation}
            placeholder="Type DELETE to confirm"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={[styles.deleteButton, confirmation.trim().toUpperCase() !== 'DELETE' && styles.disabled]}
            onPress={deleteAccount}
            disabled={deleting || confirmation.trim().toUpperCase() !== 'DELETE'}
          >
            <Text style={styles.deleteText}>{deleting ? 'DELETING...' : 'DELETE MY ACCOUNT'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  keyboardView: { flex: 1 },
  content: { padding: appSpacing.lg, maxWidth: 760, width: '100%', alignSelf: 'center', gap: 18 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...appTypography.screenTitle, color: colors.textPrimary, textTransform: 'uppercase' },
  close: { color: colors.accent, fontSize: 12, fontWeight: '900' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: appSpacing.lg, borderRadius: appRadius.medium },
  sectionTitle: { ...appTypography.sectionTitle, color: colors.accent, textTransform: 'uppercase', marginBottom: 12 },
  body: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 10 },
  policyButton: { borderWidth: 1, borderColor: colors.accentBorder, backgroundColor: colors.accentSoft, padding: 12, borderRadius: appRadius.small, alignItems: 'center', marginTop: 8 },
  policyButtonText: { color: colors.accent, fontSize: 11, fontWeight: '900' },
  dangerCard: { borderColor: colors.danger },
  dangerTitle: { ...appTypography.sectionTitle, color: colors.danger, textTransform: 'uppercase', marginBottom: 12 },
  input: { backgroundColor: colors.backgroundDeep, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, padding: 13, borderRadius: appRadius.small, marginTop: 8 },
  deleteButton: { backgroundColor: colors.danger, padding: 14, borderRadius: appRadius.small, alignItems: 'center', marginTop: 12 },
  deleteText: { color: colors.white, fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.4 },
});
