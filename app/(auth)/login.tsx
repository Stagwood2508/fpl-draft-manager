import React, { useState } from 'react';
import { Platform, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { supabase } from '@/utils/supabase';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import AuthScreenFrame from '@/components/AuthScreenFrame';
import type { AppColors } from '@/constants/theme';

// Helper function to render alerts reliably across Web and Mobile
const notifyUser = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

// Isolated device registry logic to update the manager profile
export async function saveDeviceTokenToProfile(userId: string) {
  if (!Device.isDevice) return;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });

    if (tokenData.data) {
      await supabase
        .from('profiles')
        .update({ expo_push_token: tokenData.data })
        .eq('id', userId);
    }
  } catch (err) {
    console.log("Token registration failed silently:", err);
  }
}

export default function LoginScreen() {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async () => {
    const cleanEmail = email.trim();

    if (!cleanEmail || !password) {
      const msg = 'Please enter both your email and password.';
      setErrorMessage(msg);
      notifyUser('Missing Fields', msg);
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      // 1. Authenticate with Supabase
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ 
        email: cleanEmail, 
        password: password
      });
      
      if (signInError) throw signInError;

      const user = signInData?.user;
      if (!user) {
        throw new Error('Authentication succeeded, but user session payload was missing. Please verify your email address.');
      }

      // 2. Save device token on successful login
      await saveDeviceTokenToProfile(user.id);

      // 3. Query league membership explicitly catching database errors
      const { data: membership, error: memberError } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (memberError) {
        console.warn('Membership lookup error:', memberError.message);
      }

      // 4. Route accurately based on membership status
      if (membership?.league_id) {
        router.replace('/(tabs)/dashboard');
      } else {
        router.replace('/(auth)/onboarding');
      }

    } catch (err: any) {
      console.error('Login Process Error:', err);

      let userMsg = err.message || 'Unable to log in. Please check your credentials.';
      if (err.message?.includes('Invalid login credentials')) {
        userMsg = 'Invalid email or password. Please check your details and try again.';
      } else if (err.message?.includes('Email not confirmed')) {
        userMsg = 'Please verify your email address before logging in.';
      }

      setErrorMessage(userMsg);
      notifyUser('Login Failed', userMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreenFrame contentStyle={styles.container}>
      <Text style={styles.title}>Draft FPL Hub</Text>
      <Text style={styles.subtitle}>Sign In To Squad</Text>

      {/* INLINE ERROR BANNER */}
      {errorMessage && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
          <Text style={styles.errorBannerText}>{errorMessage}</Text>
        </View>
      )}

      <TextInput 
        style={styles.input} 
        placeholder="Email" 
        placeholderTextColor={colors.textMuted}
        value={email} 
        onChangeText={(txt) => {
          setEmail(txt);
          if (errorMessage) setErrorMessage(null);
        }} 
        autoCapitalize="none" 
        keyboardType="email-address" 
      />
      <TextInput 
        style={styles.input} 
        placeholder="Password" 
        placeholderTextColor={colors.textMuted}
        value={password} 
        onChangeText={(txt) => {
          setPassword(txt);
          if (errorMessage) setErrorMessage(null);
        }} 
        secureTextEntry 
        autoCapitalize="none" 
      />

      <TouchableOpacity 
        style={[styles.btnPrimary, loading && { opacity: 0.6 }]} 
        onPress={handleLogin} 
        disabled={loading}
      >
        <Text style={styles.btnText}>{loading ? 'PROCESSING...' : 'LOG IN'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.switchLink} onPress={() => router.push('/(auth)/register')}>
        <Text style={styles.switchText}>
          Don't have an account? Create one
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.resetLink} onPress={() => router.push('/(auth)/forgot-password')}>
        <Text style={styles.resetText}>Forgot your password?</Text>
      </TouchableOpacity>
    </AuthScreenFrame>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  title: { fontSize: 28, fontWeight: '900', color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 13, color: colors.accent, textAlign: 'center', marginBottom: 30, textTransform: 'uppercase', fontWeight: '700' },
  
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: 12,
    borderRadius: 4,
    marginBottom: 16,
    gap: 8,
  },
  errorBannerText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },

  input: { backgroundColor: colors.surface, color: colors.textPrimary, padding: 16, borderRadius: 4, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  btnPrimary: { backgroundColor: colors.accent, padding: 16, borderRadius: 4, alignItems: 'center', marginTop: 10 },
  btnText: { color: colors.black, fontWeight: '900', fontSize: 14 },
  switchLink: { marginTop: 20, alignItems: 'center' },
  switchText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  resetLink: { marginTop: 14, alignItems: 'center' },
  resetText: { color: colors.accent, fontSize: 13, fontWeight: '700' }
});
