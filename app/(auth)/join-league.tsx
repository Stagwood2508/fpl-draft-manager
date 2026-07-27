import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../utils/supabase';

export default function JoinLeagueScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoinLeague = async () => {
    if (!code.trim()) return;
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Authentication expired.');

      // 🔍 Fetch user's registered team name from profile metadata to satisfy table constraints
      const { data: profileData, error: pErr } = await supabase
        .from('profiles')
        .select('team_name')
        .eq('id', user.id)
        .single();

      if (pErr) throw new Error('Could not retrieve your manager profile details.');
      const userTeamName = profileData?.team_name || 'Unnamed Team';

      // 1. Locate the target's invite token signature registry block
      const { data: league, error: findError } = await supabase
        .from('leagues')
        .select('id, name')
        .eq('invite_code', code.toUpperCase().trim())
        .maybeSingle();

      if (findError || !league) throw new Error('Invalid invitation code token signature.');

      // 2. Attach user payload entries directly into targeted memberships logs along with team_name
      const { error: joinError } = await supabase
        .from('league_members')
        .insert({ 
          league_id: league.id, 
          user_id: user.id,
          team_name: userTeamName
        });

      if (joinError) {
        if (joinError.code === '23505') throw new Error('You are already registered inside this league.');
        throw joinError;
      }

      // 🚀 THE BREAKOUT REDIRECT PATHWAY LINK
      Alert.alert('Joined!', `Successfully linked to ${league.name}.`, [
        { text: 'Proceed', onPress: () => router.replace('/(tabs)/dashboard') }
      ]);
    } catch (err: any) {
      Alert.alert('Join Entry Failure', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join Private League</Text>
      <Text style={styles.label}>Input 6-Digit Invitation Token</Text>
      <TextInput style={styles.input} placeholder="e.g., X9K2W1" placeholderTextColor="#444" autoCapitalize="characters" maxLength={6} value={code} onChangeText={setCode} />

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
  input: { backgroundColor: '#111', borderColor: '#222', borderWidth: 1, color: '#FFF', padding: 14, borderRadius: 2, fontSize: 18, textAlign: 'center', fontWeight: '800', letterSpacing: 2, marginBottom: 20 },
  btn: { backgroundColor: '#00ff87', padding: 16, alignItems: 'center', borderRadius: 2 },
  btnText: { color: '#000', fontWeight: '900', fontSize: 13 }
});