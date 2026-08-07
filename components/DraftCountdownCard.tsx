import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import { useRouter } from 'expo-router';
import { appColors, appRadius, appSpacing, appTypography } from '@/constants/theme';

interface DraftCountdownCardProps {
  leagueId?: string | null;
}

export default function DraftCountdownCard({ leagueId }: DraftCountdownCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeLid, setActiveLid] = useState<string | null>(null);
  const [targetTime, setTargetTime] = useState<Date | null>(null);
  const [isDraftReady, setIsDraftReady] = useState(false);
  const [timeString, setTimeString] = useState('00d : 00h : 00m : 00s');

  useEffect(() => {
    fetchActiveDraftSchedule();
  }, [leagueId]);

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

      // Resolve League ID (Prop > AsyncStorage)
      let resolvedLeagueId = leagueId;
      if (!resolvedLeagueId) {
        resolvedLeagueId = await AsyncStorage.getItem('active_league_id');
      }

      if (!resolvedLeagueId) {
        setTargetTime(null);
        return;
      }

      setActiveLid(resolvedLeagueId);

      // Fetch draft settings explicitly for this league
      const { data: settings, error } = await supabase
        .from('league_settings')
        .select('draft_start_time')
        .eq('league_id', resolvedLeagueId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching league settings:', error.message);
      }

      if (settings?.draft_start_time) {
        const parsedDate = new Date(settings.draft_start_time);
        setTargetTime(parsedDate);
        if (parsedDate.getTime() - new Date().getTime() <= 0) {
          setIsDraftReady(true);
        } else {
          setIsDraftReady(false);
        }
      } else {
        setTargetTime(null);
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
            onPress={() => router.push({ pathname: '/draft-room', params: { leagueId: activeLid } })}
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
  cardContainer: { minHeight: 142, justifyContent: 'center', padding: appSpacing.xl, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large, alignSelf: 'stretch' },
  heading: { ...appTypography.sectionTitle, color: appColors.textPrimary, fontSize: 14 },
  clockNumbers: { color: appColors.accent, fontSize: 21, fontWeight: '900', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', marginVertical: 10, letterSpacing: 0.8 },
  subtext: { ...appTypography.body, color: appColors.textMuted, lineHeight: 18 },
  subtextCenter: { ...appTypography.body, color: appColors.textSecondary, textAlign: 'center', marginTop: 5, marginBottom: 14 },
  enterRoomButton: { minHeight: 42, backgroundColor: appColors.accent, borderRadius: appRadius.small, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', width: '100%' },
  buttonText: { ...appTypography.label, color: appColors.backgroundDeep }
});
