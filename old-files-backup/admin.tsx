import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, LayoutAnimation, Platform, UIManager } from 'react-native';
import { supabase } from './utils/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Player {
  id: string;
  web_name: string;
  team_code: string;
  element_type: number;
}

const POSITION_SHORTS: { [key: number]: string } = {
  1: 'GKP',
  2: 'DEF',
  3: 'MID',
  4: 'FWD'
};
export default function CommissionerDashboard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  
  // Date states
  const [draftDate, setDraftDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState('90');
  
  // Complete Draft FPL custom scoring matrix
  const [points, setPoints] = useState<any>({
    goal_gkp: 6, goal_def: 6, goal_mid: 5, goal_fwd: 4,
    assist: 3, clean_sheet: 4, save_3: 1, pen_save: 5,
    minutes_played_1: 1, minutes_played_60: 2, yellow_card: -1, red_card: -3,
    own_goal: -2, pen_miss: -2, bonus_1: 1, bonus_2: 2, bonus_3: 3,
    goals_conceded_2: -1
  });

  // Position override search list states
  const [players, setPlayers] = useState<Player[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSection, setExpandedSection] = useState<'schedule' | 'scoring' | 'positions' | null>('schedule');

  useEffect(() => {
    loadAdminContext();
  }, []);

  async function loadAdminContext() {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: league, error } = await supabase
        .from('leagues')
        .select('*')
        .eq('commissioner_id', user.id)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!league) {
        Alert.alert('Access Denied', 'Only designated League Commissioners can open this suite.');
        return;
      }

      setLeagueId(league.id);
      setTimerSeconds(String(league.draft_timer_seconds || 90));
      if (league.custom_points_config) {
        setPoints({ ...points, ...league.custom_points_config });
      }
      if (league.draft_datetime) {
        setDraftDate(new Date(league.draft_datetime));
      }

      // Load players for the overrides list tool
      const { data: playersData } = await supabase
        .from('players')
        .select('id, web_name, team_code, element_type')
        .order('web_name', { ascending: true });
      
      setPlayers(playersData || []);

    } catch (err: any) {
      Alert.alert('Loading Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleSection(section: 'schedule' | 'scoring' | 'positions') {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSection(expandedSection === section ? null : section);
  }

  const onChangeDate = (event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      const current = new Date(draftDate);
      current.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
      setDraftDate(current);
      if (Platform.OS === 'android') setShowTimePicker(true);
    }
  };

  const onChangeTime = (event: any, selectedTime?: Date) => {
    setShowTimePicker(false);
    if (selectedTime) {
      const current = new Date(draftDate);
      current.setHours(selectedTime.getHours(), selectedTime.getMinutes());
      setDraftDate(current);
    }
  };

  async function handleUpdatePosition(playerId: string, nextPos: number) {
    try {
      const { error } = await supabase
        .from('players')
        .update({ element_type: nextPos })
        .eq('id', playerId);

      if (error) throw error;

      setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, element_type: nextPos } : p));
    } catch (err: any) {
      Alert.alert('Position Shift Rejection', err.message);
    }
  }

  async function saveSettings() {
    if (!leagueId) return;
    try {
      setSaving(true);
      const { error } = await supabase
        .from('leagues')
        .update({
          draft_datetime: draftDate.toISOString(),
          draft_timer_seconds: parseInt(timerSeconds, 10),
          custom_points_config: points
        })
        .eq('id', leagueId);

      if (error) throw error;
      Alert.alert('Success! 🛡️', 'Settings saved. All active managers will be dragged into the draft at the set time.');
    } catch (err: any) {
      Alert.alert('Update Failed', err.message);
    } finally {
      setSaving(false);
    }
  }

  const filteredPlayers = players.filter(p => 
    p.web_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.team_code.toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(0, 5);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color="#00ff87" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.headerTitle}>👑 Commissioner Dashboard</Text>
        <Text style={styles.subtitleText}>Manage schedule benchmarks, team rules, and full FPL weight scoring systems.</Text>

        {/* 📅 ACCORDION 1: DRAFT DATE CALENDAR */}
        <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection('schedule')}>
          <Text style={styles.accordionTitle}>📅 1. Calendar Schedule & Pick Timers</Text>
          <Text style={styles.arrowIcon}>{expandedSection === 'schedule' ? '▼' : '▶'}</Text>
        </TouchableOpacity>
        
        {expandedSection === 'schedule' && (
          <View style={styles.accordionContent}>
            <Text style={styles.fieldLabel}>CHOOSE DRAFT EVENT TIMESTAMP</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginVertical: 6 }}>
              <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowDatePicker(true)}>
                <Text style={styles.pickerBtnText}>📅 {draftDate.toLocaleDateString()}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTimePicker(true)}>
                <Text style={styles.pickerBtnText}>⏰ {draftDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</Text>
              </TouchableOpacity>
            </View>

            {showDatePicker && (
              <DateTimePicker value={draftDate} mode="date" display="calendar" onChange={onChangeDate} />
            )}
            {showTimePicker && (
              <DateTimePicker value={draftDate} mode="time" display="clock" is24Hour={true} onChange={onChangeTime} />
            )}

            <Text style={styles.fieldLabel}>TURN TIMER DURATION (SECONDS)</Text>
            <TextInput
              style={styles.input}
              value={timerSeconds}
              onChangeText={setTimerSeconds}
              keyboardType="number-pad"
              placeholder="90"
              placeholderTextColor="#555"
            />
          </View>
        )}

        {/* 🔢 ACCORDION 2: FULL COMPREHENSIVE SCORING MATRIX */}
        <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection('scoring')}>
          <Text style={styles.accordionTitle}>🔢 2. Comprehensive Point Overrides</Text>
          <Text style={styles.arrowIcon}>{expandedSection === 'scoring' ? '▼' : '▶'}</Text>
        </TouchableOpacity>

        {expandedSection === 'scoring' && (
          <View style={styles.accordionContent}>
            <Text style={styles.sectionDividerLabel}>GOALS & ASSISTS</Text>
            <View style={styles.gridRow}><View style={styles.gridCol}><Text style={styles.fieldLabel}>GKP GOAL</Text><TextInput style={styles.input} value={String(points.goal_gkp)} onChangeText={(t)=>setPoints({...points, goal_gkp: parseInt(t,10)||0})} keyboardType="numeric"/></View><View style={styles.gridCol}><Text style={styles.fieldLabel}>DEF GOAL</Text><TextInput style={styles.input} value={String(points.goal_def)} onChangeText={(t)=>setPoints({...points, goal_def: parseInt(t,10)||0})} keyboardType="numeric"/></View></View>
            <View style={styles.gridRow}><View style={styles.gridCol}><Text style={styles.fieldLabel}>MID GOAL</Text><TextInput style={styles.input} value={String(points.goal_mid)} onChangeText={(t)=>setPoints({...points, goal_mid: parseInt(t,10)||0})} keyboardType="numeric"/></View><View style={styles.gridCol}><Text style={styles.fieldLabel}>FWD GOAL</Text><TextInput style={styles.input} value={String(points.goal_fwd)} onChangeText={(t)=>setPoints({...points, goal_fwd: parseInt(t,10)||0})} keyboardType="numeric"/></View></View>
            <View style={styles.gridRow}><View style={styles.gridCol}><Text style={styles.fieldLabel}>ASSIST</Text><TextInput style={styles.input} value={String(points.assist)} onChangeText={(t)=>setPoints({...points, assist: parseInt(t,10)||0})} keyboardType="numeric"/></View><View style={styles.gridCol}><Text style={styles.fieldLabel}>CLEAN SHEET</Text><TextInput style={styles.input} value={String(points.clean_sheet)} onChangeText={(t)=>setPoints({...points, clean_sheet: parseInt(t,10)||0})} keyboardType="numeric"/></View></View>

            <Text style={styles.sectionDividerLabel}>PLAYING TIME & DISCIPLINE</Text>
            <View style={styles.gridRow}><View style={styles.gridCol}><Text style={styles.fieldLabel}>MINS (1-59)</Text><TextInput style={styles.input} value={String(points.minutes_played_1 || 1)} onChangeText={(t)=>setPoints({...points, minutes_played_1: parseInt(t,10)||0})} keyboardType="numeric"/></View><View style={styles.gridCol}><Text style={styles.fieldLabel}>MINS (60+)</Text><TextInput style={styles.input} value={String(points.minutes_played_60 || 2)} onChangeText={(t)=>setPoints({...points, minutes_played_60: parseInt(t,10)||0})} keyboardType="numeric"/></View></View>
            <View style={styles.gridRow}><View style={styles.gridCol}><Text style={styles.fieldLabel}>YELLOW CARD</Text><TextInput style={styles.input} value={String(points.yellow_card || -1)} onChangeText={(t)=>setPoints({...points, yellow_card: parseInt(t,10)||0})} keyboardType="numeric"/></View><View style={styles.gridCol}><Text style={styles.fieldLabel}>RED CARD</Text><TextInput style={styles.input} value={String(points.red_card || -3)} onChangeText={(t)=>setPoints({...points, red_card: parseInt(t,10)||0})} keyboardType="numeric"/></View></View>

            <Text style={styles.sectionDividerLabel}>GK ACTIONS & ERRORS</Text>
            <View style={styles.gridRow}><View style={styles.gridCol}><Text style={styles.fieldLabel}>3x SAVES BADGE</Text><TextInput style={styles.input} value={String(points.save_3 || 1)} onChangeText={(t)=>setPoints({...points, save_3: parseInt(t,10)||0})} keyboardType="numeric"/></View><View style={styles.gridCol}><Text style={styles.fieldLabel}>PENALTY SAVE</Text><TextInput style={styles.input} value={String(points.pen_save || 5)} onChangeText={(t)=>setPoints({...points, pen_save: parseInt(t,10)||0})} keyboardType="numeric"/></View></View>
            <View style={styles.gridRow}><View style={styles.gridCol}><Text style={styles.fieldLabel}>OWN GOAL</Text><TextInput style={styles.input} value={String(points.own_goal || -2)} onChangeText={(t)=>setPoints({...points, own_goal: parseInt(t,10)||0})} keyboardType="numeric"/></View><View style={styles.gridCol}><Text style={styles.fieldLabel}>PENALTY MISS</Text><TextInput style={styles.input} value={String(points.pen_miss || -2)} onChangeText={(t)=>setPoints({...points, pen_miss: parseInt(t,10)||0})} keyboardType="numeric"/></View></View>

            <Text style={styles.sectionDividerLabel}>BONUS POINTS</Text>
            <View style={styles.gridRow}><View style={styles.gridCol}><Text style={styles.fieldLabel}>1 BONUS</Text><TextInput style={styles.input} value={String(points.bonus_1 || 1)} onChangeText={(t)=>setPoints({...points, bonus_1: parseInt(t,10)||0})} keyboardType="numeric"/></View><View style={styles.gridCol}><Text style={styles.fieldLabel}>2 BONUS</Text><TextInput style={styles.input} value={String(points.bonus_2 || 2)} onChangeText={(t)=>setPoints({...points, bonus_2: parseInt(t,10)||0})} keyboardType="numeric"/></View><View style={styles.gridCol}><Text style={styles.fieldLabel}>3 BONUS</Text><TextInput style={styles.input} value={String(points.bonus_3 || 3)} onChangeText={(t)=>setPoints({...points, bonus_3: parseInt(t,10)||0})} keyboardType="numeric"/></View></View>
          </View>
        )}

        {/* 🔁 ACCORDION 3: REAL-TIME POSITION SHIFT MODULE */}
        <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection('positions')}>
          <Text style={styles.accordionTitle}>🔁 3. Shift Player Position Labels</Text>
          <Text style={styles.arrowIcon}>{expandedSection === 'positions' ? '▼' : '▶'}</Text>
        </TouchableOpacity>

        {expandedSection === 'positions' && (
          <View style={styles.accordionContent}>
            <TextInput
              style={[styles.input, { marginBottom: 12 }]}
              placeholder="Type player name to change position..."
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.trim().length > 0 && filteredPlayers.map(player => (
              <View key={player.id} style={styles.overrideRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>{player.web_name}</Text>
                  <Text style={{ color: '#666', fontSize: 11 }}>{player.team_code}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {[1, 2, 3, 4].map(pos => (
                    <TouchableOpacity
                      key={pos}
                      style={[styles.posButton, player.element_type === pos && styles.posButtonActive]}
                      onPress={() => handleUpdatePosition(player.id, pos)}
                    >
                      <Text style={[styles.posButtonText, player.element_type === pos && styles.posButtonTextActive]}>
                        {POSITION_SHORTS[pos]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* PERSIST LAWS TRANSACTION */}
        <TouchableOpacity style={styles.saveBtn} onPress={saveSettings} disabled={saving}>
          <Text style={styles.saveBtnText}>{saving ? 'Saving System Regulations...' : 'Save Global Regulations'}</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#121212' },
  container: { flex: 1, padding: 16 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  subtitleText: { fontSize: 13, color: '#888', marginBottom: 20 },
  accordionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1e1e1e', padding: 14, borderRadius: 6, marginTop: 8, borderWidth: 1, borderColor: '#2d2d2d' },
  accordionTitle: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  arrowIcon: { color: '#00ff87', fontSize: 12 },
  accordionContent: { backgroundColor: '#161616', padding: 16, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, borderWidth: 1, borderColor: '#2d2d2d', borderTopWidth: 0, marginBottom: 4 },
  fieldLabel: { color: '#666', fontSize: 10, fontWeight: 'bold', letterSpacing: 0.5, marginBottom: 4, marginTop: 8 },
  sectionDividerLabel: { color: '#00ff87', fontSize: 11, fontWeight: 'bold', marginTop: 14, borderBottomWidth: 1, borderBottomColor: '#222', paddingBottom: 4 },
  input: { backgroundColor: '#222', color: '#fff', height: 42, borderRadius: 6, paddingHorizontal: 12, fontSize: 13, borderWidth: 1, borderColor: '#333', marginTop: 2 },
  pickerBtn: { flex: 1, backgroundColor: '#222', borderWidth: 1, borderColor: '#333', height: 44, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  pickerBtnText: { color: '#00ff87', fontWeight: '600', fontSize: 13 },
  gridRow: { flexDirection: 'row', gap: 12 },
  gridCol: { flex: 1 },
  overrideRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#222', padding: 10, borderRadius: 6, marginTop: 6, borderWidth: 1, borderColor: '#2d2d2d' },
  posButton: { backgroundColor: '#161616', paddingHorizontal: 6, paddingVertical: 6, borderRadius: 4, borderWidth: 1, borderColor: '#333', minWidth: 40, alignItems: 'center' },
  posButtonActive: { backgroundColor: '#00ff87', borderColor: '#00ff87' },
  posButtonText: { color: '#666', fontSize: 10, fontWeight: 'bold' },
  posButtonTextActive: { color: '#121212' },
  saveBtn: { backgroundColor: '#00ff87', height: 48, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 28 },
  saveBtnText: { color: '#121212', fontSize: 15, fontWeight: 'bold' }
});