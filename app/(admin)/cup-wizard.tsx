import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

interface CupMember {
  user_id: string;
  team_name: string;
}

type TieBreaker = 'HIGHEST_STARTER' | 'MOST_GOALS' | 'MOST_ASSISTS' | 'HIGHER_SEED';

const DEFAULT_TIE_BREAKERS: TieBreaker[] = [
  'HIGHEST_STARTER',
  'MOST_GOALS',
  'MOST_ASSISTS',
  'HIGHER_SEED',
];

const TIE_BREAKER_LABELS: Record<TieBreaker, string> = {
  HIGHEST_STARTER: 'Highest-scoring starting player',
  MOST_GOALS: 'Most goals from the starting XI',
  MOST_ASSISTS: 'Most assists from the starting XI',
  HIGHER_SEED: 'Higher seed from the cup draw',
};

const notify = (title: string, message: string) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
};

const roundName = (fieldSize: number, roundIndex: number) => {
  const remaining = fieldSize / Math.pow(2, roundIndex);
  if (remaining === 2) return 'Final';
  if (remaining === 4) return 'Semi-finals';
  if (remaining === 8) return 'Quarter-finals';
  return `Round of ${remaining}`;
};

export default function CupWizardScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{ leagueId?: string }>();
  const { activeLeagueId, currentUserId } = useAppSession();
  const leagueId = params.leagueId || activeLeagueId;

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [leagueName, setLeagueName] = useState('League');
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [members, setMembers] = useState<CupMember[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [cupName, setCupName] = useState('');
  const [startGameweek, setStartGameweek] = useState(1);
  const [tieBreakers, setTieBreakers] = useState<TieBreaker[]>(DEFAULT_TIE_BREAKERS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCupContext = useCallback(async () => {
    if (!leagueId || !currentUserId) {
      setErrorMessage('No active league could be identified.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setErrorMessage(null);
      const [leagueResult, memberResult, gameweekResult] = await Promise.all([
        supabase.from('leagues').select('name, commissioner_id').eq('id', leagueId).single(),
        supabase
          .from('league_members')
          .select('user_id, team_name')
          .eq('league_id', leagueId)
          .order('draft_order', { ascending: true }),
        supabase
          .from('league_gameweeks')
          .select('gameweek, gw_deadline, is_finished')
          .eq('league_id', leagueId)
          .order('gameweek', { ascending: true }),
      ]);

      if (leagueResult.error) throw leagueResult.error;
      if (memberResult.error) throw memberResult.error;
      if (gameweekResult.error) throw gameweekResult.error;

      const leagueMembers = (memberResult.data || []).map((member: any) => ({
        user_id: String(member.user_id),
        team_name: member.team_name || 'Unnamed team',
      }));
      const nextGameweek = (gameweekResult.data || []).find((gameweek: any) => (
        !gameweek.is_finished && new Date(gameweek.gw_deadline).getTime() > Date.now()
      )) || (gameweekResult.data || []).find((gameweek: any) => !gameweek.is_finished);

      setLeagueName(leagueResult.data?.name || 'League');
      setIsCommissioner(leagueResult.data?.commissioner_id === currentUserId);
      setMembers(leagueMembers);
      setSelectedIds(current => current.length > 0
        ? current.filter(id => leagueMembers.some(member => member.user_id === id))
        : leagueMembers.map(member => member.user_id));
      setStartGameweek(Number(nextGameweek?.gameweek || 1));
    } catch (error: any) {
      setErrorMessage(error?.message || 'Cup setup could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [currentUserId, leagueId]);

  useFocusEffect(useCallback(() => {
    void loadCupContext();
  }, [loadCupContext]));

  const selectedCount = selectedIds.length;
  const bracketSize = selectedCount >= 2 ? Math.pow(2, Math.ceil(Math.log2(selectedCount))) : 0;
  const roundCount = bracketSize > 0 ? Math.log2(bracketSize) : 0;
  const finalGameweek = startGameweek + Math.max(0, roundCount - 1);
  const byes = Math.max(0, bracketSize - selectedCount);

  const rounds = useMemo(() => (
    Array.from({ length: roundCount }, (_, index) => ({
      name: roundName(bracketSize, index),
      gameweek: startGameweek + index,
    }))
  ), [bracketSize, roundCount, startGameweek]);

  const toggleMember = (userId: string) => {
    setSelectedIds(current => current.includes(userId)
      ? current.filter(id => id !== userId)
      : [...current, userId]);
  };

  const shiftTieBreaker = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= tieBreakers.length) return;
    setTieBreakers(current => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const createCup = async () => {
    if (!leagueId || !isCommissioner) return;
    if (!cupName.trim()) {
      notify('Cup name required', 'Give the new cup a name before creating it.');
      return;
    }
    if (selectedCount < 2) {
      notify('Select more managers', 'A knockout cup requires at least two entrants.');
      return;
    }
    if (finalGameweek > 38) {
      notify('Schedule too late', 'There are not enough Gameweeks remaining to complete this cup.');
      return;
    }

    try {
      setProcessing(true);
      const { data, error } = await supabase.rpc('create_single_knockout_cup', {
        p_league_id: leagueId,
        p_name: cupName.trim(),
        p_start_gameweek: startGameweek,
        p_participant_ids: selectedIds,
        p_tie_breakers: tieBreakers,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        const messages: Record<string, string> = {
          CUP_NAME_TAKEN: 'A cup with that name already exists in this league.',
          SCHEDULE_EXCEEDS_SEASON: 'There are not enough Gameweeks remaining for every round.',
          INVALID_PARTICIPANT: 'One of the selected managers is no longer in this league.',
          COMMISSIONER_REQUIRED: 'Only the league commissioner can create a cup.',
        };
        throw new Error(messages[result?.error] || result?.error || 'The cup could not be created.');
      }

      notify(
        'Cup created',
        `${cupName.trim()} has been drawn for ${result.participants} managers. The final is scheduled for GW${result.final_gameweek}.`,
      );
      router.replace('/(tabs)/league/cups');
    } catch (error: any) {
      notify('Cup not created', error?.message || 'The cup setup could not be saved.');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{leagueName}</Text>
          <Text style={styles.title}>Create a knockout cup</Text>
          <Text style={styles.subtitle}>
            One fixture per round, scored from each manager&apos;s official Gameweek starting XI after autosubs.
          </Text>
        </View>

        {errorMessage ? (
          <TouchableOpacity style={styles.errorCard} onPress={() => void loadCupContext()}>
            <Ionicons name="warning-outline" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{errorMessage} Tap to retry.</Text>
          </TouchableOpacity>
        ) : !isCommissioner ? (
          <View style={styles.errorCard}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
            <Text style={styles.errorText}>Only the commissioner can create a cup for this league.</Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.stepLabel}>STEP 1 · CUP DETAILS</Text>
              <Text style={styles.sectionTitle}>Name the competition</Text>
              <TextInput
                value={cupName}
                onChangeText={setCupName}
                placeholder="e.g. League Champions Cup"
                placeholderTextColor={colors.textMuted}
                maxLength={60}
                style={styles.input}
              />
              <View style={styles.readOnlyRow}>
                <Ionicons name="git-network-outline" size={17} color={colors.accent} />
                <View style={styles.readOnlyCopy}>
                  <Text style={styles.readOnlyTitle}>Single knockout</Text>
                  <Text style={styles.readOnlyMeta}>Drawn once · losers eliminated · winner advances</Text>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeadingRow}>
                <View>
                  <Text style={styles.stepLabel}>STEP 2 · ENTRANTS</Text>
                  <Text style={styles.sectionTitle}>{selectedCount} managers selected</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedIds(
                  selectedCount === members.length ? [] : members.map(member => member.user_id),
                )}>
                  <Text style={styles.textLink}>{selectedCount === members.length ? 'CLEAR' : 'SELECT ALL'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.memberGrid}>
                {members.map(member => {
                  const selected = selectedIds.includes(member.user_id);
                  return (
                    <TouchableOpacity
                      key={member.user_id}
                      style={[styles.memberButton, selected && styles.memberButtonSelected]}
                      onPress={() => toggleMember(member.user_id)}
                    >
                      <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={17} color={selected ? colors.accent : colors.textMuted} />
                      <Text style={[styles.memberName, selected && styles.memberNameSelected]} numberOfLines={1}>{member.team_name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {byes > 0 && selectedCount >= 2 ? (
                <Text style={styles.helperText}>{byes} randomly drawn {byes === 1 ? 'manager receives' : 'managers receive'} an opening-round bye.</Text>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.stepLabel}>STEP 3 · SCHEDULE</Text>
              <View style={styles.gameweekPickerRow}>
                <View style={styles.scheduleCopy}>
                  <Text style={styles.sectionTitle}>Opening Gameweek</Text>
                  <Text style={styles.helperText}>Every following round uses the next Gameweek.</Text>
                </View>
                <View style={styles.gameweekPicker}>
                  <TouchableOpacity style={styles.gameweekArrow} onPress={() => setStartGameweek(current => Math.max(1, current - 1))}>
                    <Ionicons name="remove" size={18} color={colors.textPrimary} />
                  </TouchableOpacity>
                  <Text style={styles.gameweekValue}>GW{startGameweek}</Text>
                  <TouchableOpacity style={styles.gameweekArrow} onPress={() => setStartGameweek(current => Math.min(38, current + 1))}>
                    <Ionicons name="add" size={18} color={colors.textPrimary} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.roundTimeline}>
                {rounds.map((round, index) => (
                  <View key={`${round.name}-${round.gameweek}`} style={styles.roundTimelineItem}>
                    <View style={[styles.timelineDot, index === rounds.length - 1 && styles.timelineDotFinal]} />
                    <Text style={styles.roundTimelineName}>{round.name}</Text>
                    <Text style={styles.roundTimelineGameweek}>GW{round.gameweek}</Text>
                  </View>
                ))}
              </View>
              {finalGameweek > 38 && <Text style={styles.validationText}>This cup would finish after GW38.</Text>}
            </View>

            <View style={styles.card}>
              <Text style={styles.stepLabel}>STEP 4 · TIEBREAKERS</Text>
              <Text style={styles.sectionTitle}>Priority order</Text>
              <Text style={styles.helperText}>If the scores are level, these are checked from top to bottom.</Text>
              {tieBreakers.map((tieBreaker, index) => (
                <View key={tieBreaker} style={styles.tieBreakerRow}>
                  <Text style={styles.tieBreakerNumber}>{index + 1}</Text>
                  <Text style={styles.tieBreakerText}>{TIE_BREAKER_LABELS[tieBreaker]}</Text>
                  <TouchableOpacity style={styles.orderButton} disabled={index === 0} onPress={() => shiftTieBreaker(index, -1)}>
                    <Ionicons name="chevron-up" size={16} color={index === 0 ? colors.textDisabled : colors.textPrimary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.orderButton} disabled={index === tieBreakers.length - 1} onPress={() => shiftTieBreaker(index, 1)}>
                    <Ionicons name="chevron-down" size={16} color={index === tieBreakers.length - 1 ? colors.textDisabled : colors.textPrimary} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            <View style={styles.reviewCard}>
              <Text style={styles.stepLabel}>FINAL REVIEW</Text>
              <Text style={styles.reviewTitle}>{cupName.trim() || 'Your new cup'}</Text>
              <Text style={styles.reviewMeta}>{selectedCount} entrants · {roundCount || 0} rounds · GW{startGameweek}–GW{finalGameweek}</Text>
              <Text style={styles.reviewNote}>The draw and entrant seeds are frozen when the cup is created.</Text>
              <TouchableOpacity
                style={[styles.createButton, (processing || selectedCount < 2 || finalGameweek > 38) && styles.createButtonDisabled]}
                onPress={() => void createCup()}
                disabled={processing || selectedCount < 2 || finalGameweek > 38}
              >
                {processing ? <ActivityIndicator size="small" color={colors.accentForeground} /> : (
                  <>
                    <Ionicons name="trophy" size={18} color={colors.accentForeground} />
                    <Text style={styles.createButtonText}>CREATE AND DRAW CUP</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: appSpacing.md, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  hero: { paddingVertical: appSpacing.sm, marginBottom: appSpacing.md },
  eyebrow: { ...appTypography.label, color: colors.accent },
  title: { ...appTypography.screenTitle, color: colors.textPrimary, marginTop: 3 },
  subtitle: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '600', marginTop: 5 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: appSpacing.md, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerBorder, borderRadius: appRadius.medium },
  errorText: { flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  card: { padding: appSpacing.md, marginBottom: appSpacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.large },
  stepLabel: { ...appTypography.label, color: colors.accent, fontSize: 8 },
  sectionTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '900', marginTop: 3 },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  textLink: { ...appTypography.label, color: colors.accent, fontSize: 8 },
  input: { minHeight: 46, marginTop: appSpacing.md, paddingHorizontal: appSpacing.md, color: colors.textPrimary, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: appRadius.small, fontSize: 14, fontWeight: '700' },
  readOnlyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: appSpacing.sm, padding: appSpacing.sm, backgroundColor: colors.accentSoft, borderRadius: appRadius.small },
  readOnlyCopy: { flex: 1 },
  readOnlyTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '900' },
  readOnlyMeta: { color: colors.textMuted, fontSize: 9, fontWeight: '600', marginTop: 2 },
  memberGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: appSpacing.md },
  memberButton: { width: '48.8%', minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.small },
  memberButtonSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  memberName: { flex: 1, color: colors.textMuted, fontSize: 10, fontWeight: '700' },
  memberNameSelected: { color: colors.textPrimary },
  helperText: { color: colors.textMuted, fontSize: 10, lineHeight: 15, fontWeight: '600', marginTop: 6 },
  gameweekPickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  scheduleCopy: { flex: 1 },
  gameweekPicker: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden', backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.small },
  gameweekArrow: { width: 38, height: 40, alignItems: 'center', justifyContent: 'center' },
  gameweekValue: { minWidth: 48, color: colors.accent, textAlign: 'center', fontSize: 13, fontWeight: '900' },
  roundTimeline: { marginTop: appSpacing.md, borderLeftWidth: 1, borderLeftColor: colors.borderStrong, marginLeft: 6 },
  roundTimelineItem: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14 },
  timelineDot: { position: 'absolute', left: -4, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.borderStrong },
  timelineDotFinal: { backgroundColor: colors.accentFill },
  roundTimelineName: { flex: 1, color: colors.textPrimary, fontSize: 11, fontWeight: '800' },
  roundTimelineGameweek: { color: colors.accent, fontSize: 10, fontWeight: '900' },
  validationText: { color: colors.danger, fontSize: 10, fontWeight: '800', marginTop: 8 },
  tieBreakerRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7, paddingHorizontal: 9, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.small },
  tieBreakerNumber: { width: 18, color: colors.accent, fontSize: 11, fontWeight: '900' },
  tieBreakerText: { flex: 1, color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  orderButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  reviewCard: { padding: appSpacing.lg, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: appRadius.large },
  reviewTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 5 },
  reviewMeta: { color: colors.accent, fontSize: 11, fontWeight: '800', marginTop: 4 },
  reviewNote: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 7 },
  createButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: appSpacing.md, backgroundColor: colors.accentFill, borderRadius: appRadius.small },
  createButtonDisabled: { opacity: 0.45 },
  createButtonText: { ...appTypography.label, color: colors.accentForeground, fontSize: 10 },
});
