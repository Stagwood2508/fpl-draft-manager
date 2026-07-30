import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { supabase } from '@/utils/supabase';

interface LivePickBannerProps {
  leagueId: string;
}

export default function LivePickBanner({ leagueId }: LivePickBannerProps) {
  const [draftStatus, setDraftStatus] = useState<string>('PRE_DRAFT');
  const [currentManagerName, setCurrentManagerName] = useState<string>('Determining...');
  const [timeLeft, setTimeLeft] = useState<number>(90);

  useEffect(() => {
    if (!leagueId) return;

    // 1. Initial State Fetch
    const fetchInitialDraftState = async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('draft_status, commissioner_id')
        .eq('id', leagueId)
        .single();

      if (!error && data) {
        setDraftStatus(data.draft_status);
        setCurrentManagerName(`Manager ${data.commissioner_id.slice(0, 6)}`);
      }
    };

    fetchInitialDraftState();

    // 2. Real-Time Broadcast Subscriptions
    const leagueSubscription = supabase
      .channel(`public:leagues:id=eq.${leagueId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'leagues', filter: `id=eq.${leagueId}` },
        (payload) => {
          const nextStatus = payload.new.draft_status;
          setDraftStatus(nextStatus);
          setCurrentManagerName(`Manager ${payload.new.commissioner_id.slice(0, 6)}`);
          
          if (nextStatus === 'LIVE') {
            setTimeLeft(90); // Reset timer window on pick turns
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(leagueSubscription);
    };
  }, [leagueId]);

  // 3. Countdown Ticker Interval Engine
  useEffect(() => {
    if (draftStatus !== 'LIVE') return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Time execution threshold collapsed
          return 90; // Autopick trigger fallback would fire on the backend
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [draftStatus]);

  if (draftStatus !== 'LIVE') {
    return null; // Keep screen real estate clear if the engine is dead or paused
  }

  return (
    <View style={styles.bannerContainer}>
      <View style={styles.leftMetaColumn}>
        <View style={styles.liveBadgeRow}>
          <View style={styles.pulseDot} />
          <Text style={styles.liveText}>DRAFT LIVE</Text>
        </View>
        <Text style={styles.managerNameText} numberOfLines={1}>
          ON THE CLOCK: {currentManagerName}
        </Text>
      </View>
      
      <View style={[styles.timerBox, timeLeft <= 15 && styles.timerUrgent]}>
        <Text style={[styles.timerText, timeLeft <= 15 && styles.timerTextUrgent]}>
          {timeLeft}s
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bannerContainer: { flexDirection: 'row', backgroundColor: '#111', borderWidth: 1, borderColor: '#00ff87', padding: 12, borderRadius: 4, marginHorizontal: 12, marginTop: 10, alignItems: 'center', justifyContent: 'space-between' },
  leftMetaColumn: { width: '70%' },
  liveBadgeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ff3b30', marginRight: 6 },
  liveText: { color: '#00ff87', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  managerNameText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  timerBox: { backgroundColor: '#000', borderWidth: 1, borderColor: '#222', width: 54, height: 44, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  timerUrgent: { borderColor: '#ff3b30', backgroundColor: '#2C0D0E' },
  timerText: { color: '#00ff87', fontSize: 16, fontWeight: '900' },
  timerTextUrgent: { color: '#ff453a' }
});