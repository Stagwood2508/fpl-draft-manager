import React, { useState } from 'react';
import { Platform, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/utils/supabase';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import type { AppColors } from '@/constants/theme';
import { saveDeviceTokenToProfile } from './login';

// Helper function to render alerts reliably across Web and Mobile
const notifyUser = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

export default function RegisterScreen() {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState(''); 
  const [lastName, setLastName] = useState('');   
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleRegister = async () => {
    const cleanEmail = email.trim();
    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();

    if (!cleanFirst || !cleanLast) {
      const msg = 'Please enter both your First Name and Last Name.';
      setErrorMessage(msg);
      notifyUser('Missing Info', msg);
      return;
    }

    if (!cleanEmail || !password) {
      const msg = 'Please enter both an Email address and Password.';
      setErrorMessage(msg);
      notifyUser('Missing Info', msg);
      return;
    }

    if (password.length < 8) {
      const msg = 'Password must be at least 8 characters long.';
      setErrorMessage(msg);
      notifyUser('Weak Password', msg);
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const combinedDisplayName = `${cleanFirst} ${cleanLast}`;

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ 
        email: cleanEmail, 
        password: password,
        options: {
          data: {
            first_name: cleanFirst,   
            last_name: cleanLast,     
            display_name: combinedDisplayName, 
          }
        }
      });

      if (signUpError) throw signUpError;
      
      const user = signUpData?.user;

      if (!user) {
        throw new Error('Registration succeeded, but no user session was returned. Please check if email confirmation is enabled in your Supabase dashboard.');
      }

      // Try registering device push token safely
      await saveDeviceTokenToProfile(user.id);

      // Direct replacement ensures web router transitions immediately
      router.replace('/(auth)/onboarding');

    } catch (err: any) {
      console.error('Registration Error Details:', err);

      let userMsg = err.message || 'An unexpected error occurred during account creation.';
      if (err.message?.includes('User already registered')) {
        userMsg = 'An account with this email already exists. Try signing in instead.';
      } else if (err.message?.includes('Password should be at least')) {
        userMsg = 'Password must be at least 8 characters long.';
      }

      setErrorMessage(userMsg);
      notifyUser('Registration Failed', userMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleTextChange = (setter: React.Dispatch<React.SetStateAction<string>>, value: string) => {
    setter(value);
    if (errorMessage) setErrorMessage(null);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Draft FPL Hub</Text>
      <Text style={styles.subtitle}>Create Manager Account</Text>

      {/* INLINE ERROR BANNER FOR BROWSER / MOBILE FEEDBACK */}
      {errorMessage && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
          <Text style={styles.errorBannerText}>{errorMessage}</Text>
        </View>
      )}

      <TextInput 
        style={styles.input} 
        placeholder="First Name" 
        placeholderTextColor={colors.textMuted}
        value={firstName} 
        onChangeText={(txt) => handleTextChange(setFirstName, txt)} 
        autoCapitalize="words" 
      />
      <TextInput 
        style={styles.input} 
        placeholder="Last Name" 
        placeholderTextColor={colors.textMuted}
        value={lastName} 
        onChangeText={(txt) => handleTextChange(setLastName, txt)} 
        autoCapitalize="words" 
      />

      <TextInput 
        style={styles.input} 
        placeholder="Email" 
        placeholderTextColor={colors.textMuted}
        value={email} 
        onChangeText={(txt) => handleTextChange(setEmail, txt)} 
        autoCapitalize="none" 
        keyboardType="email-address" 
      />
      <TextInput 
        style={styles.input} 
        placeholder="Password" 
        placeholderTextColor={colors.textMuted}
        value={password} 
        onChangeText={(txt) => handleTextChange(setPassword, txt)} 
        secureTextEntry 
        autoCapitalize="none" 
      />

      <TouchableOpacity 
        style={[styles.btnPrimary, loading && { opacity: 0.6 }]} 
        onPress={handleRegister} 
        disabled={loading}
      >
        <Text style={styles.btnText}>{loading ? 'PROCESSING...' : 'REGISTER'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.switchLink} onPress={() => router.push('/(auth)/login')}>
        <Text style={styles.switchText}>
          Already have an account? Sign In
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background },
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
  switchText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' }
});
