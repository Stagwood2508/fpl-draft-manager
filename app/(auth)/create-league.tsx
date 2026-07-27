import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../utils/supabase';

export default function CreateLeagueScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [size, setSize] = useState('8');
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreateLeaguePipeline = async () => {
    if (!name.trim()) return;
    
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session framework missing.');

      // 🔍 Fetch user's registered team name from profile metadata to satisfy the constraints
      const { data: profileData, error: pErr } = await supabase
        .from('profiles')
        .select('team_name')
        .eq('id', user.id)
        .single();

      if (pErr) throw new Error('Could not retrieve your manager profile details.');
      const userTeamName = profileData?.team_name || 'Unnamed Team';

      // 💡 Generate unique 6 digit alphanumeric invite token code
      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      const { data: league, error: lErr } = await supabase
        .from('leagues')
        .insert({ name, commissioner_id: user.id, draft_status: 'PRE_DRAFT', invite_code: inviteCode })
        .select().single();

      if (lErr) throw lErr;

      // Seed downstream configurations dependencies automatically with team_name specified
      await supabase.from('league_members').insert({ 
        league_id: league.id, 
        user_id: user.id,
        team_name: userTeamName
      });
      
      await supabase.from('league_settings').insert({ league_id: league.id });

      setCreatedCode(inviteCode);
    } catch (err: any) {
      Alert.alert('Ecosystem Setup Collapse', err.message);
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
          <TextInput style={styles.input} placeholder="e.g., The Elite Draft Group" placeholderTextColor="#444" value={name} onChangeText={setName} />
          
          <Text style={styles.label}>Max Size Constraints</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={size} onChangeText={setSize} />

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

          {/* 🚀 THE BREAKOUT REDIRECT PATHWAY LINK */}
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