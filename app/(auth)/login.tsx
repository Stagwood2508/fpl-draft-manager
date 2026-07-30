import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { supabase } from '@/utils/supabase';

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
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      Alert.alert('Missing Fields', 'Please enter both your email and password.');
      return;
    }

    setLoading(true);

    try {
      // 1. Authenticate with Supabase
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ 
        email: cleanEmail, 
        password: cleanPassword 
      });
      
      if (signInError) throw signInError;

      const user = signInData?.user;
      if (!user) {
        throw new Error('Authentication succeeded, but user data was not returned. Please check if your account requires email verification.');
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
      Alert.alert('Login Failed', err.message || 'Unable to log in. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Draft FPL Hub</Text>
      <Text style={styles.subtitle}>Sign In To Squad</Text>

      <TextInput 
        style={styles.input} 
        placeholder="Email" 
        placeholderTextColor="#555" 
        value={email} 
        onChangeText={setEmail} 
        autoCapitalize="none" 
        keyboardType="email-address" 
      />
      <TextInput 
        style={styles.input} 
        placeholder="Password" 
        placeholderTextColor="#555" 
        value={password} 
        onChangeText={setPassword} 
        secureTextEntry 
        autoCapitalize="none" 
      />

      <TouchableOpacity style={styles.btnPrimary} onPress={handleLogin} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'PROCESSING...' : 'LOG IN'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.switchLink} onPress={() => router.push('/(auth)/register')}>
        <Text style={styles.switchText}>
          Don't have an account? Create one
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0A0A0A' },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#00ff87', textAlign: 'center', marginBottom: 30, textTransform: 'uppercase', fontWeight: '700' },
  input: { backgroundColor: '#111', color: '#fff', padding: 16, borderRadius: 4, marginBottom: 16, borderWidth: 1, borderColor: '#222' },
  btnPrimary: { backgroundColor: '#00ff87', padding: 16, borderRadius: 4, alignItems: 'center', marginTop: 10 },
  btnText: { color: '#000', fontWeight: '900', fontSize: 14 },
  switchLink: { marginTop: 20, alignItems: 'center' },
  switchText: { color: '#666', fontSize: 13, fontWeight: '600' }
});