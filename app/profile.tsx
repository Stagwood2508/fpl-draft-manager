import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  Alert, 
  ScrollView 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../utils/supabase';

export default function GenericProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [teamName, setTeamName] = useState('');

  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setEmail(user.email || '');

      // Fetch the manager's current public profile properties (display_name and team_name)
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, team_name')
        .eq('id', user.id)
        .maybeSingle();

      if (profile) {
        setDisplayName(profile.display_name || '');
        setTeamName(profile.team_name || '');
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    try {
      setUpdating(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Commit the public manager nickname change
      const { error: pErr } = await supabase
        .from('profiles')
        .upsert({ id: user.id, display_name: displayName });
      if (pErr) throw pErr;

      // 2. Commit the public team name change
      const { error: tErr } = await supabase
        .from('profiles')
        .upsert({ id: user.id, team_name: teamName });
      if (tErr) throw tErr;

      // 2. Safely commit password updates if string exists
      if (newPassword.trim()) {
        const { error: aErr } = await supabase.auth.updateUser({ password: newPassword });
        if (aErr) throw aErr;
        setNewPassword('');
      }

      Alert.alert('Success', 'Profile settings successfully updated.');
    } catch (err: any) {
      Alert.alert('Update Interrupted', err.message);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00ff87" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeContainer} edges={['top','bottom', 'left', 'right']}>
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>Account Identity</Text>
      
      <View style={styles.card}>
        <Text style={styles.label}>Registered Account Email (Locked)</Text>
        <TextInput style={[styles.input, styles.disabledInput]} value={email} editable={false} />

        <Text style={styles.label}>Manager Nickname</Text>
        <TextInput 
          style={styles.input} 
          value={displayName} 
          onChangeText={setDisplayName} 
          placeholder="e.g., Gaffer Dave" 
          placeholderTextColor="#444" 
        />

        <Text style={styles.label}>Team Name</Text>
        <TextInput 
          style={styles.input} 
          value={teamName} 
          onChangeText={setTeamName} 
          placeholder="e.g., The Red Devils" 
          placeholderTextColor="#444" 
        />

        <Text style={styles.label}>Change Password (Optional)</Text>
        <TextInput 
          style={styles.input} 
          secureTextEntry 
          value={newPassword} 
          onChangeText={setNewPassword} 
          placeholder="Enter a new password" 
          placeholderTextColor="#444" 
        />

        <TouchableOpacity style={styles.btn} onPress={handleUpdateProfile} disabled={updating}>
          <Text style={styles.btnText}>{updating ? 'SAVING CHANGES...' : 'UPDATE PROFILE IDENTITY'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContainer: { flex: 1, backgroundColor: '#0A0A0A' },
container: { flex: 1, backgroundColor: '#0A0A0A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' },
  title: { fontSize: 22, fontWeight: '900', color: '#FFF', textTransform: 'uppercase', marginBottom: 20 },
  card: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 16, borderRadius: 4 },
  label: { fontSize: 11, color: '#666', fontWeight: '800', textTransform: 'uppercase', marginBottom: 6 },
  input: { backgroundColor: '#000', borderColor: '#222', borderWidth: 1, color: '#FFF', padding: 12, borderRadius: 2, marginBottom: 16 },
  disabledInput: { color: '#444', backgroundColor: '#050505' },
  btn: { backgroundColor: '#00ff87', padding: 14, alignItems: 'center', borderRadius: 2, marginTop: 10 },
  btnText: { color: '#000', fontWeight: '900', fontSize: 13 }
});