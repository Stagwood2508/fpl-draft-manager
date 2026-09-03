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
  Platform,
  Share
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import { synchronizeFplPlayerPool } from '@/utils/fplSync';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import type { AppColors } from '@/constants/theme';
import { buildLeagueInviteLink } from '@/utils/leagueInvite';

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
  trade_cutoff_rule?: 'WAIVER_DEADLINE' | 'GAMEWEEK_DEADLINE';
  dropped_player_rule?: 'NEXT_WAIVER' | 'IMMEDIATE_FREE_AGENT';
  initial_waiver_order_rule?: 'REVERSE_DRAFT' | 'DRAFT_ORDER';
  defcon_thresholds_def?: unknown;
  defcon_thresholds_mid?: unknown;
  defcon_thresholds_fwd?: unknown;
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

const DEFAULT_DEFCON_TIERS: ReadonlyArray<TierSetting> = [
  { tier: 1, threshold: 4, points: 1 },
  { tier: 2, threshold: 7, points: 2 },
  { tier: 3, threshold: 10, points: 3 },
];

const createDefaultTiers = (): TierSetting[] => DEFAULT_DEFCON_TIERS.map(tier => ({ ...tier }));

const normaliseDefconTiers = (value: unknown): TierSetting[] => {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};

  return DEFAULT_DEFCON_TIERS.map(defaultTier => {
    const arrayTier = Array.isArray(value)
      ? value.find(item => Number((item as Partial<TierSetting>)?.tier) === defaultTier.tier)
      : undefined;
    const objectTier = !Array.isArray(value) ? source[`tier_${defaultTier.tier}`] : undefined;
    const storedTier = (arrayTier || objectTier || {}) as Partial<TierSetting>;
    const threshold = Number(storedTier.threshold);
    const points = Number(storedTier.points);

    return {
      tier: defaultTier.tier,
      threshold: Number.isFinite(threshold) ? threshold : defaultTier.threshold,
      points: Number.isFinite(points) ? points : defaultTier.points,
    };
  });
};

const serialiseDefconTiers = (tiers: TierSetting[]) => Object.fromEntries(
  normaliseDefconTiers(tiers).map(tier => [
    `tier_${tier.tier}`,
    { threshold: tier.threshold, points: tier.points },
  ]),
);

const createDefaultDraftDate = () => {
  const date = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000));
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5);
  return date;
};

export default function UnifiedLeagueSettingsScreen() {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{ leagueId?: string }>();

  const scrollRef = useRef<ScrollView>(null);
  const searchInputY = useRef<number>(0);
  const saveFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingMatrix, setSavingMatrix] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    type: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [leagueName, setLeagueName] = useState<string>('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [syncingPool, setSyncingPool] = useState(false);
  
  // Roster Limits Configuration State
  const [rosterType, setRosterType] = useState<'STRICT' | 'FLEXIBLE'>('STRICT');

  // Draft Lifecycle Lock State
  const [draftStatus, setDraftStatus] = useState<'PRE_DRAFT' | 'DRAFTING' | 'COMPLETED' | string>('PRE_DRAFT');
  const [draftPickCount, setDraftPickCount] = useState(0);

  const [attackingExpanded, setAttackingExpanded] = useState(false);
  const [disciplinaryExpanded, setDisciplinaryExpanded] = useState(false);
  const [defconExpanded, setDefconExpanded] = useState(false);

  const [settings, setSettings] = useState<LeagueSettings | null>(null);

  // INLINE GRID SELECTION WHEELS TIME HUB STATES
  const defaultDraftDate = useRef(createDefaultDraftDate());
  const [draftScheduleEnabled, setDraftScheduleEnabled] = useState(false);
  const [schedYear, setSchedYear] = useState(defaultDraftDate.current.getFullYear());
  const [schedMonth, setSchedMonth] = useState(defaultDraftDate.current.getMonth() + 1);
  const [schedDay, setSchedDay] = useState(defaultDraftDate.current.getDate());
  const [schedHour, setSchedHour] = useState(defaultDraftDate.current.getHours());
  const [schedMinute, setSchedMinute] = useState(defaultDraftDate.current.getMinutes());

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
  const isLocked = draftStatus !== 'PRE_DRAFT' && draftStatus !== 'WAITING_ROOM';

  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const deviceTimeZone = React.useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your device timezone';
    } catch {
      return 'your device timezone';
    }
  }, []);

  useEffect(() => {
    loadMasterSettingsFramework();
  }, [params?.leagueId]);

  useEffect(() => () => {
    if (saveFeedbackTimer.current) clearTimeout(saveFeedbackTimer.current);
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

  const loadMasterSettingsFramework = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Resolve Active League ID from Params > AsyncStorage
      let targetLid = params?.leagueId;
      if (!targetLid) {
        targetLid = (await AsyncStorage.getItem('active_league_id')) || undefined;
      }

      if (!targetLid) {
        const { data: firstMember } = await supabase
          .from('league_members')
          .select('league_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();
        targetLid = firstMember?.league_id;
      }

      if (!targetLid) return;
      setLeagueId(targetLid);

      // 2. Fetch League & Membership Info for this specific league
      const { data: memberData, error: memErr } = await supabase
        .from('league_members')
        .select('league_id, leagues(id, name, invite_code, commissioner_id, roster_type, draft_status, status)')
        .eq('league_id', targetLid)
        .eq('user_id', user.id)
        .maybeSingle();

      if (memErr) throw memErr;
      if (!memberData) return;

      const league = Array.isArray(memberData.leagues) ? memberData.leagues[0] : memberData.leagues as any;
      setLeagueName(league.name || 'Your League');
      setInviteCode(league.invite_code || null);
      setIsCommissioner(league.commissioner_id === user.id);

      if (league.roster_type) {
        setRosterType(league.roster_type as 'STRICT' | 'FLEXIBLE');
      }

      const activeStatus = league.draft_status || league.status || 'PRE_DRAFT';
      setDraftStatus(activeStatus);

      const { count: existingPickCount } = await supabase
        .from('draft_picks')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', targetLid);
      setDraftPickCount(existingPickCount || 0);

      // 3. Fetch Settings for this specific league
      const { data: settingsData } = await supabase
        .from('league_settings')
        .select('*')
        .eq('league_id', targetLid)
        .maybeSingle();

      if (settingsData) {
        setSettings(settingsData as LeagueSettings);
        setDefTiers(normaliseDefconTiers(settingsData.defcon_thresholds_def));
        setMidTiers(normaliseDefconTiers(settingsData.defcon_thresholds_mid));
        setFwdTiers(normaliseDefconTiers(settingsData.defcon_thresholds_fwd));

        if (settingsData.roster_type) {
          setRosterType(settingsData.roster_type as 'STRICT' | 'FLEXIBLE');
        }

        if (settingsData.draft_start_time) {
          const date = new Date(settingsData.draft_start_time);
          if (!isNaN(date.getTime())) {
            setDraftScheduleEnabled(true);
            setSchedYear(date.getFullYear());
            setSchedMonth(date.getMonth() + 1);
            setSchedDay(date.getDate());
            setSchedHour(date.getHours());
            setSchedMinute(date.getMinutes());
          }
        } else {
          setDraftScheduleEnabled(false);
        }
      } else {
        setDefTiers(createDefaultTiers());
        setMidTiers(createDefaultTiers());
        setFwdTiers(createDefaultTiers());
      }

      // 4. Fetch Position Overrides for this league
      const { data: existingOverrides } = await supabase
        .from('league_player_overrides')
        .select('player_id, custom_position')
        .eq('league_id', targetLid);

      if (existingOverrides) {
        const overrideMap: Record<string, string> = {};
        existingOverrides.forEach(o => {
          overrideMap[o.player_id] = o.custom_position;
        });
        setPositionOverrides(overrideMap);
      }

      // 5. Fetch Player Master Data
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

  const inviteLink = inviteCode ? buildLeagueInviteLink(inviteCode) : '';

  const copyInviteLink = async () => {
    if (!inviteCode) return;

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(inviteLink);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2500);
      Alert.alert('Invite link copied', `Send the link to a manager to invite them to ${leagueName}.`);
      return;
    }

    await shareInviteLink();
  };

  const shareInviteLink = async () => {
    if (!inviteCode) return;
    const message = `Join ${leagueName} on FPL Draft Manager. Open this link to get started:\n${inviteLink}\n\nInvite code: ${inviteCode}`;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title: `Join ${leagueName}`, text: message, url: inviteLink });
      return;
    }
    await Share.share({ title: `Join ${leagueName}`, message, url: inviteLink });
  };

  const handleUpdateFieldState = (key: keyof LeagueSettings, value: any) => {
    if (!settings || isLocked) return;
    setSettings({ ...settings, [key]: value });
  };

  const handleUpdateTier = (position: 'DEF' | 'MID' | 'FWD', index: number, field: 'threshold' | 'points', value: string) => {
    if (isLocked) return;
    const numericValue = parseInt(value, 10) || 0;
    if (position === 'DEF') {
      setDefTiers(current => current.map((tier, tierIndex) => tierIndex === index ? { ...tier, [field]: numericValue } : tier));
    } else if (position === 'MID') {
      setMidTiers(current => current.map((tier, tierIndex) => tierIndex === index ? { ...tier, [field]: numericValue } : tier));
    } else if (position === 'FWD') {
      setFwdTiers(current => current.map((tier, tierIndex) => tierIndex === index ? { ...tier, [field]: numericValue } : tier));
    }
  };

  const presentSaveFeedback = (
    type: 'success' | 'error',
    title: string,
    message: string,
  ) => {
    if (saveFeedbackTimer.current) clearTimeout(saveFeedbackTimer.current);
    setSaveFeedback({ type, title, message });
    saveFeedbackTimer.current = setTimeout(() => setSaveFeedback(null), 6000);

    if (Platform.OS !== 'web') {
      Alert.alert(title, message);
    }
  };

  const tweakTimeValue = (field: 'YEAR' | 'DAY' | 'MONTH' | 'HOUR' | 'MIN', delta: number) => {
    if (isLocked) return;
    if (field === 'YEAR') {
      setSchedYear(prev => Math.max(new Date().getFullYear(), prev + delta));
    } else if (field === 'DAY') {
      setSchedDay(prev => Math.max(1, Math.min(31, prev + delta)));
    } else if (field === 'MONTH') {
      setSchedMonth(prev => Math.max(1, Math.min(12, prev + delta)));
    } else if (field === 'HOUR') {
      setSchedHour(prev => (prev + delta + 24) % 24);
    } else if (field === 'MIN') {
      setSchedMinute(prev => (prev + delta + 60) % 60);
    }
  };

  const restoreAccidentalDraft = async () => {
    if (!leagueId || !isCommissioner || draftPickCount > 0) return;

    const proceed = Platform.OS === 'web'
      ? window.confirm('Return this empty draft to pre-draft setup? The expired draft time will be cleared.')
      : await new Promise<boolean>(resolve => {
          Alert.alert(
            'Return to pre-draft setup?',
            'No picks have been made. This will close the live draft and clear the expired draft time.',
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Restore', style: 'destructive', onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          );
        });

    if (!proceed) return;

    try {
      setSavingMatrix(true);
      const { data, error } = await supabase.rpc('commissioner_restart_draft', { p_league_id: leagueId });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || 'Draft could not be restored.');

      setDraftStatus('WAITING_ROOM');
      setDraftScheduleEnabled(false);
      setSettings(current => current ? { ...current, draft_start_time: null } : current);
      presentSaveFeedback('success', 'Pre-draft settings restored', 'The expired draft time was cleared. You can now amend every league setting and schedule a new future time.');
    } catch (error: any) {
      presentSaveFeedback('error', 'Draft not restored', error.message || 'Please try again.');
    } finally {
      setSavingMatrix(false);
    }
  };

  const handleManualFplSync = async () => {
  try {
    setSyncingPool(true);
    const result = await synchronizeFplPlayerPool();

    if (result.success) {
      Alert.alert('Sync Complete', `Successfully updated ${result.count} Premier League players.`);
    } else {
      Alert.alert('Sync Failed', result.error || 'The player pool sync could not be completed.');
    }
  } catch (err: any) {
    Alert.alert('Sync Failed', err.message || 'An unexpected error occurred during sync.');
  } finally {
    setSyncingPool(false);
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
      setSaveFeedback(null);

      const invalidTierGroup = [
        { label: 'Defender', tiers: defTiers },
        { label: 'Midfielder', tiers: midTiers },
        { label: 'Forward', tiers: fwdTiers },
      ].find(group => group.tiers.some((tier, index) => (
        tier.threshold < 0
        || tier.points < 0
        || (index > 0 && tier.threshold <= group.tiers[index - 1].threshold)
      )));

      if (invalidTierGroup) {
        Alert.alert(
          'Check DEFCON tiers',
          `${invalidTierGroup.label} thresholds must increase from Tier 1 to Tier 3, and thresholds and points cannot be negative.`,
        );
        return;
      }
      
      // The controls show device-local values. Construct a local Date first, then
      // convert that single instant to UTC for storage and all server countdowns.
      const selectedDraftDate = new Date(
        schedYear,
        schedMonth - 1,
        schedDay,
        schedHour,
        schedMinute,
        0,
        0,
      );
      const isValidLocalDate = !Number.isNaN(selectedDraftDate.getTime())
        && selectedDraftDate.getFullYear() === schedYear
        && selectedDraftDate.getMonth() === schedMonth - 1
        && selectedDraftDate.getDate() === schedDay
        && selectedDraftDate.getHours() === schedHour
        && selectedDraftDate.getMinutes() === schedMinute;

      if (draftScheduleEnabled && !isValidLocalDate) {
        presentSaveFeedback(
          'error',
          'Check draft date',
          `That date or time is not valid in ${deviceTimeZone}. Please choose another draft time.`,
        );
        return;
      }

      if (draftScheduleEnabled && selectedDraftDate.getTime() <= Date.now() + 60_000) {
        presentSaveFeedback(
          'error',
          'Choose a future draft time',
          'The draft cannot be scheduled in the past. Move it to a future date, or select Not scheduled to save the other settings only.',
        );
        return;
      }

      const draftStartTime = draftScheduleEnabled ? selectedDraftDate.toISOString() : null;

      // 1. Update LEAGUES table directly with roster_type
      const { error: leagueErr } = await supabase
        .from('leagues')
        .update({ roster_type: rosterType })
        .eq('id', leagueId);

      if (leagueErr) {
        console.error('Leagues Table Update Error:', leagueErr);
        throw new Error(`Failed to save roster settings: ${leagueErr.message}`);
      }

      // 2. Upsert LEAGUE_SETTINGS table
      const payload = {
        league_id: leagueId,
        ...settings,
        roster_type: rosterType,
        draft_start_time: draftStartTime,
        defcon_thresholds_def: serialiseDefconTiers(defTiers),
        defcon_thresholds_mid: serialiseDefconTiers(midTiers),
        defcon_thresholds_fwd: serialiseDefconTiers(fwdTiers),
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
      presentSaveFeedback(
        'success',
        'League settings saved',
        draftScheduleEnabled
          ? 'Your scoring rules, roster settings and future draft timetable have been updated successfully.'
          : 'Your scoring and roster settings were saved. The draft remains unscheduled.',
      );
    } catch (err: any) {
      console.error('Full Settings Save Crash:', err);
      presentSaveFeedback(
        'error',
        'Settings not saved',
        err.message || 'An unexpected error occurred during save.',
      );
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
            <TouchableOpacity onPress={() => router.back()} style={{ paddingRight: 10 }}>
              <Ionicons name="chevron-back" size={24} color="#FFF" />
            </TouchableOpacity>
            <Text style={styles.title}>League Settings</Text>
            {isLocked ? (
              <View style={styles.lockedGlobalBadge}>
                <Text style={styles.lockedGlobalBadgeText}>🔒 SEASON LOCKED</Text>
              </View>
            ) : (
              <View style={{ width: 24 }} />
            )}
          </View>

          {/* COMMISSIONER LEAGUE INVITATION DECK */}
          {inviteCode && (
            <View style={styles.inviteDeckCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inviteDeckHeading}>LEAGUE INVITATION</Text>
                  <Text style={styles.inviteDeckSub}>Send a direct link so managers arrive with the code already entered.</Text>
                </View>
              </View>

              <View style={styles.inviteCodeDisplayRow}>
                <Text style={styles.inviteCodeLabel}>INVITE CODE</Text>
                <Text style={styles.inviteCodeText}>{inviteCode}</Text>
              </View>
              <View style={styles.inviteLinkRow}>
                <Ionicons name="link-outline" size={16} color={colors.accent} />
                <Text style={styles.inviteLinkText} numberOfLines={1}>{inviteLink}</Text>
              </View>
              <View style={styles.inviteActions}>
                <TouchableOpacity style={styles.copyLinkBtn} onPress={() => void copyInviteLink()}>
                  <Ionicons name={copiedToken ? 'checkmark-circle' : 'copy-outline'} size={16} color={colors.accent} />
                  <Text style={styles.copyLinkBtnText}>{copiedToken ? 'COPIED' : Platform.OS === 'web' ? 'COPY LINK' : 'OPEN SHARE'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.shareLinkBtn} onPress={() => void shareInviteLink()}>
                  <Ionicons name="share-social-outline" size={16} color={colors.accentForeground} />
                  <Text style={styles.shareLinkBtnText}>SHARE INVITE</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {isCommissioner && isLocked && draftPickCount === 0 && (
            <View style={styles.recoveryCard}>
              <View style={styles.recoveryCopy}>
                <Text style={styles.recoveryTitle}>EMPTY DRAFT STARTED</Text>
                <Text style={styles.recoveryText}>No picks have been made, so this league can safely return to pre-draft setup.</Text>
              </View>
              <TouchableOpacity style={styles.recoveryButton} onPress={() => void restoreAccidentalDraft()} disabled={savingMatrix}>
                <Text style={styles.recoveryButtonText}>{savingMatrix ? 'RESTORING...' : 'RESTORE SETTINGS'}</Text>
              </TouchableOpacity>
            </View>
          )}

{isCommissioner && (
            <>
              <TouchableOpacity
                style={styles.sectionCard}
                onPress={() => router.push({ pathname: '/gameweek-lineups', params: { leagueId: leagueId || '' } } as any)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#00ff8714' }}>
                    <Ionicons name="shield-checkmark-outline" size={19} color="#00ff87" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionHeading}>Gameweek Lineup Review</Text>
                    <Text style={styles.sectionSub}>Review deadline snapshots, autosubs and controlled corrections.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#666" />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sectionCard}
                onPress={handleManualFplSync}
                disabled={syncingPool}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#00ff8714' }}>
                    {syncingPool ? (
                      <ActivityIndicator size="small" color="#00ff87" />
                    ) : (
                      <Ionicons name="sync-outline" size={19} color="#00ff87" />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionHeading}>Sync Player Pool</Text>
                    <Text style={styles.sectionSub}>Pull the latest players, clubs, and stats from the official FPL API.</Text>
                  </View>
                  {!syncingPool && <Ionicons name="chevron-forward" size={18} color="#666" />}
                </View>
              </TouchableOpacity>
            </>
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

            <Text style={[styles.sectionHeading, { marginTop: 24 }]}>Trade deadline</Text>
            <Text style={styles.sectionSub}>Choose when new offers and accepted trades close each Gameweek.</Text>
            <View style={[styles.segmentedControlGroup, isLocked && { opacity: 0.5 }]}>
              {([
                { value: 'WAIVER_DEADLINE' as const, label: 'Before waivers' },
                { value: 'GAMEWEEK_DEADLINE' as const, label: 'Gameweek deadline' },
              ]).map(option => (
                <TouchableOpacity
                  key={option.value}
                  disabled={isLocked}
                  style={[styles.segmentBtn, (settings?.trade_cutoff_rule || 'WAIVER_DEADLINE') === option.value && styles.segmentBtnActive]}
                  onPress={() => handleUpdateFieldState('trade_cutoff_rule', option.value)}
                >
                  <Text style={[styles.segmentText, (settings?.trade_cutoff_rule || 'WAIVER_DEADLINE') === option.value && styles.segmentTextActive]}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sectionHeading, { marginTop: 24 }]}>First waiver order</Text>
            <Text style={styles.sectionSub}>Set how managers are ordered for the first waiver window. Later windows always run from the bottom of the league table to the top.</Text>
            <View style={[styles.segmentedControlGroup, isLocked && { opacity: 0.5 }]}>
              {([
                { value: 'REVERSE_DRAFT' as const, label: 'Reverse draft order' },
                { value: 'DRAFT_ORDER' as const, label: 'Draft order' },
              ]).map(option => (
                <TouchableOpacity
                  key={option.value}
                  disabled={isLocked}
                  style={[styles.segmentBtn, (settings?.initial_waiver_order_rule || 'REVERSE_DRAFT') === option.value && styles.segmentBtnActive]}
                  onPress={() => handleUpdateFieldState('initial_waiver_order_rule', option.value)}
                >
                  <Text style={[styles.segmentText, (settings?.initial_waiver_order_rule || 'REVERSE_DRAFT') === option.value && styles.segmentTextActive]}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sectionHeading, { marginTop: 24 }]}>Waiver-dropped players</Text>
            <Text style={styles.sectionSub}>Choose whether a player released by a successful waiver is protected for the next waiver round.</Text>
            <View style={[styles.segmentedControlGroup, isLocked && { opacity: 0.5 }]}>
              {([
                { value: 'NEXT_WAIVER' as const, label: 'Protect until next waiver' },
                { value: 'IMMEDIATE_FREE_AGENT' as const, label: 'Immediate free agent' },
              ]).map(option => (
                <TouchableOpacity
                  key={option.value}
                  disabled={isLocked}
                  style={[styles.segmentBtn, (settings?.dropped_player_rule || 'NEXT_WAIVER') === option.value && styles.segmentBtnActive]}
                  onPress={() => handleUpdateFieldState('dropped_player_rule', option.value)}
                >
                  <Text style={[styles.segmentText, (settings?.dropped_player_rule || 'NEXT_WAIVER') === option.value && styles.segmentTextActive]}>{option.label}</Text>
                </TouchableOpacity>
              ))}
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
                : 'A new league remains unscheduled until you explicitly enable a future draft time.'}
            </Text>

            <View style={[styles.segmentedControlGroup, isLocked && { opacity: 0.5 }]}>
              <TouchableOpacity
                disabled={isLocked}
                style={[styles.segmentBtn, !draftScheduleEnabled && styles.segmentBtnActive]}
                onPress={() => setDraftScheduleEnabled(false)}
              >
                <Text style={[styles.segmentText, !draftScheduleEnabled && styles.segmentTextActive]}>Not scheduled</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={isLocked}
                style={[styles.segmentBtn, draftScheduleEnabled && styles.segmentBtnActive]}
                onPress={() => setDraftScheduleEnabled(true)}
              >
                <Text style={[styles.segmentText, draftScheduleEnabled && styles.segmentTextActive]}>Schedule draft</Text>
              </TouchableOpacity>
            </View>

            {draftScheduleEnabled ? (
            <View>
              <View style={[styles.yearPickerRow, isLocked && { opacity: 0.4 }]}>
                <Text style={styles.yearPickerLabel}>YEAR</Text>
                <TouchableOpacity disabled={isLocked} style={styles.yearPickerButton} onPress={() => tweakTimeValue('YEAR', -1)}>
                  <Ionicons name="remove" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
                <Text style={styles.yearPickerValue}>{schedYear}</Text>
                <TouchableOpacity disabled={isLocked} style={styles.yearPickerButton} onPress={() => tweakTimeValue('YEAR', 1)}>
                  <Ionicons name="add" size={14} color={colors.accent} />
                </TouchableOpacity>
              </View>

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
            ) : (
              <View style={styles.unscheduledNotice}>
                <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
                <Text style={styles.unscheduledNoticeText}>Saving other rules will not start or schedule the draft.</Text>
              </View>
            )}
            <View style={styles.timeZoneNotice}>
              <Ionicons name="globe-outline" size={14} color={colors.accent} />
              <Text style={styles.timeZoneText}>
                Time shown in {deviceTimeZone}. Managers in other timezones will count down to the same draft start.
              </Text>
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
                <Text style={styles.sectionExplanationText}>Set the contribution threshold and points for each position. A player receives the points from the highest tier reached; tiers are not added together.</Text>
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
                <Text style={styles.saveBtnText}>{savingMatrix ? 'SAVING LEAGUE SETTINGS...' : 'SAVE ALL LEAGUE SETTINGS'}</Text>
              </TouchableOpacity>
            )}
            {saveFeedback && (
              <View
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[
                  styles.saveFeedback,
                  saveFeedback.type === 'success' ? styles.saveFeedbackSuccess : styles.saveFeedbackError,
                ]}
              >
                <Ionicons
                  name={saveFeedback.type === 'success' ? 'checkmark-circle' : 'alert-circle'}
                  size={22}
                  color={saveFeedback.type === 'success' ? colors.accent : colors.danger}
                />
                <View style={styles.saveFeedbackCopy}>
                  <Text style={styles.saveFeedbackTitle}>{saveFeedback.title}</Text>
                  <Text style={styles.saveFeedbackMessage}>{saveFeedback.message}</Text>
                </View>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safeContainer: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  scrollContainer: { padding: 16, paddingBottom: 50 },
  title: { fontSize: 20, fontWeight: '900', color: colors.textPrimary, textTransform: 'uppercase' },

  inviteDeckCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accentBorder, padding: 16, borderRadius: 8, marginBottom: 16 },
  inviteDeckHeading: { color: colors.accent, fontSize: 13, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
  inviteDeckSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2, fontWeight: '600' },
  inviteCodeDisplayRow: { backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingVertical: 10, marginTop: 12, alignItems: 'center' },
  inviteCodeLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  inviteCodeText: { color: colors.textPrimary, fontSize: 23, fontWeight: '900', letterSpacing: 5, marginTop: 2 },
  inviteLinkRow: { minHeight: 39, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, marginTop: 8, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: 6 },
  inviteLinkText: { flex: 1, color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  inviteActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  copyLinkBtn: { minHeight: 40, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: 6 },
  copyLinkBtnText: { color: colors.accent, fontWeight: '900', fontSize: 9 },
  shareLinkBtn: { minHeight: 40, flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.accentFill, borderRadius: 6 },
  shareLinkBtnText: { color: colors.accentForeground, fontWeight: '900', fontSize: 9 },

  lockedGlobalBadge: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  lockedGlobalBadgeText: { color: colors.danger, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  lockedSectionBadge: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 3 },
  lockedSectionBadgeText: { color: colors.danger, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  lockedNoticeBox: { backgroundColor: colors.backgroundElevated, padding: 12, borderRadius: 4, borderWidth: 1, borderColor: colors.borderSubtle },
  lockedNoticeText: { color: colors.textSecondary, fontSize: 11, fontStyle: 'italic', textAlign: 'center' },

  recoveryCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerBorder, padding: 14, borderRadius: 6, marginBottom: 16 },
  recoveryCopy: { flex: 1 },
  recoveryTitle: { color: colors.danger, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  recoveryText: { color: colors.textSecondary, fontSize: 10, fontWeight: '600', lineHeight: 14, marginTop: 3 },
  recoveryButton: { minHeight: 38, justifyContent: 'center', backgroundColor: colors.danger, paddingHorizontal: 12, borderRadius: 4 },
  recoveryButtonText: { color: colors.white, fontSize: 9, fontWeight: '900' },

  sectionCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 16, borderRadius: 4, marginBottom: 16 },
  sectionHeading: { color: colors.accent, fontSize: 13, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2, marginBottom: 16, fontWeight: '600', lineHeight: 16 },

  wheelSelectionDeckRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, paddingVertical: 14, paddingHorizontal: 6, borderRadius: 4, marginTop: 6 },
  yearPickerRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  yearPickerLabel: { marginRight: 'auto', color: colors.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  yearPickerButton: { width: 34, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: 4 },
  yearPickerValue: { minWidth: 50, color: colors.textPrimary, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  wheelItemColumn: { alignItems: 'center', width: 58 },
  wheelArrowBtn: { padding: 4, width: '100%', alignItems: 'center' },
  wheelNumericDisplayBox: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle, paddingVertical: 6, width: '100%', borderRadius: 2, alignItems: 'center', marginVertical: 2 },
  wheelMainText: { color: colors.textPrimary, fontSize: 15, fontWeight: '900', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  wheelSubLabel: { color: colors.textMuted, fontSize: 7, fontWeight: '900', marginTop: 2, letterSpacing: 0.5 },
  deckMatrixDividerText: { color: colors.textMuted, fontSize: 12, fontWeight: 'bold', marginHorizontal: 10 },
  deckTimeColonSymbol: { color: colors.accent, fontSize: 16, fontWeight: '900', marginHorizontal: 6, marginTop: -14 },
  timeZoneNotice: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10, paddingHorizontal: 2 },
  timeZoneText: { flex: 1, color: colors.textMuted, fontSize: 10, fontWeight: '600', lineHeight: 14 },
  unscheduledNotice: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8, paddingHorizontal: 12, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: 4 },
  unscheduledNoticeText: { flex: 1, color: colors.textSecondary, fontSize: 10, fontWeight: '700', lineHeight: 14 },

  accordionHeaderButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.borderSubtle, padding: 12, borderRadius: 4 },
  accordionHeaderText: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  accordionContentBlock: { backgroundColor: colors.backgroundElevated, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.borderSubtle, padding: 12, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, marginBottom: 12, paddingBottom: 4 },
  segmentedControlGroup: { flexDirection: 'row', backgroundColor: colors.surfaceMuted, padding: 4, borderRadius: 2, borderWidth: 1, borderColor: colors.border },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 2 },
  segmentBtnActive: { backgroundColor: colors.accentFill },
  segmentText: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  segmentTextActive: { color: colors.accentForeground, fontWeight: '900' },
  inputRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  inputLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  numberInput: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, width: 56, padding: 6, borderRadius: 2, textAlign: 'center', fontWeight: '800', fontSize: 13 },
  disabledInput: { color: colors.textDisabled, borderColor: colors.borderSubtle, backgroundColor: colors.surfaceMuted },

  saveBtn: { backgroundColor: colors.accentFill, borderWidth: 1, borderColor: colors.accent, padding: 14, borderRadius: 2, alignItems: 'center', marginTop: 16 },
  saveBtnText: { color: colors.accentForeground, fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },
  saveFeedback: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginTop: 10, borderWidth: 1, borderRadius: 6 },
  saveFeedbackSuccess: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  saveFeedbackError: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder },
  saveFeedbackCopy: { flex: 1 },
  saveFeedbackTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '900' },
  saveFeedbackMessage: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 2, lineHeight: 15 },
  sectionExplanationText: { color: colors.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 12, lineHeight: 15 },
  positionSubBlock: { marginBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, paddingBottom: 10 },
  positionSubHeader: { color: colors.accent, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', marginBottom: 10, letterSpacing: 0.5 },
  tierGridRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  tierNumberLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: '700', width: '15%' },
  inputWrapperSmall: { width: '38%' },
  miniLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '800', marginBottom: 3, textTransform: 'uppercase' },
  tierInput: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle, color: colors.textPrimary, paddingHorizontal: 8, paddingVertical: 6, fontSize: 12, fontWeight: '700', borderRadius: 2 },
  searchRow: { flexDirection: 'row', marginBottom: 14, zIndex: 10 },
  searchInput: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, paddingHorizontal: 12, borderRadius: 2, fontSize: 13, height: 40, width: '100%' },
  suggestionsDropdownWrapper: { position: 'absolute', top: 42, left: 0, right: 0, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 2, zIndex: 99, shadowColor: colors.black, shadowOpacity: 0.3, shadowRadius: 4 },
  dropdownOptionRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  dropdownOptionText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  dropdownOptionSub: { color: colors.textMuted, fontSize: 10 },
  playerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.borderSubtle, marginTop: 10 },
  playerName: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
  playerTeam: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 1 },
  posBtnGroup: { flexDirection: 'row', width: '58%', justifyContent: 'flex-end', alignItems: 'center' },
  posMiniBtn: { paddingVertical: 6, paddingHorizontal: 6, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, marginLeft: 4, borderRadius: 2, minWidth: 40, alignItems: 'center' },
  posMiniBtnActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  posMiniText: { color: colors.textSecondary, fontSize: 9, fontWeight: '800' },
  posMiniTextActive: { color: colors.background, fontWeight: '900' }
});
