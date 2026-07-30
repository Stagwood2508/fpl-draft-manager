import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/utils/supabase';

export default function CreateLeagueScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [size, setSize] = useState('8');
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreateLeaguePipeline = async () => {
    const cleanName = name.trim();
    const cleanTeamName = teamName.trim();

    if (!cleanName || !cleanTeamName) {
      Alert.alert('Missing Fields', 'Please provide both a League Name and your Team Name.');
      return;
    }

    try {
      setLoading(true);
      
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr || !session?.user) {
        Alert.alert('Session Expired', 'Please sign out and log back in.');
        router.replace('/(auth)/login');
        return;
      }
      const user = session.user;

      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      // 1. Insert new league
      const { data: league, error: lErr } = await supabase
        .from('leagues')
        .insert({ 
          name: cleanName, 
          commissioner_id: user.id, 
          draft_status: 'PRE_DRAFT', 
          invite_code: inviteCode,
          max_size: parseInt(size) || 8
        })
        .select()
        .single();

      if (lErr) throw lErr;
      if (!league) throw new Error('League record could not be generated.');

      // 2. Add commissioner to league_members
      const { error: memberErr } = await supabase
        .from('league_members')
        .insert({ 
          league_id: league.id, 
          user_id: user.id,
          team_name: cleanTeamName
        });

      if (memberErr) {
        if (memberErr.code === '23505') {
          throw new Error('That team name is already taken in this league.');
        }
        throw memberErr;
      }
      
      // 3. Seed configurations
      await supabase.from('league_settings').insert({ league_id: league.id });
      await supabase.from('draft_sessions').insert({
        league_id: league.id,
        draft_status: 'WAITING_ROOM',
        current_round: 1,
        current_pick_index: 1
      });

      setCreatedCode(inviteCode);
    } catch (err: any) {
      console.error('League Creation Crash:', JSON.stringify(err, null, 2));
      const exactErrorMsg = err?.message || err?.details || JSON.stringify(err);
      Alert.alert('Database Rejection', exactErrorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Construct New League</Text>
      
      {!createdCode ? (
        <>
          <Text style={styles.label}>League Name</Text>
          <TextInput 
            style={styles.input} 
            placeholder="e.g., The Elite Draft Group" 
            placeholderTextColor="#444" 
            value={name} 
            onChangeText={setName} 
            autoCapitalize="words"
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
          
          <Text style={styles.label}>Max Size Constraints</Text>
          <TextInput 
            style={styles.input} 
            keyboardType="numeric" 
            value={size} 
            onChangeText={setSize} 
          />

          <TouchableOpacity style={styles.btn} onPress={handleCreateLeaguePipeline} disabled={loading}>
            <Text style={styles.btnText}>{loading ? 'INITIALIZING...' : 'GENERATE LEAGUE'}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.codeContainer}>
          <Text style={styles.successText}>League Created Successfully!</Text>
          <Text style={styles.codeLabel}>YOUR INVITATION CODE</Text>
          <Text style={styles.codeDisplay}>{createdCode}</Text>
          <Text style={styles.hint}>Share this token directly with your rival managers.</Text>

          <TouchableOpacity 
            style={[styles.btn, { marginTop: 30 }]} 
            onPress={() => router.replace('/(tabs)/dashboard')}
          >
            <Text style={styles.btnText}>ENTER MY SQUAD CLUB DASHBOARD</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A', padding: 20, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', color: '#FFF', textTransform: 'uppercase', marginBottom: 20 },
  label: { fontSize: 11, color: '#666', fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  input: { backgroundColor: '#111', borderColor: '#222', borderWidth: 1, color: '#FFF', padding: 14, borderRadius: 2, marginBottom: 16 },
  btn: { backgroundColor: '#00ff87', padding: 16, alignItems: 'center', borderRadius: 2 },
  btnText: { color: '#000', fontWeight: '900', fontSize: 13 },
  codeContainer: { alignItems: 'center', backgroundColor: '#111', padding: 24, borderWidth: 1, borderColor: '#00ff87' },
  successText: { color: '#FFF', fontWeight: '800', fontSize: 16, marginBottom: 16 },
  codeLabel: { color: '#666', fontSize: 10, fontWeight: '800' },
  codeDisplay: { color: '#00ff87', fontSize: 36, fontWeight: '900', letterSpacing: 4, marginVertical: 10 },
  hint: { color: '#444', fontSize: 11, textAlign: 'center', fontWeight: '600' }
});