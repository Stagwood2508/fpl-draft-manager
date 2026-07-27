import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
// 🌟 NEW: Expo notification infrastructure libraries
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { supabase } from '../../utils/supabase';


// 🌟 NEW: Isolated device registry logic to update the manager profile
async function saveDeviceTokenToProfile(userId: string) {
  if (!Device.isDevice) return; // Simulators cannot register device-bound tokens

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
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState(''); 
  const [lastName, setLastName] = useState('');   
  const [teamName, setTeamName] = useState('');       
  const [loading, setLoading] = useState(false);

  const handleAuthAction = async () => {
    if (!email.trim() || !password.trim()) return;
    
    if (isRegistering && (!firstName.trim() || !lastName.trim() || !teamName.trim())) {
      Alert.alert('Missing Info', 'Please provide a First Name, Last Name, and Team Name to register.');
      return;
    }

    setLoading(true);

    try {
      if (isRegistering) {
        const combinedDisplayName = `${firstName.trim()} ${lastName.trim()}`;

        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            data: {
              first_name: firstName.trim(),   
              last_name: lastName.trim(),     
              display_name: combinedDisplayName, 
              team_name: teamName.trim()
            }
          }
        });

        if (signUpError) throw signUpError;
        
        // 🌟 Save device token immediately on successful signup registration
        if (signUpData?.user) {
          await saveDeviceTokenToProfile(signUpData.user.id);
        }

        Alert.alert('Success', 'Account created! Proceeding to league onboarding...', [
          { text: 'OK', onPress: () => router.replace('onboarding') }
        ]);

      } else {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        
        if (signInError) throw signInError;
        if (!signInData?.user) return;

        // 🌟 Save device token on standard session login refresh
        await saveDeviceTokenToProfile(signInData.user.id);

        const { data: membership } = await supabase
          .from('league_members')
          .select('league_id')
          .eq('user_id', signInData.user.id)
          .maybeSingle();

        if (membership?.league_id) {
          router.replace('/(tabs)/dashboard');
        } else {
          router.replace('onboarding');
        }
      }
    } catch (err: any) {
      Alert.alert(isRegistering ? 'Registration Error' : 'Login Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Draft FPL Hub</Text>
      <Text style={styles.subtitle}>{isRegistering ? 'Create Manager Account' : 'Sign In To Squad'}</Text>
      
      {isRegistering && (
        <>
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
            placeholder="Team Name" 
            placeholderTextColor="#555" 
            value={teamName} 
            onChangeText={setTeamName} 
            autoCapitalize="words" 
          />
        </>
      )}

      <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#555" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#555" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />

      <TouchableOpacity style={styles.btnPrimary} onPress={handleAuthAction} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Processing...' : isRegistering ? 'REGISTER' : 'LOG IN'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.switchLink} onPress={() => setIsRegistering(!isRegistering)}>
        <Text style={styles.switchText}>
          {isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Create one"}
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