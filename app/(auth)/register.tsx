import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/utils/supabase';
import { saveDeviceTokenToProfile } from './login';

export default function RegisterScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState(''); 
  const [lastName, setLastName] = useState('');   
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    const cleanEmail = email.trim();
    const cleanPassword = password.trim();
    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();

    if (!cleanFirst || !cleanLast) {
      Alert.alert('Missing Info', 'Please enter both your First Name and Last Name.');
      return;
    }

    if (!cleanEmail || !cleanPassword) {
      Alert.alert('Missing Info', 'Please enter an Email and Password.');
      return;
    }

    if (cleanPassword.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);

    try {
      const combinedDisplayName = `${cleanFirst} ${cleanLast}`;

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ 
        email: cleanEmail, 
        password: cleanPassword,
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

      // 🚀 Direct replacement ensures web router transitions immediately
      router.replace('/(auth)/onboarding');

    } catch (err: any) {
      console.error('Registration Error Details:', err);
      Alert.alert(
        'Registration Failed', 
        err.message || 'An unexpected error occurred during account creation.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Draft FPL Hub</Text>
      <Text style={styles.subtitle}>Create Manager Account</Text>

      <TextInput 
        style={styles.input} 
        placeholder="First Name" 
        placeholderTextColor="#555" 
        value={firstName} 
        onChangeText={setFirstName} 
        autoCapitalize="words" 
      />
      <TextInput 
        style={styles.input} 
        placeholder="Last Name" 
        placeholderTextColor="#555" 
        value={lastName} 
        onChangeText={setLastName} 
        autoCapitalize="words" 
      />

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

      <TouchableOpacity style={styles.btnPrimary} onPress={handleRegister} disabled={loading}>
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