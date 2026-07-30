import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { supabase } from '@/utils/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

interface LeagueSettings {
  draft_clock_duration: number;
  draft_start_time: string | null;
  points_goal_fwd: number;
  points_goal_mid: number;
  points_goal_def: number;
  points_assist: number;
  points_clean_sheet_def: number;
  points_clean_sheet_mid: number;
  points_yellow_card: number;
  points_red_card: number;
  points_own_goal: number;
  points_penalty_save: number;
  points_penalty_miss: number;
}

interface PlayerSearchTarget {
  id: string;
  web_name: string;
  team_name: string;
  element_type: string;
}

interface TierSetting {
  tier: number;
  threshold: number;
  points: number;
}

export default function UnifiedLeagueSettingsScreen() {
  const scrollRef = useRef<ScrollView>(null);
  const searchInputY = useRef<number>(0);

  const [loading, setLoading] = useState(true);
  const [savingMatrix, setSavingMatrix] = useState(false);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [leagueName, setLeagueName] = useState<string>('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  
  // Roster Limits Configuration State
  const [rosterType, setRosterType] = useState<'STRICT' | 'FLEXIBLE'>('STRICT');

  // Draft Lifecycle Lock State
  const [draftStatus, setDraftStatus] = useState<'PRE_DRAFT' | 'DRAFTING' | 'COMPLETED' | string>('PRE_DRAFT');

  const [attackingExpanded, setAttackingExpanded] = useState(false);
  const [disciplinaryExpanded, setDisciplinaryExpanded] = useState(false);
  const [defconExpanded, setDefconExpanded] = useState(false);

  const [settings, setSettings] = useState<LeagueSettings | null>(null);

  // INLINE GRID SELECTION WHEELS TIME HUB STATES
  const [schedYear, setSchedYear] = useState(2026);
  const [schedMonth, setSchedMonth] = useState(8); 
  const [schedDay, setSchedDay] = useState(1);
  const [schedHour, setSchedHour] = useState(19);
  const [schedMinute, setSchedMinute] = useState(0);

  const [defTiers, setDefTiers] = useState<TierSetting[]>([]);
  const [midTiers, setMidTiers] = useState<TierSetting[]>([]);
  const [fwdTiers, setFwdTiers] = useState<TierSetting[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [masterCachePlayers, setMasterCachePlayers] = useState<PlayerSearchTarget[]>([]);
  const [liveSuggestions, setLiveSuggestions] = useState<PlayerSearchTarget[]>([]);
  const [selectedWorkbenchPlayer, setSelectedWorkbenchPlayer] = useState<PlayerSearchTarget | null>(null);

  const [positionOverrides, setPositionOverrides] = useState<Record<string, string>>({});
  const [savingPositionId, setSavingPositionId] = useState<string | null>(null);

  const clockOptions = [30, 60, 90];
  const positionOptions = ['GKP', 'DEF', 'MID', 'FWD'];

  // Universal Season Lock Helper
  const isLocked = draftStatus !== 'PRE_DRAFT';

  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  useEffect(() => {
    loadMasterSettingsFramework();
  }, []);

  useEffect(() => {
    if (!searchQuery.trim() || isLocked) {
      setLiveSuggestions([]);
      return;
    }
    const matches = masterCachePlayers
      .filter(p => p.web_name.toLowerCase().includes(searchQuery.toLowerCase()))
      .slice(0, 15);
    setLiveSuggestions(matches);
  }, [searchQuery, masterCachePlayers, isLocked]);

  const createDefaultTiers = (): TierSetting[] => [
    { tier: 1, threshold: 4, points: 1 },
    { tier: 2, threshold: 7, points: 2 },
    { tier: 3, threshold: 10, points: 3 },
  ];

  const loadMasterSettingsFramework = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: memberData, error: memErr } = await supabase
        .from('league_members')
        .select('league_id, leagues(name, invite_code, commissioner_id, roster_type, draft_status, status)')
        .eq('user_id', user.id)
        .limit(1)
        .single();

      if (memErr) throw memErr;
      if (!memberData) return;

      const league = memberData.leagues as any;
      setLeagueId(memberData.league_id);
      setLeagueName(league.name || 'Your League');
      setInviteCode(league.invite_code || null);
      setIsCommissioner(league.commissioner_id === user.id);

      if (league.roster_type) {
        setRosterType(league.roster_type as 'STRICT' | 'FLEXIBLE');
      }

      const activeStatus = league.draft_status || league.status || 'PRE_DRAFT';
      setDraftStatus(activeStatus);

      const { data: settingsData } = await supabase
        .from('league_settings')
        .select('*')
        .eq('league_id', memberData.league_id)
        .maybeSingle();

      if (settingsData) {
        setSettings(settingsData as LeagueSettings);
        setDefTiers(settingsData.defcon_thresholds_def || createDefaultTiers());
        setMidTiers(settingsData.defcon_thresholds_mid || createDefaultTiers());
        setFwdTiers(settingsData.defcon_thresholds_fwd || createDefaultTiers());

        if (settingsData.draft_start_time) {
          const [datePart, timePart] = settingsData.draft_start_time.split('T');
          const [yr, mo, dy] = datePart.split('-');
          const [hr, mn] = timePart.split(':');

          setSchedYear(parseInt(yr, 10));
          setSchedMonth(parseInt(mo, 10));
          setSchedDay(parseInt(dy, 10));
          setSchedHour(parseInt(hr, 10));
          setSchedMinute(parseInt(mn, 10));
        }
      } else {
        setDefTiers(createDefaultTiers());
        setMidTiers(createDefaultTiers());
        setFwdTiers(createDefaultTiers());
      }

      const { data: existingOverrides } = await supabase
        .from('league_player_overrides')
        .select('player_id, custom_position')
        .eq('league_id', memberData.league_id);

      if (existingOverrides) {
        const overrideMap: Record<string, string> = {};
        existingOverrides.forEach(o => {
          overrideMap[o.player_id] = o.custom_position;
        });
        setPositionOverrides(overrideMap);
      }

      const { data: playersDb } = await supabase
        .from('players')
        .select('id, web_name, team_name, element_type');
      if (playersDb) setMasterCachePlayers(playersDb as any);
    } catch (err: any) {
      console.error('[SETTINGS BOOT FAULT]', err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyInviteToken = () => {
    if (!inviteCode) return;
    
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(inviteCode);
    }
    
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2500);
    Alert.alert('Invite Token Copied! 📋', `Code: ${inviteCode}\nShare this token with managers to join ${leagueName}.`);
  };

  const handleUpdateFieldState = (key: keyof LeagueSettings, value: any) => {
    if (!settings || isLocked) return;
    setSettings({ ...settings, [key]: value });
  };

  const handleUpdateTier = (position: 'DEF' | 'MID' | 'FWD', index: number, field: 'threshold' | 'points', value: string) => {
    if (isLocked) return;
    const numericValue = parseInt(value, 10) || 0;
    if (position === 'DEF') {
      const updated = [...defTiers]; updated[index][field] = numericValue; setDefTiers(updated);
    } else if (position === 'MID') {
      const updated = [...midTiers]; updated[index][field] = numericValue; setMidTiers(updated);
    } else if (position === 'FWD') {
      const updated = [...fwdTiers]; updated[index][field] = numericValue; setFwdTiers(updated);
    }
  };

  const tweakTimeValue = (field: 'DAY' | 'MONTH' | 'HOUR' | 'MIN', delta: number) => {
    if (isLocked) return;
    if (field === 'DAY') {
      setSchedDay(prev => Math.max(1, Math.min(31, prev + delta)));
    } else if (field === 'MONTH') {
      setSchedMonth(prev => Math.max(1, Math.min(12, prev + delta)));
    } else if (field === 'HOUR') {
      setSchedHour(prev => (prev + delta + 24) % 24);
    } else if (field === 'MIN') {
      setSchedMinute(prev => (prev + delta + 60) % 60);
    }
  };

  const handleSaveAllSettingsMatrix = async () => {
    if (!leagueId || !isCommissioner || !settings) return;

    if (isLocked) {
      Alert.alert('Settings Locked 🔒', 'League rules and scoring settings are locked for the season once drafting begins.');
      return;
    }

    try {
      setSavingMatrix(true);
      
      const mm = String(schedMonth).padStart(2, '0');
      const dd = String(schedDay).padStart(2, '0');
      const hh = String(schedHour).padStart(2, '0');
      const min = String(schedMinute).padStart(2, '0');
      
      const localTimestampString = `${schedYear}-${mm}-${dd}T${hh}:${min}:00`;

      // 1. Update LEAGUES table directly with roster_type
      const { error: leagueErr } = await supabase
        .from('leagues')
        .update({ roster_type: rosterType })
        .eq('id', leagueId);

      if (leagueErr) {
        console.error('Leagues Table Update Error:', leagueErr);
        throw new Error(`Failed to update roster mode: ${leagueErr.message}`);
      }

      // 2. Upsert LEAGUE_SETTINGS table
      const payload = {
        league_id: leagueId,
        ...settings,
        draft_start_time: localTimestampString, 
        defcon_thresholds_def: defTiers,
        defcon_thresholds_mid: midTiers,
        defcon_thresholds_fwd: fwdTiers,
        updated_at: new Date().toISOString()
      };

      const { error: settingsErr } = await supabase
        .from('league_settings')
        .upsert(payload, { onConflict: 'league_id' });

      if (settingsErr) {
        console.error('League Settings Upsert Error:', settingsErr);
        throw new Error(`Failed to save scoring rules: ${settingsErr.message}`);
      }
      
      setSettings(payload);
      Alert.alert('Configuration Saved 🎉', 'All scoring variables, roster limits, and draft timetables successfully committed.');
    } catch (err: any) {
      console.error('Full Settings Save Crash:', err);
      Alert.alert('Save Interrupted', err.message || 'An unexpected error occurred during save.');
    } finally {
      setSavingMatrix(false);
    }
  };

  const handleCommitPositionOverride = async (playerId: string, targetPosition: string) => {
    if (!leagueId || !isCommissioner) return;

    if (isLocked) {
      Alert.alert(
        'Settings Locked 🔒',
        'Player position overrides are locked once the draft process begins or completes.'
      );
      return;
    }

    try {
      setSavingPositionId(playerId);
      const { error } = await supabase
        .from('league_player_overrides')
        .upsert(
          { league_id: leagueId, player_id: parseInt(playerId, 10), custom_position: targetPosition },
          { onConflict: 'league_id,player_id' }
        );

      if (error) throw error;
      setPositionOverrides(prev => ({ ...prev, [playerId]: targetPosition }));

      if (selectedWorkbenchPlayer && selectedWorkbenchPlayer.id === playerId) {
        setSelectedWorkbenchPlayer({ ...selectedWorkbenchPlayer, element_type: targetPosition });
      }
      Alert.alert('Position Overridden 🎯', `Updated position to ${targetPosition}.`);
    } catch (err: any) {
      Alert.alert('Override Interrupted', err.message);
    } finally {
      setSavingPositionId(null);
    }
  };

  const scrollToSearchInput = () => {
    setTimeout(() => { scrollRef.current?.scrollTo({ y: searchInputY.current - 20, animated: true }); }, 100);
  };

  const renderPositionTierRows = (label: string, posKey: 'DEF' | 'MID' | 'FWD', list: TierSetting[]) => {
    const safeList = Array.isArray(list) ? list : [];
    return (
      <View style={styles.positionSubBlock}>
        <Text style={styles.positionSubHeader}>{label}</Text>
        {safeList.map((t, idx) => (
          <View key={idx} style={styles.tierGridRow}>
            <Text style={styles.tierNumberLabel}>Tier {t.tier}</Text>
            <View style={styles.inputWrapperSmall}>
              <Text style={styles.miniLabel}>Actions Req.</Text>
              <TextInput 
                style={[styles.tierInput, isLocked && styles.disabledInput]} 
                keyboardType="numeric" 
                editable={!isLocked}
                value={String(t.threshold ?? 0)} 
                onChangeText={(val) => handleUpdateTier(posKey, idx, 'threshold', val)} 
              />
            </View>
            <View style={styles.inputWrapperSmall}>
              <Text style={styles.miniLabel}>Points</Text>
              <TextInput 
                style={[styles.tierInput, isLocked && styles.disabledInput]} 
                keyboardType="numeric" 
                editable={!isLocked}
                value={String(t.points ?? 0)} 
                onChangeText={(val) => handleUpdateTier(posKey, idx, 'points', val)} 
              />
            </View>
          </View>
        ))}
      </View>
    );
  };

  if (loading) return <View style={styles.centered}><ActivityIndicator size="large" color="#00ff87" /></View>;

  const activeWorkbenchPosition = selectedWorkbenchPlayer ? (positionOverrides[selectedWorkbenchPlayer.id] || selectedWorkbenchPlayer.element_type) : '';

  return (
    <SafeAreaView style={styles.safeContainer} edges={['top','bottom', 'left', 'right']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          
          {/* SCREEN HEADER ROW */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={styles.title}>League Settings</Text>
            {isLocked && (
              <View style={styles.lockedGlobalBadge}>
                <Text style={styles.lockedGlobalBadgeText}>🔒 SEASON LOCKED</Text>
              </View>
            )}
          </View>

          {/* COMMISSIONER LEAGUE INVITATION DECK */}
          {inviteCode && (
            <View style={styles.inviteDeckCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inviteDeckHeading}>🔑 League Invitation Token</Text>
                  <Text style={styles.inviteDeckSub}>Share this token with new managers to join {leagueName}</Text>
                </View>
                <TouchableOpacity style={styles.copyTokenBtn} onPress={copyInviteToken}>
                  <Ionicons name={copiedToken ? "checkmark-circle" : "copy-outline"} size={16} color={copiedToken ? "#00ff87" : "#000"} />
                  <Text style={styles.copyTokenBtnText}>{copiedToken ? 'COPIED' : 'COPY CODE'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.inviteCodeDisplayRow}>
                <Text style={styles.inviteCodeText}>{inviteCode}</Text>
              </View>
            </View>
          )}

          {/* BLOCK 1: DRAFT & ROSTER OPERATION RULESET */}
          <View style={styles.sectionCard}>
            
            {/* ROSTER COMPOSITION TYPE */}
            <Text style={styles.sectionHeading}>📋 Squad Roster Limits</Text>
            <Text style={styles.sectionSub}>
              {rosterType === 'STRICT' 
                ? 'Strict Mode: Fixed 2 GKP, 5 DEF, 5 MID, 3 FWD (Requires 1-to-1 position swaps).'
                : 'Flexible Mode: Fixed 2 GKP, flexible 4–6 DEF, 4–6 MID, 2–4 FWD composition.'}
            </Text>
            <View style={[styles.segmentedControlGroup, isLocked && { opacity: 0.5 }]}>
              <TouchableOpacity
                disabled={isLocked}
                style={[styles.segmentBtn, rosterType === 'STRICT' && styles.segmentBtnActive]}
                onPress={() => setRosterType('STRICT')}
              >
                <Text style={[styles.segmentText, rosterType === 'STRICT' && styles.segmentTextActive]}>Strict (5-5-3)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                disabled={isLocked}
                style={[styles.segmentBtn, rosterType === 'FLEXIBLE' && styles.segmentBtnActive]}
                onPress={() => setRosterType('FLEXIBLE')}
              >
                <Text style={[styles.segmentText, rosterType === 'FLEXIBLE' && styles.segmentTextActive]}>Flexible (4–6)</Text>
              </TouchableOpacity>
            </View>

            {/* DRAFT CLOCK DURATION */}
            <Text style={[styles.sectionHeading, { marginTop: 24 }]}>Draft Clock Turn Duration</Text>
            <Text style={styles.sectionSub}>Allocated countdown pick window before automatic bypass selection triggers.</Text>
            <View style={[styles.segmentedControlGroup, isLocked && { opacity: 0.5 }]}>
              {clockOptions.map((opt) => (
                <TouchableOpacity 
                  key={opt} 
                  disabled={isLocked}
                  style={[styles.segmentBtn, settings?.draft_clock_duration === opt && styles.segmentBtnActive]}
                  onPress={() => handleUpdateFieldState('draft_clock_duration', opt)}
                >
                  <Text style={[styles.segmentText, settings?.draft_clock_duration === opt && styles.segmentTextActive]}>{opt}s</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* SCHEDULE DRAFT MODULE */}
            <Text style={[styles.sectionHeading, { marginTop: 24 }]}>📅 Scheduled Draft Timing Setup</Text>
            <Text style={styles.sectionSub}>
              {isLocked 
                ? 'Draft timing is locked for the season.'
                : 'Tap arrows to increment parameters directly. Must click master save button at the bottom to finalize changes.'}
            </Text>
            
            <View style={[styles.wheelSelectionDeckRow, isLocked && { opacity: 0.4 }]}>
              <View style={styles.wheelItemColumn}>
                <TouchableOpacity disabled={isLocked} style={styles.wheelArrowBtn} onPress={() => tweakTimeValue('DAY', 1)}>
                  <Ionicons name="chevron-up" size={14} color="#00ff87" />
                </TouchableOpacity>
                <View style={styles.wheelNumericDisplayBox}>
                  <Text style={styles.wheelMainText}>{String(schedDay).padStart(2, '0')}</Text>
                  <Text style={styles.wheelSubLabel}>DAY</Text>
                </View>
                <TouchableOpacity disabled={isLocked} style={styles.wheelArrowBtn} onPress={() => tweakTimeValue('DAY', -1)}>
                  <Ionicons name="chevron-down" size={14} color="#666" />
                </TouchableOpacity>
              </View>

              <View style={styles.wheelItemColumn}>
                <TouchableOpacity disabled={isLocked} style={styles.wheelArrowBtn} onPress={() => tweakTimeValue('MONTH', 1)}>
                  <Ionicons name="chevron-up" size={14} color="#00ff87" />
                </TouchableOpacity>
                <View style={styles.wheelNumericDisplayBox}>
                  <Text style={styles.wheelMainText}>{monthNames[schedMonth - 1]}</Text>
                  <Text style={styles.wheelSubLabel}>MONTH</Text>
                </View>
                <TouchableOpacity disabled={isLocked} style={styles.wheelArrowBtn} onPress={() => tweakTimeValue('MONTH', -1)}>
                  <Ionicons name="chevron-down" size={14} color="#666" />
                </TouchableOpacity>
              </View>

              <Text style={styles.deckMatrixDividerText}>@</Text>

              <View style={styles.wheelItemColumn}>
                <TouchableOpacity disabled={isLocked} style={styles.wheelArrowBtn} onPress={() => tweakTimeValue('HOUR', 1)}>
                  <Ionicons name="chevron-up" size={14} color="#00ff87" />
                </TouchableOpacity>
                <View style={styles.wheelNumericDisplayBox}>
                  <Text style={styles.wheelMainText}>{String(schedHour).padStart(2, '0')}</Text>
                  <Text style={styles.wheelSubLabel}>HOUR</Text>
                </View>
                <TouchableOpacity disabled={isLocked} style={styles.wheelArrowBtn} onPress={() => tweakTimeValue('HOUR', -1)}>
                  <Ionicons name="chevron-down" size={14} color="#666" />
                </TouchableOpacity>
              </View>

              <Text style={styles.deckTimeColonSymbol}>:</Text>

              <View style={styles.wheelItemColumn}>
                <TouchableOpacity disabled={isLocked} style={styles.wheelArrowBtn} onPress={() => tweakTimeValue('MIN', 5)}>
                  <Ionicons name="chevron-up" size={14} color="#00ff87" />
                </TouchableOpacity>
                <View style={styles.wheelNumericDisplayBox}>
                  <Text style={styles.wheelMainText}>{String(schedMinute).padStart(2, '0')}</Text>
                  <Text style={styles.wheelSubLabel}>MIN</Text>
                </View>
                <TouchableOpacity disabled={isLocked} style={styles.wheelArrowBtn} onPress={() => tweakTimeValue('MIN', -5)}>
                  <Ionicons name="chevron-down" size={14} color="#666" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* BLOCK 2: TACTICAL POSITION OVERRIDES HUB */}
          <View style={styles.sectionCard} onLayout={(e) => { searchInputY.current = e.nativeEvent.layout.y; }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.sectionHeading}>👤 Player Position Remapping Desk</Text>
              {isLocked && (
                <View style={styles.lockedSectionBadge}>
                  <Text style={styles.lockedSectionBadgeText}>🔒 LOCKED</Text>
                </View>
              )}
            </View>

            <Text style={styles.sectionSub}>
              {!isLocked
                ? 'Force positional shifts onto specific players dynamically before draft kickoff.'
                : 'Position overrides are locked for the season because the draft has already commenced or completed.'}
            </Text>

            {!isLocked ? (
              <>
                <View style={styles.searchRow}>
                  <View style={{ flex: 1, position: 'relative' }}>
                    <TextInput 
                      style={styles.searchInput} 
                      placeholder="Type player name to trigger automatic suggestions..." 
                      placeholderTextColor="#444" 
                      value={searchQuery} 
                      onChangeText={setSearchQuery} 
                      onFocus={scrollToSearchInput} 
                    />
                    {liveSuggestions.length > 0 && (
                      <View style={styles.suggestionsDropdownWrapper}>
                        <ScrollView nestedScrollEnabled={true} style={{ maxHeight: 150 }} keyboardShouldPersistTaps="handled">
                          {liveSuggestions.map((player) => (
                            <TouchableOpacity 
                              key={player.id} 
                              style={styles.dropdownOptionRow} 
                              onPress={() => { setSelectedWorkbenchPlayer(player); setSearchQuery(''); }}
                            >
                              <Text style={styles.dropdownOptionText}>
                                {player.web_name} <Text style={styles.dropdownOptionSub}>({player.team_name})</Text>
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                  </View>
                </View>

                {selectedWorkbenchPlayer && (
                  <View style={styles.playerRow}>
                    <View style={{ width: '42%' }}>
                      <Text style={styles.playerName} numberOfLines={1}>{selectedWorkbenchPlayer.web_name}</Text>
                      <Text style={styles.playerTeam}>{selectedWorkbenchPlayer.team_name} • Active: {activeWorkbenchPosition}</Text>
                    </View>
                    <View style={styles.posBtnGroup}>
                      {savingPositionId === selectedWorkbenchPlayer.id ? (
                        <ActivityIndicator size="small" color="#00ff87" />
                      ) : (
                        positionOptions.map((pos) => (
                          <TouchableOpacity 
                            key={pos} 
                            style={[styles.posMiniBtn, activeWorkbenchPosition === pos && styles.posMiniBtnActive]} 
                            onPress={() => handleCommitPositionOverride(selectedWorkbenchPlayer.id, pos)}
                          >
                            <Text style={[styles.posMiniText, activeWorkbenchPosition === pos && styles.posMiniTextActive]}>{pos}</Text>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.lockedNoticeBox}>
                <Text style={styles.lockedNoticeText}>
                  Position remapping desk is disabled during active season play.
                </Text>
              </View>
            )}
          </View>

          {/* BLOCK 3: SYSTEM SCORING VARIABLES ENGINE */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionHeading}>⚔️ Custom Point Scoring Parameters</Text>
            <Text style={styles.sectionSub}>Configure the point rewards and penalties applied across matchday activities.</Text>
            
            <TouchableOpacity style={styles.accordionHeaderButton} onPress={() => setAttackingExpanded(!attackingExpanded)} activeOpacity={0.8}>
              <Text style={styles.accordionHeaderText}>Attacking Returns</Text>
              <Ionicons name={attackingExpanded ? "chevron-up" : "chevron-down"} size={16} color="#666" />
            </TouchableOpacity>
            {attackingExpanded && (
              <View style={styles.accordionContentBlock}>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Goal (FWD)</Text>
                  <TextInput style={[styles.numberInput, isLocked && styles.disabledInput]} editable={!isLocked} keyboardType="numeric" value={String(settings?.points_goal_fwd ?? 4)} onChangeText={(t) => handleUpdateFieldState('points_goal_fwd', parseInt(t) || 0)} />
                </View>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Goal (MID)</Text>
                  <TextInput style={[styles.numberInput, isLocked && styles.disabledInput]} editable={!isLocked} keyboardType="numeric" value={String(settings?.points_goal_mid ?? 5)} onChangeText={(t) => handleUpdateFieldState('points_goal_mid', parseInt(t) || 0)} />
                </View>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Goal (DEF)</Text>
                  <TextInput style={[styles.numberInput, isLocked && styles.disabledInput]} editable={!isLocked} keyboardType="numeric" value={String(settings?.points_goal_def ?? 6)} onChangeText={(t) => handleUpdateFieldState('points_goal_def', parseInt(t) || 0)} />
                </View>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Assist (All)</Text>
                  <TextInput style={[styles.numberInput, isLocked && styles.disabledInput]} editable={!isLocked} keyboardType="numeric" value={String(settings?.points_assist ?? 3)} onChangeText={(t) => handleUpdateFieldState('points_assist', parseInt(t) || 0)} />
                </View>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Penalty Miss</Text>
                  <TextInput style={[styles.numberInput, isLocked && styles.disabledInput]} editable={!isLocked} keyboardType="numeric" value={String(settings?.points_penalty_miss ?? -2)} onChangeText={(t) => handleUpdateFieldState('points_penalty_miss', parseInt(t) || 0)} />
                </View>
              </View>
            )}

            <TouchableOpacity style={[styles.accordionHeaderButton, { marginTop: 8 }]} onPress={() => setDisciplinaryExpanded(!disciplinaryExpanded)} activeOpacity={0.8}>
              <Text style={styles.accordionHeaderText}>Defensive & Disciplinary</Text>
              <Ionicons name={disciplinaryExpanded ? "chevron-up" : "chevron-down"} size={16} color="#666" />
            </TouchableOpacity>
            {disciplinaryExpanded && (
              <View style={styles.accordionContentBlock}>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Clean Sheet (DEF/GKP)</Text>
                  <TextInput style={[styles.numberInput, isLocked && styles.disabledInput]} editable={!isLocked} keyboardType="numeric" value={String(settings?.points_clean_sheet_def ?? 4)} onChangeText={(t) => handleUpdateFieldState('points_clean_sheet_def', parseInt(t) || 0)} />
                </View>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Clean Sheet (MID)</Text>
                  <TextInput style={[styles.numberInput, isLocked && styles.disabledInput]} editable={!isLocked} keyboardType="numeric" value={String(settings?.points_clean_sheet_mid ?? 1)} onChangeText={(t) => handleUpdateFieldState('points_clean_sheet_mid', parseInt(t) || 0)} />
                </View>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Penalty Save</Text>
                  <TextInput style={[styles.numberInput, isLocked && styles.disabledInput]} editable={!isLocked} keyboardType="numeric" value={String(settings?.points_penalty_save ?? 5)} onChangeText={(t) => handleUpdateFieldState('points_penalty_save', parseInt(t) || 0)} />
                </View>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Yellow Card</Text>
                  <TextInput style={[styles.numberInput, isLocked && styles.disabledInput]} editable={!isLocked} keyboardType="numeric" value={String(settings?.points_yellow_card ?? -1)} onChangeText={(t) => handleUpdateFieldState('points_yellow_card', parseInt(t) || 0)} />
                </View>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Red Card</Text>
                  <TextInput style={[styles.numberInput, isLocked && styles.disabledInput]} editable={!isLocked} keyboardType="numeric" value={String(settings?.points_red_card ?? -3)} onChangeText={(t) => handleUpdateFieldState('points_red_card', parseInt(t) || 0)} />
                </View>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Own Goal</Text>
                  <TextInput style={[styles.numberInput, isLocked && styles.disabledInput]} editable={!isLocked} keyboardType="numeric" value={String(settings?.points_own_goal ?? -2)} onChangeText={(t) => handleUpdateFieldState('points_own_goal', parseInt(t) || 0)} />
                </View>
              </View>
            )}

            <TouchableOpacity style={[styles.accordionHeaderButton, { marginTop: 8 }]} onPress={() => setDefconExpanded(!defconExpanded)} activeOpacity={0.8}>
              <Text style={styles.accordionHeaderText}>Defensive Contributions Tiers</Text>
              <Ionicons name={defconExpanded ? "chevron-up" : "chevron-down"} size={16} color="#00ff87" />
            </TouchableOpacity>
            {defconExpanded && (
              <View style={styles.accordionContentBlock}>
                <Text style={styles.sectionExplanationText}>Define cumulative active tactical requirements to grant defensive tier points.</Text>
                {renderPositionTierRows('Defenders (CBIT Rules)', 'DEF', defTiers)}
                {renderPositionTierRows('Midfielders (CBIRT Rules)', 'MID', midTiers)}
                {renderPositionTierRows('Forwards (CBIRT Rules)', 'FWD', fwdTiers)}
              </View>
            )}

            {isLocked ? (
              <View style={[styles.saveBtn, { backgroundColor: '#141414', borderColor: '#222' }]}>
                <Text style={[styles.saveBtnText, { color: '#555' }]}>🔒 LEAGUE CONFIGURATIONS LOCKED FOR SEASON</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveAllSettingsMatrix} disabled={savingMatrix}>
                <Text style={styles.saveBtnText}>{savingMatrix ? 'COMMITTING CONFIGURATIONS...' : '💾 SAVE ALL LEAGUE CONFIGURATIONS'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContainer: { flex: 1, backgroundColor: '#0A0A0A' },
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' },
  scrollContainer: { padding: 16, paddingBottom: 50 },
  title: { fontSize: 22, fontWeight: '900', color: '#FFF', textTransform: 'uppercase' },

  inviteDeckCard: { backgroundColor: '#111', borderWidth: 1, borderColor: '#00ff87', padding: 16, borderRadius: 4, marginBottom: 16 },
  inviteDeckHeading: { color: '#00ff87', fontSize: 13, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
  inviteDeckSub: { color: '#888', fontSize: 11, marginTop: 2, fontWeight: '600' },
  copyTokenBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#00ff87', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 2 },
  copyTokenBtnText: { color: '#000', fontWeight: '900', fontSize: 11, marginLeft: 4 },
  inviteCodeDisplayRow: { backgroundColor: '#000', borderWidth: 1, borderColor: '#222', borderRadius: 2, paddingVertical: 12, marginTop: 12, alignItems: 'center' },
  inviteCodeText: { color: '#FFF', fontSize: 28, fontWeight: '900', letterSpacing: 6 },

  lockedGlobalBadge: { backgroundColor: '#1F1113', borderWidth: 1, borderColor: '#e63946', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  lockedGlobalBadgeText: { color: '#e63946', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  lockedSectionBadge: { backgroundColor: '#1F1113', borderWidth: 1, borderColor: '#e63946', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 3 },
  lockedSectionBadgeText: { color: '#e63946', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  lockedNoticeBox: { backgroundColor: '#0A0A0A', padding: 12, borderRadius: 4, borderWidth: 1, borderColor: '#1F1F1F' },
  lockedNoticeText: { color: '#666', fontSize: 11, fontStyle: 'italic', textAlign: 'center' },

  sectionCard: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 16, borderRadius: 4, marginBottom: 16 },
  sectionHeading: { color: '#00ff87', fontSize: 13, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionSub: { color: '#555', fontSize: 11, marginTop: 2, marginBottom: 16, fontWeight: '600', lineHeight: 16 },

  wheelSelectionDeckRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', borderWidth: 1, borderColor: '#222', paddingVertical: 14, paddingHorizontal: 6, borderRadius: 4, marginTop: 6 },
  wheelItemColumn: { alignItems: 'center', width: 58 },
  wheelArrowBtn: { padding: 4, width: '100%', alignItems: 'center' },
  wheelNumericDisplayBox: { backgroundColor: '#080808', borderWidth: 1, borderColor: '#1A1A1A', paddingVertical: 6, width: '100%', borderRadius: 2, alignItems: 'center', marginVertical: 2 },
  wheelMainText: { color: '#FFF', fontSize: 15, fontWeight: '900', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  wheelSubLabel: { color: '#333', fontSize: 7, fontWeight: '900', marginTop: 2, letterSpacing: 0.5 },
  deckMatrixDividerText: { color: '#444', fontSize: 12, fontWeight: 'bold', marginHorizontal: 10 },
  deckTimeColonSymbol: { color: '#00ff87', fontSize: 16, fontWeight: '900', marginHorizontal: 6, marginTop: -14 },

  accordionHeaderButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#080808', borderWidth: 1, borderColor: '#1F1F1F', padding: 12, borderRadius: 4 },
  accordionHeaderText: { color: '#AAA', fontSize: 12, fontWeight: '800' },
  accordionContentBlock: { backgroundColor: '#0A0A0A', borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#1F1F1F', padding: 12, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, marginBottom: 12, paddingBottom: 4 },
  segmentedControlGroup: { flexDirection: 'row', backgroundColor: '#000', padding: 4, borderRadius: 2, borderWidth: 1, borderColor: '#222' },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 2 },
  segmentBtnActive: { backgroundColor: '#00ff87' },
  segmentText: { color: '#666', fontSize: 12, fontWeight: '800' },
  segmentTextActive: { color: '#000', fontWeight: '900' },
  inputRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#161616' },
  inputLabel: { color: '#DDD', fontSize: 12, fontWeight: '700' },
  numberInput: { backgroundColor: '#000', borderWidth: 1, borderColor: '#222', color: '#FFF', width: 56, padding: 6, borderRadius: 2, textAlign: 'center', fontWeight: '800', fontSize: 13 },
  disabledInput: { color: '#444', borderColor: '#181818', backgroundColor: '#09090B' },

  saveBtn: { backgroundColor: '#222', borderWidth: 1, borderColor: '#333', padding: 14, borderRadius: 2, alignItems: 'center', marginTop: 16 },
  saveBtnText: { color: '#FFF', fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },
  sectionExplanationText: { color: '#444', fontSize: 11, fontWeight: '600', marginBottom: 12, lineHeight: 15 },
  positionSubBlock: { marginBottom: 14, borderBottomWidth: 1, borderBottomColor: '#161616', paddingBottom: 10 },
  positionSubHeader: { color: '#00ff87', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', marginBottom: 10, letterSpacing: 0.5 },
  tierGridRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  tierNumberLabel: { color: '#FFF', fontSize: 12, fontWeight: '700', width: '15%' },
  inputWrapperSmall: { width: '38%' },
  miniLabel: { color: '#333', fontSize: 8, fontWeight: '800', marginBottom: 3, textTransform: 'uppercase' },
  tierInput: { backgroundColor: '#000', borderWidth: 1, borderColor: '#1F1F1F', color: '#FFF', paddingHorizontal: 8, paddingVertical: 6, fontSize: 12, fontWeight: '700', borderRadius: 2 },
  searchRow: { flexDirection: 'row', marginBottom: 14, zIndex: 10 },
  searchInput: { backgroundColor: '#000', borderWidth: 1, borderColor: '#222', color: '#FFF', paddingHorizontal: 12, borderRadius: 2, fontSize: 13, height: 40, width: '100%' },
  suggestionsDropdownWrapper: { position: 'absolute', top: 42, left: 0, right: 0, backgroundColor: '#141414', borderWidth: 1, borderColor: '#222', borderRadius: 2, zIndex: 99, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4 },
  dropdownOptionRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#1F1F1F' },
  dropdownOptionText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  dropdownOptionSub: { color: '#444', fontSize: 10 },
  playerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#1c1c1c', marginTop: 10 },
  playerName: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  playerTeam: { color: '#555', fontSize: 11, fontWeight: '600', marginTop: 1 },
  posBtnGroup: { flexDirection: 'row', width: '58%', justifyContent: 'flex-end', alignItems: 'center' },
  posMiniBtn: { paddingVertical: 6, paddingHorizontal: 6, backgroundColor: '#000', borderWidth: 1, borderColor: '#222', marginLeft: 4, borderRadius: 2, minWidth: 40, alignItems: 'center' },
  posMiniBtnActive: { backgroundColor: '#FFF', borderColor: '#FFF' },
  posMiniText: { color: '#555', fontSize: 9, fontWeight: '800' },
  posMiniTextActive: { color: '#000', fontWeight: '900' }
});