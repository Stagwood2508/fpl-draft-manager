import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../utils/supabase';
import { useRouter } from 'expo-router';

export default function DraftCountdownCard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [targetTime, setTargetTime] = useState<Date | null>(null);
  const [isDraftReady, setIsDraftReady] = useState(false);
  const [timeString, setTimeString] = useState('00d : 00h : 00m : 00s');

  useEffect(() => {
    fetchActiveDraftSchedule();
  }, []);

  useEffect(() => {
    if (!targetTime) return;

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const distance = targetTime.getTime() - now;

      if (distance <= 0) {
        clearInterval(interval);
        setIsDraftReady(true);
        setTimeString('00d : 00h : 00m : 00s');
      } else {
        setIsDraftReady(false);
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        setTimeString(
          `${String(days).padStart(2, '0')}d : ${String(hours).padStart(2, '0')}h : ${String(minutes).padStart(2, '0')}m : ${String(seconds).padStart(2, '0')}s`
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [targetTime]);

  const fetchActiveDraftSchedule = async () => {
    try {
      setLoading(true);
      const { data: memberData } = await supabase
        .from('league_members')
        .select('league_id')
        .limit(1)
        .single();

      if (memberData) {
        const { data: settings } = await supabase
          .from('league_settings')
          .select('draft_start_time')
          .eq('league_id', memberData.league_id)
          .single();

        if (settings?.draft_start_time) {
          const parsedDate = new Date(settings.draft_start_time);
          setTargetTime(parsedDate);
          if (parsedDate.getTime() - new Date().getTime() <= 0) {
            setIsDraftReady(true);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching countdown parameters:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.cardContainer}>
        <ActivityIndicator color="#00ff87" />
      </View>
    );
  }

  if (!targetTime) {
    return (
      <View style={styles.cardContainer}>
        <Text style={styles.heading}>Draft Not Scheduled</Text>
        <Text style={styles.subtext}>Your league commissioner hasn't finalized the draft kickoff date yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.cardContainer}>
      {isDraftReady ? (
        <View style={{ width: '100%' }}>
          <Text style={[styles.heading, { color: '#00ff87', textAlign: 'center' }]}>⚡ THE DRAFT IS LIVE!</Text>
          <Text style={styles.subtextCenter}>All managers are gathering in the selector deck room now.</Text>
          <TouchableOpacity 
            style={styles.enterRoomButton}
            onPress={() => router.push('/draft-room')}
          >
            <Text style={styles.buttonText}>ENTER DRAFT ROOM</Text>
            <Ionicons name="flash" size={16} color="#000" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <Text style={styles.heading}>⏳ Scheduled Live Draft Kickoff</Text>
          <Text style={styles.clockNumbers}>{timeString}</Text>
          <Text style={styles.subtext}>Prepare your shortlists. The drafting engine unlocks automatically above.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 16, borderRadius: 6, margin: 16, alignSelf: 'stretch' },
  heading: { color: '#FFF', fontSize: 13, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
  clockNumbers: { color: '#00ff87', fontSize: 20, fontWeight: '900', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', marginVertical: 10, letterSpacing: 1 },
  subtext: { color: '#555', fontSize: 11, fontWeight: '600', lineHeight: 15 },
  subtextCenter: { color: '#AAA', fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 4, marginBottom: 14 },
  enterRoomButton: { backgroundColor: '#00ff87', borderRadius: 4, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', width: '100%' },
  buttonText: { color: '#000', fontSize: 13, fontWeight: '900', textTransform: 'uppercase' }
});