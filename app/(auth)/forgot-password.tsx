import React, { useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

import { AppColors } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import AuthScreenFrame from '@/components/AuthScreenFrame';
import { supabase } from '@/utils/supabase';

export default function ForgotPasswordScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail) return;
    try {
      setLoading(true);
      // Route groups are an internal Expo Router detail and must not be part of
      // the external URL sent in the recovery email.
      const redirectTo = Linking.createURL('reset-password');
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo });
      if (error) throw error;
      setSent(true);
    } catch (error: any) {
      const message = error?.message || 'The reset email could not be sent.';
      if (Platform.OS === 'web') window.alert(message);
      else Alert.alert('Reset Failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreenFrame contentStyle={styles.container}>
      <Text style={styles.title}>Reset Password</Text>
      <Text style={styles.copy}>
        Enter your account email and we will send you a secure password-reset link.
      </Text>
      {sent ? (
        <View style={styles.successCard}>
          <Text style={styles.successTitle}>CHECK YOUR EMAIL</Text>
          <Text style={styles.copy}>If an account exists for that address, a reset link has been sent.</Text>
        </View>
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor={colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.button} onPress={submit} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'SENDING...' : 'SEND RESET LINK'}</Text>
          </TouchableOpacity>
        </>
      )}
      <TouchableOpacity style={styles.backLink} onPress={() => router.replace('/(auth)/login')}>
        <Text style={styles.backText}>Back to sign in</Text>
      </TouchableOpacity>
    </AuthScreenFrame>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  title: { color: colors.textPrimary, fontSize: 25, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center' },
  copy: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10, marginBottom: 22 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, padding: 15, borderRadius: 5 },
  button: { backgroundColor: colors.accentFill, padding: 15, alignItems: 'center', borderRadius: 5, marginTop: 14 },
  buttonText: { color: colors.accentForeground, fontWeight: '900', fontSize: 13 },
  backLink: { marginTop: 20, alignItems: 'center' },
  backText: { color: colors.textSecondary, fontWeight: '700' },
  successCard: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder, padding: 18, marginTop: 22 },
  successTitle: { color: colors.accent, fontWeight: '900', textAlign: 'center' },
});
