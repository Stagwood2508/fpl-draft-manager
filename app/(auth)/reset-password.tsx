import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

import { AppColors } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import AuthScreenFrame from '@/components/AuthScreenFrame';
import { supabase } from '@/utils/supabase';

export default function ResetPasswordScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const recoveryUrl = Linking.useLinkingURL();
  const processedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const establishRecoverySession = async (url: string | null) => {
      try {
        if (!url) throw new Error('This password-reset link is incomplete or has expired.');

        const queryStart = url.indexOf('?');
        const fragmentStart = url.indexOf('#');
        const queryEnd = fragmentStart >= 0 ? fragmentStart : url.length;
        const query = new URLSearchParams(
          queryStart >= 0 ? url.slice(queryStart + 1, queryEnd) : ''
        );
        const fragment = new URLSearchParams(
          fragmentStart >= 0 ? url.slice(fragmentStart + 1) : ''
        );
        const getParam = (name: string) => query.get(name) ?? fragment.get(name);

        const providerError = getParam('error_description') ?? getParam('error');
        if (providerError) {
          throw new Error(providerError.replace(/\+/g, ' '));
        }

        const code = getParam('code');
        const accessToken = getParam('access_token');
        const refreshToken = getParam('refresh_token');

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else {
          throw new Error('This password-reset link is incomplete or has expired.');
        }

        if (mounted) {
          setRecoveryError(null);
          setRecoveryReady(true);
        }
      } catch (error: any) {
        if (mounted) setRecoveryError(error?.message || 'The password-reset link could not be verified.');
      }
    };

    if (recoveryUrl && processedUrlRef.current !== recoveryUrl) {
      processedUrlRef.current = recoveryUrl;
      void establishRecoverySession(recoveryUrl);
    } else if (!recoveryUrl) {
      setRecoveryError('This password-reset link is incomplete or has expired.');
    }

    return () => {
      mounted = false;
    };
  }, [recoveryUrl]);

  const updatePassword = async () => {
    if (password.length < 8 || password !== confirmPassword) {
      const message = password.length < 8 ? 'Use at least 8 characters.' : 'The passwords do not match.';
      if (Platform.OS === 'web') window.alert(message);
      else Alert.alert('Check Password', message);
      return;
    }
    try {
      setLoading(true);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      if (Platform.OS === 'web') window.alert('Your password has been updated.');
      else Alert.alert('Password Updated', 'You can now continue into the app.');
      router.replace('/');
    } catch (error: any) {
      const message = error?.message || 'Your password could not be updated.';
      if (Platform.OS === 'web') window.alert(message);
      else Alert.alert('Update Failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreenFrame contentStyle={styles.container}>
      <Text style={styles.title}>Choose New Password</Text>
      {recoveryError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{recoveryError}</Text>
          <TouchableOpacity style={styles.backLink} onPress={() => router.replace('/(auth)/forgot-password')}>
            <Text style={styles.backText}>Request another reset link</Text>
          </TouchableOpacity>
        </View>
      ) : !recoveryReady ? (
        <ActivityIndicator color={colors.accent} size="large" />
      ) : (
        <>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="New password" placeholderTextColor={colors.textMuted} secureTextEntry />
          <TextInput style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Confirm new password" placeholderTextColor={colors.textMuted} secureTextEntry />
          <TouchableOpacity style={styles.button} onPress={updatePassword} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'UPDATING...' : 'UPDATE PASSWORD'}</Text>
          </TouchableOpacity>
        </>
      )}
    </AuthScreenFrame>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  title: { color: colors.textPrimary, fontSize: 23, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center', marginBottom: 24 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, padding: 15, borderRadius: 5, marginBottom: 14 },
  button: { backgroundColor: colors.accentFill, padding: 15, alignItems: 'center', borderRadius: 5 },
  buttonText: { color: colors.accentForeground, fontWeight: '900', fontSize: 13 },
  errorCard: { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderWidth: 1, padding: 16, borderRadius: 5 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  backLink: { alignItems: 'center', marginTop: 14 },
  backText: { color: colors.accent, fontWeight: '800', fontSize: 13 },
});
