import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { supabase } from '../utils/supabase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [managerName, setManagerName] = useState(''); // 💡 Added state tracking
  const [teamName, setTeamName] = useState('');       // 💡 Added state tracking
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  async function handleAuth() {
    if (!email.trim() || !password) {
      Alert.alert('Missing Fields', 'Please enter both an email and password.');
      return;
    }

    // Require profile inputs only if registering an account
    if (isRegistering && (!managerName.trim() || !teamName.trim())) {
      Alert.alert('Missing Fields', 'Please fill in your Manager Name and Team Name to create your profile.');
      return;
    }

    try {
      setLoading(true);

      if (isRegistering) {
        // Enforce the metadata payload inside options object on creation
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password: password,
          options: {
            data: {
              manager_name: managerName.trim(),
              team_name: teamName.trim()
            }
          }
        });
        if (error) throw error;
        Alert.alert('Account Created! ⚽', 'Your manager identity has been registered successfully.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });
        if (error) throw error;
      }
    } catch (error: any) {
      Alert.alert('Authentication Error', error.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={{ flex: 1, backgroundColor: '#121212' }}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.innerContainer}>
          <Text style={styles.title}>{isRegistering ? 'Create Account' : 'Welcome Back'}</Text>
          <Text style={styles.subtitle}>
            {isRegistering ? 'Sign up to manage your draft squad' : 'Sign in to check your standings'}
          </Text>

          {/* 👑 MANAGER NAME FIELD (Only when registering) */}
          {isRegistering && (
            <View style={styles.formGroup}>
              <Text style={styles.label}>Manager Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Chandy"
                placeholderTextColor="#555"
                value={managerName}
                onChangeText={setManagerName}
              />
            </View>
          )}

          {/* 👑 TEAM NAME FIELD (Only when registering) */}
          {isRegistering && (
            <View style={styles.formGroup}>
              <Text style={styles.label}>Team Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Horsemen of Doom"
                placeholderTextColor="#555"
                value={teamName}
                onChangeText={setTeamName}
              />
            </View>
          )}

          <View style={styles.formGroup}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="your.email@example.com"
              placeholderTextColor="#555"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#555"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <TouchableOpacity style={styles.submitBtn} onPress={handleAuth} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#121212" />
            ) : (
              <Text style={styles.submitBtnText}>{isRegistering ? 'Sign Up' : 'Sign In'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.toggleLink} onPress={() => setIsRegistering(!isRegistering)}>
            <Text style={styles.toggleText}>
              {isRegistering ? 'Already have an account? ' : 'Need an account? '}
              <Text style={{ color: '#00ff87', fontWeight: 'bold' }}>
                {isRegistering ? 'Sign In' : 'Sign Up'}
              </Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scrollContainer: { flexGrow: 1, justifyContent: 'center' },
  innerContainer: { padding: 24 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#888', marginBottom: 32 },
  formGroup: { marginBottom: 20 },
  label: { color: '#aaa', fontSize: 13, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#1e1e1e', color: '#fff', height: 52, borderRadius: 8, paddingHorizontal: 16, fontSize: 15, borderWidth: 1, borderColor: '#2d2d2d' },
  submitBtn: { backgroundColor: '#00ff87', height: 52, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  submitBtnText: { color: '#121212', fontSize: 15, fontWeight: 'bold' },
  toggleLink: { marginTop: 24, alignItems: 'center' },
  toggleText: { color: '#888', fontSize: 14 }
});