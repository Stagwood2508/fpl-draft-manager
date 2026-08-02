import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/utils/supabase';

export default function OnboardingScreen() {
  const router = useRouter();

  // 🛡️ Auto-forward if user is already assigned to a league
  useEffect(() => {
    const checkExistingLeague = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

const { data: member } = await supabase
  .from('league_members')
  .select('league_id')
  .eq('user_id', user.id)
  .limit(1) // 👈 Safe query for single or multi-league accounts
  .maybeSingle();

      if (member?.league_id) {
        router.replace('/(tabs)/dashboard');
      }
    };

    checkExistingLeague();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ecosystem Setup</Text>
      <Text style={styles.subtitle}>Initialize your draft framework target</Text>

      <TouchableOpacity 
        style={styles.choiceCard} 
        onPress={() => router.replace('/(auth)/create-league')}
      >
        <Text style={styles.cardTitle}>🏆 CREATE A LEAGUE</Text>
        <Text style={styles.cardSub}>Set up a custom league, adjust configurations, and invite rivals.</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.choiceCard, { borderColor: '#555' }]} 
        onPress={() => router.replace('/(auth)/join-league')}
      >
        <Text style={[styles.cardTitle, { color: '#FFF' }]}>🤝 JOIN A LEAGUE</Text>
        <Text style={styles.cardSub}>Enter an invite code provided by your league commissioner.</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#0A0A0A' },
  title: { fontSize: 24, fontWeight: '900', color: '#fff', textTransform: 'uppercase' },
  subtitle: { fontSize: 13, color: '#00ff87', marginBottom: 40, fontWeight: '600' },
  choiceCard: { backgroundColor: '#111', borderWidth: 1, borderColor: '#00ff87', padding: 20, borderRadius: 4, marginBottom: 16 },
  cardTitle: { color: '#00ff87', fontSize: 16, fontWeight: '900' },
  cardSub: { color: '#666', fontSize: 12, marginTop: 6, lineHeight: 18 }
});