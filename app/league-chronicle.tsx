import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

interface ChronicleHighlight {
  type: string;
  label: string;
  title: string;
  value: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}

interface TableMovement {
  user_id: string;
  team_name: string;
  current_rank: number;
  previous_rank: number;
  change: number;
}

interface Chronicle {
  id: string;
  league_id: string;
  gameweek: number;
  title: string;
  summary: string;
  featured_fixture: {
    fixture_id?: string;
    home_team_name?: string;
    away_team_name?: string;
    home_score?: number;
    away_score?: number;
  };
  highlights: ChronicleHighlight[];
  table_movements: TableMovement[];
  sliding_doors: { fixture_id?: string; title?: string; body?: string; margin?: number };
  published_at: string;
}

const iconForHighlight = (highlight: ChronicleHighlight): React.ComponentProps<typeof Ionicons>['name'] => {
  const requested = highlight.icon;
  if (requested === 'trophy') return 'trophy-outline';
  if (requested === 'trending-up') return 'trending-up-outline';
  if (requested === 'sad') return 'sad-outline';
  if (requested === 'flash') return 'flash-outline';
  return 'sparkles-outline';
};

export default function LeagueChronicleScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ leagueId?: string; gameweek?: string }>();
  const safeArea = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [leagueId, setLeagueId] = useState<string | null>(params.leagueId || null);
  const [leagueName, setLeagueName] = useState('League Chronicle');
  const [editions, setEditions] = useState<Chronicle[]>([]);
  const [selectedGameweek, setSelectedGameweek] = useState<number | null>(params.gameweek ? Number(params.gameweek) : null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadChronicles = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setErrorMessage(null);
    try {
      const targetLeagueId = leagueId || params.leagueId || await AsyncStorage.getItem('active_league_id');
      if (!targetLeagueId) throw new Error('Choose an active league before opening the Chronicle.');
      setLeagueId(targetLeagueId);

      const [leagueResponse, chroniclesResponse] = await Promise.all([
        supabase.from('leagues').select('name').eq('id', targetLeagueId).maybeSingle(),
        supabase
          .from('league_chronicles')
          .select('id, league_id, gameweek, title, summary, featured_fixture, highlights, table_movements, sliding_doors, published_at')
          .eq('league_id', targetLeagueId)
          .order('gameweek', { ascending: false }),
      ]);
      if (leagueResponse.error) throw leagueResponse.error;
      if (chroniclesResponse.error) throw chroniclesResponse.error;
      setLeagueName(leagueResponse.data?.name || 'League Chronicle');
      const rows = (chroniclesResponse.data || []) as Chronicle[];
      setEditions(rows);
      setSelectedGameweek(current => {
        if (current && rows.some(row => row.gameweek === current)) return current;
        return rows[0]?.gameweek || null;
      });
    } catch (error: any) {
      setErrorMessage(error?.message || 'The Chronicle could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [leagueId, params.leagueId]);

  useEffect(() => { void loadChronicles(); }, [loadChronicles]);

  const edition = editions.find(item => item.gameweek === selectedGameweek) || editions[0] || null;
  const movements = useMemo(() => {
    if (!edition) return [];
    return [...(edition.table_movements || [])]
      .filter(item => item.change !== 0)
      .sort((left, right) => Math.abs(right.change) - Math.abs(left.change))
      .slice(0, 5);
  }, [edition]);

  const openFixture = () => {
    if (!edition?.featured_fixture?.fixture_id) return;
    router.push({ pathname: '/(tabs)/league/matches', params: { fixtureId: edition.featured_fixture.fixture_id, gameweek: edition.gameweek } } as any);
  };

  const shareEdition = async () => {
    if (!edition) return;
    const fixture = edition.featured_fixture || {};
    await Share.share({
      title: `${leagueName} · GW${edition.gameweek} Chronicle`,
      message: `${leagueName} · GW${edition.gameweek} Chronicle\n\n${edition.title}\n${edition.summary}\n\nFeatured result: ${fixture.home_team_name || 'Home'} ${fixture.home_score ?? 0}–${fixture.away_score ?? 0} ${fixture.away_team_name || 'Away'}`,
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={() => router.back()} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={21} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>LEAGUE HUB</Text>
          <Text style={styles.headerTitle}>The Chronicle</Text>
        </View>
        <TouchableOpacity style={styles.headerButton} onPress={() => void shareEdition()} disabled={!edition} accessibilityLabel="Share Chronicle">
          <Ionicons name="share-social-outline" size={20} color={edition ? colors.accent : colors.textDisabled} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerState}><ActivityIndicator color={colors.accent} /><Text style={styles.stateText}>Preparing the latest edition…</Text></View>
      ) : errorMessage ? (
        <TouchableOpacity style={styles.centerState} onPress={() => void loadChronicles()}>
          <Ionicons name="cloud-offline-outline" size={30} color={colors.danger} />
          <Text style={styles.errorText}>{errorMessage}</Text><Text style={styles.retryText}>TAP TO RETRY</Text>
        </TouchableOpacity>
      ) : !edition ? (
        <View style={styles.centerState}>
          <Ionicons name="newspaper-outline" size={36} color={colors.textDisabled} />
          <Text style={styles.emptyTitle}>The first edition is coming</Text>
          <Text style={styles.stateText}>The Chronicle is published automatically after a Gameweek’s fixtures and autosubs are finalised.</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(safeArea.bottom, appSpacing.lg) + appSpacing.xl }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadChronicles(true)} tintColor={colors.accent} />}
        >
          <View style={styles.archiveRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.archiveContent}>
              {editions.map(item => (
                <TouchableOpacity key={item.id} style={[styles.editionChip, item.gameweek === edition.gameweek && styles.editionChipActive]} onPress={() => setSelectedGameweek(item.gameweek)}>
                  <Text style={[styles.editionChipText, item.gameweek === edition.gameweek && styles.editionChipTextActive]}>GW{item.gameweek}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={styles.heroCard}>
            <View style={styles.heroMetaRow}><Text style={styles.heroEyebrow}>GAMEWEEK {edition.gameweek} EDITION</Text><Text style={styles.heroDate}>{new Date(edition.published_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}</Text></View>
            <Text style={styles.heroTitle}>{edition.title}</Text>
            <Text style={styles.heroSummary}>{edition.summary}</Text>
            <TouchableOpacity style={styles.scoreCard} onPress={openFixture} activeOpacity={0.8}>
              <View style={styles.teamBlock}><Text style={styles.teamRole}>HOME</Text><Text style={styles.teamName} numberOfLines={2}>{edition.featured_fixture.home_team_name || 'Home'}</Text></View>
              <View style={styles.scoreBlock}><Text style={styles.score}>{edition.featured_fixture.home_score ?? 0}–{edition.featured_fixture.away_score ?? 0}</Text><Text style={styles.fullTime}>FULL TIME</Text></View>
              <View style={[styles.teamBlock, styles.awayBlock]}><Text style={styles.teamRole}>AWAY</Text><Text style={[styles.teamName, styles.awayName]} numberOfLines={2}>{edition.featured_fixture.away_team_name || 'Away'}</Text></View>
              <Ionicons name="chevron-forward" size={15} color={colors.textDisabled} />
            </TouchableOpacity>
          </View>

          <View style={styles.sectionHeading}><Text style={styles.sectionEyebrow}>WEEKLY HONOURS</Text><Text style={styles.sectionTitle}>The stories behind the scores</Text></View>
          <View style={styles.highlightsGrid}>
            {(edition.highlights || []).map((highlight, index) => (
              <View key={`${highlight.type}-${index}`} style={styles.highlightCard}>
                <View style={styles.highlightIcon}><Ionicons name={iconForHighlight(highlight)} size={17} color={colors.accent} /></View>
                <Text style={styles.highlightLabel}>{highlight.label}</Text>
                <Text style={styles.highlightTitle} numberOfLines={2}>{highlight.title}</Text>
                <Text style={styles.highlightValue}>{highlight.value}</Text>
              </View>
            ))}
          </View>

          <View style={styles.storyCard}>
            <View style={styles.storyHeading}><View style={styles.storyIcon}><Ionicons name="git-compare-outline" size={17} color={colors.warning} /></View><View><Text style={styles.storyEyebrow}>SLIDING DOORS</Text><Text style={styles.storyTitle}>{edition.sliding_doors?.title || 'The closest contest'}</Text></View></View>
            <Text style={styles.storyBody}>{edition.sliding_doors?.body || 'The smallest margins created the biggest Gameweek story.'}</Text>
          </View>

          <View style={styles.movementCard}>
            <View style={styles.cardHeadingRow}><View><Text style={styles.sectionEyebrow}>TABLE MOVERS</Text><Text style={styles.sectionTitle}>Who changed places</Text></View><TouchableOpacity onPress={() => router.push('/(tabs)/league')}><Text style={styles.textLink}>FULL TABLE</Text></TouchableOpacity></View>
            {movements.length === 0 ? <Text style={styles.noMovement}>No league positions changed this Gameweek.</Text> : movements.map(item => (
              <View key={item.user_id} style={styles.movementRow}>
                <View style={[styles.movementBadge, item.change > 0 ? styles.movementUp : styles.movementDown]}><Ionicons name={item.change > 0 ? 'arrow-up' : 'arrow-down'} size={12} color={item.change > 0 ? colors.accent : colors.danger} /><Text style={[styles.movementAmount, { color: item.change > 0 ? colors.accent : colors.danger }]}>{Math.abs(item.change)}</Text></View>
                <Text style={styles.movementTeam} numberOfLines={1}>{item.team_name}</Text>
                <Text style={styles.movementRank}>#{item.current_rank}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.shareButton} onPress={() => void shareEdition()}><Ionicons name="share-social-outline" size={17} color={colors.backgroundDeep} /><Text style={styles.shareButtonText}>SHARE THIS EDITION</Text></TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: appSpacing.md, backgroundColor: colors.backgroundDeep, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: appRadius.medium },
  headerCopy: { flex: 1 },
  headerEyebrow: { ...appTypography.label, color: colors.accent, fontSize: 8 },
  headerTitle: { ...appTypography.screenTitle, color: colors.textPrimary, fontSize: 18, marginTop: 1 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: appSpacing.xxl },
  stateText: { ...appTypography.body, color: colors.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 440 },
  errorText: { ...appTypography.body, color: colors.danger, textAlign: 'center' },
  retryText: { ...appTypography.label, color: colors.accent },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '900' },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 880, alignSelf: 'center', padding: appSpacing.md },
  archiveRow: { marginHorizontal: -appSpacing.md, marginTop: -appSpacing.md, marginBottom: appSpacing.md, backgroundColor: colors.backgroundDeep, borderBottomWidth: 1, borderBottomColor: colors.border },
  archiveContent: { gap: 7, paddingHorizontal: appSpacing.md, paddingVertical: 9 },
  editionChip: { minWidth: 49, height: 30, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.pill },
  editionChipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  editionChipText: { ...appTypography.label, color: colors.textMuted },
  editionChipTextActive: { color: colors.accent },
  heroCard: { padding: appSpacing.lg, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: appRadius.large, overflow: 'hidden' },
  heroMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroEyebrow: { ...appTypography.label, color: colors.accent, fontSize: 8 },
  heroDate: { ...appTypography.metadata, color: colors.textMuted },
  heroTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', lineHeight: 27, letterSpacing: -0.4, marginTop: appSpacing.sm },
  heroSummary: { ...appTypography.body, color: colors.textSecondary, lineHeight: 19, marginTop: 7 },
  scoreCard: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 8, padding: appSpacing.md, marginTop: appSpacing.lg, backgroundColor: colors.backgroundDeep, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium },
  teamBlock: { flex: 1, minWidth: 0 },
  awayBlock: { alignItems: 'flex-end' },
  teamRole: { ...appTypography.label, color: colors.textMuted, fontSize: 7 },
  teamName: { color: colors.textPrimary, fontSize: 12, fontWeight: '900', marginTop: 3 },
  awayName: { textAlign: 'right' },
  scoreBlock: { alignItems: 'center' },
  score: { color: colors.accent, fontSize: 24, fontWeight: '900', letterSpacing: -0.8 },
  fullTime: { ...appTypography.label, color: colors.textMuted, fontSize: 7, marginTop: 2 },
  sectionHeading: { marginTop: appSpacing.xl, marginBottom: appSpacing.sm },
  sectionEyebrow: { ...appTypography.label, color: colors.accent, fontSize: 8 },
  sectionTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 2 },
  highlightsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  highlightCard: { width: '48.7%', minHeight: 125, padding: appSpacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium },
  highlightIcon: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderRadius: appRadius.small },
  highlightLabel: { ...appTypography.label, color: colors.textMuted, fontSize: 7, marginTop: 9 },
  highlightTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '900', marginTop: 3 },
  highlightValue: { color: colors.accent, fontSize: 11, fontWeight: '900', marginTop: 4 },
  storyCard: { padding: appSpacing.lg, marginTop: appSpacing.lg, backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: `${colors.warning}66`, borderRadius: appRadius.large },
  storyHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  storyIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: appRadius.medium },
  storyEyebrow: { ...appTypography.label, color: colors.warning, fontSize: 8 },
  storyTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '900', marginTop: 2 },
  storyBody: { ...appTypography.body, color: colors.textSecondary, lineHeight: 19, marginTop: appSpacing.md },
  movementCard: { padding: appSpacing.lg, marginTop: appSpacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.large },
  cardHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: appSpacing.sm },
  textLink: { ...appTypography.label, color: colors.accent, fontSize: 8 },
  movementRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  movementBadge: { width: 42, height: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1, borderRadius: appRadius.pill },
  movementUp: { backgroundColor: colors.accentSoft },
  movementDown: { backgroundColor: colors.dangerSoft },
  movementAmount: { fontSize: 9, fontWeight: '900' },
  movementTeam: { flex: 1, color: colors.textPrimary, fontSize: 11, fontWeight: '800' },
  movementRank: { color: colors.textSecondary, fontSize: 11, fontWeight: '900' },
  noMovement: { ...appTypography.body, color: colors.textMuted, paddingVertical: appSpacing.md },
  shareButton: { minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: appSpacing.lg, backgroundColor: colors.accent, borderRadius: appRadius.medium },
  shareButtonText: { ...appTypography.label, color: colors.backgroundDeep },
});

