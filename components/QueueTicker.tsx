import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { supabase } from '../utils/supabase';

interface QueueItem {
  pick_number: number;
  user_id: string;
}

interface QueueTickerProps {
  leagueId: string;
}

export default function QueueTicker({ leagueId }: QueueTickerProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);

  useEffect(() => {
    if (!leagueId) return;

    const fetchDraftQueueOrder = async () => {
      // Pull dynamic layout sequence from league_members or active draft positions registry
      const { data, error } = await supabase
        .from('league_members')
        .select('user_id')
        .eq('league_id', leagueId);

      if (!error && data) {
        // Simulating matching round layout matrices (Snake Draft format reproduction)
        const mockQueueSequence = data.map((member, idx) => ({
          pick_number: idx + 1,
          user_id: member.user_id
        }));
        setQueue(mockQueueSequence);
      }
    };

    fetchDraftQueueOrder();
  }, [leagueId]);

  if (queue.length === 0) return null;

  return (
    <View style={styles.tickerWrapper}>
      <Text style={styles.trackLabel}>UPCOMING SELECTION QUEUE</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollTrack}>
        {queue.map((item, index) => (
          <View key={index} style={[styles.queueCard, index === 0 && styles.queueCardActive]}>
            <Text style={[styles.pickText, index === 0 && styles.pickTextActive]}>
              PK {item.pick_number}
            </Text>
            <Text style={[styles.managerText, index === 0 && styles.managerTextActive]} numberOfLines={1}>
              Mgr ({item.user_id.slice(0, 4)})
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tickerWrapper: { marginVertical: 8, paddingHorizontal: 12 },
  trackLabel: { fontSize: 9, color: '#444', textTransform: 'uppercase', fontWeight: '900', letterSpacing: 0.5, marginBottom: 4, marginLeft: 2 },
  scrollTrack: { flexDirection: 'row' },
  queueCard: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', paddingVertical: 6, paddingHorizontal: 10, marginRight: 6, borderRadius: 2, alignItems: 'center', minWidth: 75 },
  queueCardActive: { borderColor: '#00ff87', backgroundColor: '#14251c' },
  pickText: { color: '#555', fontSize: 10, fontWeight: '800' },
  pickTextActive: { color: '#00ff87' },
  managerText: { color: '#AAA', fontSize: 11, fontWeight: '700', marginTop: 1 },
  // Add this missing class definition to satisfy the TypeScript compiler
  managerTextActive: { color: '#FFF', fontWeight: '900' }
});