import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/utils/supabase';

export default function JoinLeagueScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoinLeague = async () => {
    const cleanCode = code.trim().toUpperCase();
    const cleanTeamName = teamName.trim();

    if (!cleanCode || !cleanTeamName) {
      Alert.alert('Missing Fields', 'Please enter both the Invitation Token and your Team Name.');
      return;
    }

    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Authentication expired. Please log in again.');

      // 1. Locate the target league by invite code
      const { data: league, error: findError } = await supabase
        .from('leagues')
        .select('id, name, draft_status')
        .eq('invite_code', cleanCode)
        .maybeSingle();

      if (findError || !league) throw new Error('Invalid invitation code token signature.');

      if (league.draft_status === 'COMPLETED') {
        throw new Error('Cannot join this league—the draft has already taken place.');
      }

      // 2. Pre-check if team name is taken
      const { data: existingTeam } = await supabase
        .from('league_members')
        .select('id')
        .eq('league_id', league.id)
        .ilike('team_name', cleanTeamName)
        .maybeSingle();

      if (existingTeam) {
        throw new Error('That team name is already taken in this league. Pick another name!');
      }

      // 3. Attach user entries into league_members
      const { error: joinError } = await supabase
        .from('league_members')
        .insert({ 
          league_id: league.id, 
          user_id: user.id,
          team_name: cleanTeamName
        });

      if (joinError) {
        if (joinError.code === '23505') {
          throw new Error('You are already registered in this league, or that team name was just claimed.');
        }
        throw joinError;
      }

      // 🚀 CRITICAL FIX: Direct replacement guarantees seamless routing to dashboard
      router.replace('/(tabs)/dashboard');

    } catch (err: any) {
      Alert.alert('Join Entry Failure', err.message || 'Unable to join league.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join Private League</Text>
      
      <Text style={styles.label}>Input 6-Digit Invitation Token</Text>
      <TextInput 
        style={styles.inputToken} 
        placeholder="e.g., X9K2W1" 
        placeholderTextColor="#444" 
        autoCapitalize="characters" 
        maxLength={6} 
        value={code} 
        onChangeText={setCode} 
      />

      <Text style={styles.label}>Your Team Name</Text>
      <TextInput 
        style={styles.inputTeam} 
        placeholder="e.g., Horsemen of Doom" 
        placeholderTextColor="#444" 
        autoCapitalize="words" 
        value={teamName} 
        onChangeText={setTeamName} 
      />

      <TouchableOpacity style={styles.btn} onPress={handleJoinLeague} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'VERIFYING TOKEN...' : 'SUBMIT CODE GATE ENTRY'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A', padding: 20, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', color: '#FFF', textTransform: 'uppercase', marginBottom: 20 },
  label: { fontSize: 11, color: '#666', fontWeight: '800', textTransform: 'uppercase', marginBottom: 6 },
  inputToken: { 
    backgroundColor: '#111', 
    borderColor: '#222', 
    borderWidth: 1, 
    color: '#FFF', 
    padding: 14, 
    borderRadius: 2, 
    fontSize: 18, 
    textAlign: 'center', 
    fontWeight: '800', 
    letterSpacing: 2, 
    marginBottom: 16 
  },
  inputTeam: { 
    backgroundColor: '#111', 
    borderColor: '#222', 
    borderWidth: 1, 
    color: '#FFF', 
    padding: 14, 
    borderRadius: 2, 
    fontSize: 15, 
    marginBottom: 20 
  },
  btn: { backgroundColor: '#00ff87', padding: 16, alignItems: 'center', borderRadius: 2 },
  btnText: { color: '#000', fontWeight: '900', fontSize: 13 }
});