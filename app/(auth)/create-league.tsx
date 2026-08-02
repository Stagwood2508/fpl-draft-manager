import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';

// Helper function for web & native alert safety
const notifyUser = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

export default function CreateLeagueScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [size, setSize] = useState('8');
  const [rosterType, setRosterType] = useState<'STRICT' | 'FLEXIBLE'>('STRICT');
  const [createdLeagueId, setCreatedLeagueId] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreateLeaguePipeline = async () => {
    const cleanName = name.trim();
    const cleanTeamName = teamName.trim();

    if (!cleanName || !cleanTeamName) {
      notifyUser('Missing Fields', 'Please provide both a League Name and your Team Name.');
      return;
    }

    try {
      setLoading(true);
      
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr || !session?.user) {
        notifyUser('Session Expired', 'Please sign out and log back in.');
        router.replace('/(auth)/login');
        return;
      }
      const user = session.user;

      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      // 1. Insert into leagues table
      const { data: league, error: lErr } = await supabase
        .from('leagues')
        .insert({ 
          name: cleanName, 
          commissioner_id: user.id, 
          status: 'PRE_DRAFT',
          draft_status: 'WAITING_ROOM', 
          invite_code: inviteCode,
          max_size: parseInt(size, 10) || 8
        })
        .select()
        .single();

      if (lErr) {
        console.error('Error inserting league:', lErr);
        throw lErr;
      }
      if (!league) throw new Error('League record could not be generated.');

      // 2. Add commissioner to league_members
      const { error: memberErr } = await supabase
        .from('league_members')
        .insert({ 
          league_id: league.id, 
          user_id: user.id,
          team_name: cleanTeamName,
          role: 'COMMISSIONER',
          draft_order: 1
        });

      if (memberErr) {
        if (memberErr.code === '23505') {
          throw new Error('That team name is already taken in this league.');
        }
        console.error('Error inserting member:', memberErr);
        throw memberErr;
      }
      
      // 3. Seed Configurations (Saving roster_type choice)
      await supabase.from('league_settings').insert({ 
        league_id: league.id,
        draft_clock_duration: 60,
        roster_type: rosterType
      });

      // 4. Initialize draft session state
      await supabase.from('draft_sessions').insert({
        league_id: league.id,
        draft_status: 'WAITING_ROOM',
        current_round: 1,
        current_pick_index: 1,
        current_picker_id: user.id,
        pick_deadline: new Date().toISOString()
      });

      // 5. 🌟 PERSIST NEW LEAGUE AS ACTIVE IN ASYNC STORAGE & LOCAL STORAGE
      await AsyncStorage.setItem('active_league_id', league.id);
      if (Platform.OS === 'web') {
        window.localStorage.setItem('active_league_id', league.id);
      }

      setCreatedLeagueId(league.id);
      setCreatedCode(inviteCode);
    } catch (err: any) {
      console.error('League Creation Crash:', JSON.stringify(err, null, 2));
      const exactErrorMsg = err?.message || err?.details || err?.hint || JSON.stringify(err);
      notifyUser('Database Rejection', exactErrorMsg);
    } finally {
      setLoading(false);
    }
  };

const handleEnterDashboard = async () => {
  console.log('📌 [DEBUG 1] "ENTER MY SQUAD DASHBOARD" clicked.');
  console.log('📌 [DEBUG 2] createdLeagueId in state:', createdLeagueId);

  if (!createdLeagueId) {
    console.error('❌ [DEBUG ERROR] createdLeagueId is null in state!');
    notifyUser('Navigation Error', 'League ID missing from component state.');
    return;
  }

  try {
    // Write synchronously to both storage mechanisms
    await AsyncStorage.setItem('active_league_id', createdLeagueId);
    if (Platform.OS === 'web') {
      window.localStorage.setItem('active_league_id', createdLeagueId);
    }
    console.log('📌 [DEBUG 3] Successfully wrote active_league_id to storage:', createdLeagueId);

    console.log('📌 [DEBUG 4] Executing router.replace to dashboard...');
    router.replace(`/(tabs)/dashboard?leagueId=${createdLeagueId}`);
  } catch (err: any) {
    console.error('❌ [DEBUG ROUTE ERROR]:', err);
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

          <Text style={styles.label}>Roster Type Strategy</Text>
          <View style={styles.rosterTypeRow}>
            <TouchableOpacity 
              style={[styles.rosterTypeBtn, rosterType === 'STRICT' && styles.rosterTypeBtnActive]}
              onPress={() => setRosterType('STRICT')}
            >
              <Text style={[styles.rosterTypeText, rosterType === 'STRICT' && styles.rosterTypeTextActive]}>
                STRICT (2-5-5-3)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.rosterTypeBtn, rosterType === 'FLEXIBLE' && styles.rosterTypeBtnActive]}
              onPress={() => setRosterType('FLEXIBLE')}
            >
              <Text style={[styles.rosterTypeText, rosterType === 'FLEXIBLE' && styles.rosterTypeTextActive]}>
                FLEXIBLE (OPEN)
              </Text>
            </TouchableOpacity>
          </View>
          
          <Text style={styles.label}>Max Size Constraints</Text>
          <TextInput 
            style={styles.input} 
            keyboardType="numeric" 
            value={size} 
            onChangeText={setSize} 
          />

          <TouchableOpacity 
            style={[styles.btn, loading && styles.btnDisabled]} 
            onPress={handleCreateLeaguePipeline} 
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Text style={styles.btnText}>GENERATE LEAGUE</Text>
            )}
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
            onPress={handleEnterDashboard}
          >
            <Text style={styles.btnText}>ENTER MY SQUAD DASHBOARD</Text>
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
  rosterTypeRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  rosterTypeBtn: { flex: 1, backgroundColor: '#111', borderColor: '#222', borderWidth: 1, padding: 12, alignItems: 'center', borderRadius: 2 },
  rosterTypeBtnActive: { borderColor: '#00ff87', backgroundColor: '#121915' },
  rosterTypeText: { color: '#666', fontSize: 10, fontWeight: '800' },
  rosterTypeTextActive: { color: '#00ff87' },
  btn: { backgroundColor: '#00ff87', padding: 16, alignItems: 'center', borderRadius: 2, marginTop: 10 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#000', fontWeight: '900', fontSize: 13 },
  codeContainer: { alignItems: 'center', backgroundColor: '#111', padding: 24, borderWidth: 1, borderColor: '#00ff87' },
  successText: { color: '#FFF', fontWeight: '800', fontSize: 16, marginBottom: 16 },
  codeLabel: { color: '#666', fontSize: 10, fontWeight: '800' },
  codeDisplay: { color: '#00ff87', fontSize: 36, fontWeight: '900', letterSpacing: 4, marginVertical: 10 },
  hint: { color: '#444', fontSize: 11, textAlign: 'center', fontWeight: '600' }
});