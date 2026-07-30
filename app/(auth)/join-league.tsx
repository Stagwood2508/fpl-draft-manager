import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/utils/supabase';

export default function JoinLeagueScreen() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoinLeague = async () => {
    const cleanCode = inviteCode.trim().toUpperCase();
    const cleanTeamName = teamName.trim();

    if (!cleanCode || !cleanTeamName) {
      Alert.alert('Missing Fields', 'Please enter both the Invitation Code and your Team Name.');
      return;
    }

    try {
      setLoading(true);

      // 1. Verify User Session
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr || !session?.user) {
        Alert.alert('Session Expired', 'Please sign out and log back in.');
        router.replace('/(auth)/login');
        return;
      }
      const user = session.user;

      // 2. Fetch League by Invite Code (Checking both invite_code and code columns)
      const { data: league, error: lookupErr } = await supabase
        .from('leagues')
        .select('id, name, max_size, status')
        .or(`invite_code.eq.${cleanCode},code.eq.${cleanCode}`)
        .maybeSingle();

      if (lookupErr) throw lookupErr;

      if (!league) {
        Alert.alert('Invalid Code', 'No active league was found with that invitation code.');
        return;
      }

      // 3. Execute Validated Join via Postgres RPC
      const { data: joinResult, error: rpcErr } = await supabase.rpc('join_league_with_validation', {
        p_league_id: league.id,
        p_user_id: user.id,
        p_team_name: cleanTeamName,
      });

      if (rpcErr) throw rpcErr;

      // 4. Handle RPC Capacity / Status Rejections
      if (joinResult && !joinResult.success) {
        switch (joinResult.error) {
          case 'LEAGUE_FULL':
            Alert.alert('League Full', `This league has already reached its maximum capacity of ${league.max_size || 8} managers.`);
            return;
          case 'DRAFT_ALREADY_STARTED':
            Alert.alert('Draft In Progress', 'You cannot join this league because the draft has already started or finished.');
            return;
          default:
            Alert.alert('Join Failed', joinResult.error || 'Could not join league.');
            return;
        }
      }

      // 5. Success Notification & Routing
      Alert.alert('Welcome Aboard!', `You have joined "${league.name}" as manager of ${cleanTeamName}.`);
      router.replace('/(tabs)/dashboard');

    } catch (err: any) {
      console.error('Join League Crash:', JSON.stringify(err, null, 2));
      const exactErrorMsg = err?.message || err?.details || err?.hint || JSON.stringify(err);
      Alert.alert('Database Rejection', exactErrorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join Existing League</Text>

      <Text style={styles.label}>Invitation Token</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g., X7K9PL"
        placeholderTextColor="#444"
        value={inviteCode}
        onChangeText={setInviteCode}
        autoCapitalize="characters"
        maxLength={8}
      />

      <Text style={styles.label}>Your Team Name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g., Horsemen of Doom"
        placeholderTextColor="#444"
        value={teamName}
        onChangeText={setTeamName}
        autoCapitalize="words"
      />

      <TouchableOpacity
        style={[styles.btn, loading && styles.btnDisabled]}
        onPress={handleJoinLeague}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#000" size="small" />
        ) : (
          <Text style={styles.btnText}>ENTER LEAGUE</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A', padding: 20, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', color: '#FFF', textTransform: 'uppercase', marginBottom: 20 },
  label: { fontSize: 11, color: '#666', fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  input: { backgroundColor: '#111', borderColor: '#222', borderWidth: 1, color: '#FFF', padding: 14, borderRadius: 2, marginBottom: 16 },
  btn: { backgroundColor: '#00ff87', padding: 16, alignItems: 'center', borderRadius: 2, marginTop: 10 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#000', fontWeight: '900', fontSize: 13 },
});