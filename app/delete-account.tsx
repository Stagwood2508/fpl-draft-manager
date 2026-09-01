import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

export default function PublicAccountDeletionScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setSignedInEmail(data.user?.email ?? null));
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedInEmail(session?.user.email ?? null);
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  const signIn = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      if (!data.user) throw new Error('Sign-in could not be confirmed.');
      setSignedInEmail(data.user.email ?? email.trim());
      setPassword('');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Sign-in failed. Check your email and password.');
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (!signedInEmail || confirmation.trim().toUpperCase() !== 'DELETE') return;
    const approved = Platform.OS !== 'web' || window.confirm('Permanently delete this FPL Draft Manager account and its associated personal data?');
    if (!approved) return;

    setBusy(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.rpc('delete_my_account');
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        if (result?.error === 'COMMISSIONER_TRANSFER_REQUIRED') {
          const leagues = (result.leagues ?? []).map((league: any) => league.name).join(', ');
          throw new Error(`Before deleting this account, transfer commissioner ownership for: ${leagues}. This protects the other managers in those leagues.`);
        }
        throw new Error(result?.error || 'Account deletion failed.');
      }
      await supabase.auth.signOut({ scope: 'local' });
      setSignedInEmail(null);
      setDeleted(true);
    } catch (error: any) {
      setErrorMessage(error?.message || 'The account could not be deleted. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (deleted) {
    return (
      <SafeAreaView style={styles.safe}>
        <Head><title>Account Deleted | FPL Draft Manager</title></Head>
        <View style={styles.centeredContent}>
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>ACCOUNT DELETED</Text>
            <Text style={styles.body}>Your FPL Draft Manager authentication account and directly associated personal app data have been removed. You have also been signed out.</Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => router.replace('/privacy')}>
              <Text style={styles.secondaryButtonText}>VIEW PRIVACY POLICY</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Head>
        <title>Delete Account | FPL Draft Manager</title>
        <meta name="description" content="Public account-deletion route for FPL Draft Manager." />
      </Head>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>PUBLIC ACCOUNT CONTROL</Text>
              <Text style={styles.title}>Delete your FPL Draft Manager account</Text>
              <Text style={styles.intro}>This page works without reinstalling the app. Sign in to verify ownership, then permanently delete your account.</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/login')}>
              <Text style={styles.closeButtonText}>CLOSE</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>What deletion removes</Text>
            <Text style={styles.body}>Deletion removes your authentication record, profile link, memberships, squads, personal preferences, watchlists, pending transactions, push tokens and other directly associated records.</Text>
            <Text style={styles.body}>Limited league audit, completed competition and technical reliability records may remain in anonymised form where needed to preserve results, prevent abuse or investigate faults.</Text>
          </View>

          {!signedInEmail ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>1. Verify account ownership</Text>
              <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Registered email address" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
              <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={colors.textMuted} secureTextEntry autoCapitalize="none" />
              <TouchableOpacity style={[styles.primaryButton, (!email.trim() || !password || busy) && styles.disabled]} disabled={!email.trim() || !password || busy} onPress={signIn}>
                {busy ? <ActivityIndicator color={colors.accentForeground} /> : <Text style={styles.primaryButtonText}>SIGN IN SECURELY</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkButton} onPress={() => router.push('/(auth)/forgot-password')}>
                <Text style={styles.linkText}>Forgotten your password? Request a reset link</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.card, styles.dangerCard]}>
              <Text style={styles.sectionTitle}>2. Confirm permanent deletion</Text>
              <Text style={styles.signedInText}>Verified account: {signedInEmail}</Text>
              <Text style={styles.body}>Type DELETE below. If you commission a league containing other managers, transfer commissioner ownership first so their competition is not removed.</Text>
              <TextInput style={styles.input} value={confirmation} onChangeText={setConfirmation} placeholder="Type DELETE" placeholderTextColor={colors.textMuted} autoCapitalize="characters" />
              <TouchableOpacity style={[styles.deleteButton, (confirmation.trim().toUpperCase() !== 'DELETE' || busy) && styles.disabled]} disabled={confirmation.trim().toUpperCase() !== 'DELETE' || busy} onPress={deleteAccount}>
                {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.deleteButtonText}>DELETE MY ACCOUNT PERMANENTLY</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkButton} onPress={() => void supabase.auth.signOut({ scope: 'local' })}>
                <Text style={styles.linkText}>This is not my account — sign out</Text>
              </TouchableOpacity>
            </View>
          )}

          {errorMessage && <View style={styles.errorCard}><Text style={styles.errorText}>{errorMessage}</Text></View>}

          <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/privacy')}>
            <Text style={styles.secondaryButtonText}>VIEW PRIVACY POLICY</Text>
          </TouchableOpacity>
          <Text style={styles.footer}>Public route: fpl-draft-manager.vercel.app/delete-account</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: appSpacing.lg, gap: 14, paddingBottom: 48 },
  centeredContent: { flex: 1, justifyContent: 'center', width: '100%', maxWidth: 620, alignSelf: 'center', padding: appSpacing.lg },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  title: { ...appTypography.screenTitle, color: colors.textPrimary, marginTop: 5 },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 7 },
  closeButton: { borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.small, paddingHorizontal: 12, paddingVertical: 9 },
  closeButtonText: { color: colors.textSecondary, fontSize: 10, fontWeight: '900' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium, padding: appSpacing.lg },
  dangerCard: { borderColor: colors.danger },
  sectionTitle: { ...appTypography.sectionTitle, color: colors.textPrimary, marginBottom: 10 },
  body: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 8 },
  signedInText: { color: colors.accent, fontSize: 12, fontWeight: '800', marginBottom: 10 },
  input: { backgroundColor: colors.backgroundDeep, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.small, color: colors.textPrimary, padding: 13, marginTop: 9 },
  primaryButton: { alignItems: 'center', justifyContent: 'center', minHeight: 46, backgroundColor: colors.accentFill, borderRadius: appRadius.small, padding: 13, marginTop: 12 },
  primaryButtonText: { color: colors.accentForeground, fontSize: 11, fontWeight: '900' },
  deleteButton: { alignItems: 'center', justifyContent: 'center', minHeight: 46, backgroundColor: colors.danger, borderRadius: appRadius.small, padding: 13, marginTop: 12 },
  deleteButtonText: { color: colors.white, fontSize: 11, fontWeight: '900' },
  disabled: { opacity: 0.42 },
  linkButton: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  linkText: { color: colors.accent, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  secondaryButton: { alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.small, padding: 13 },
  secondaryButtonText: { color: colors.textSecondary, fontSize: 11, fontWeight: '900' },
  errorCard: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger, borderRadius: appRadius.small, padding: 12 },
  errorText: { color: colors.danger, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  successCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent, borderRadius: appRadius.medium, padding: appSpacing.xl, gap: 12 },
  successTitle: { ...appTypography.screenTitle, color: colors.accent },
  footer: { color: colors.textMuted, fontSize: 10, textAlign: 'center', marginTop: 2 },
});
