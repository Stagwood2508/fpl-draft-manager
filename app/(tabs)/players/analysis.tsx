import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from 'expo-router/react-navigation';
import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

type Position = 'GKP' | 'DEF' | 'MID' | 'FWD';
type PickerMode = 'PRIMARY' | 'COMPARE' | null;
interface Stats { total_points: number; minutes: number; starts: number; appearances: number; goals_scored: number; assists: number; clean_sheets: number; saves: number; bonus: number; defensive_contribution: number; ict_index: number; expected_goals: number; expected_assists: number; expected_goal_involvements: number; recent_form: number; }
interface Player { id: number; web_name: string; first_name: string; second_name: string; team_id: number; team_name: string; team_short_name: string; element_type: Position; stats: Stats; }
interface Match { gameweek: number; minutes: number; points: number; goals: number; assists: number; xg: number; xa: number; opponent: string; isHome: boolean; }
interface Fixture { gameweek: number; opponent: string; isHome: boolean; difficulty: number; }

const n = (value: unknown) => Number(value || 0);
const number = (value: number, digits = 1) => value.toFixed(digits);
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
const positionColor: Record<Position, string> = { GKP: '#FFC107', DEF: '#00A2FF', MID: '#00F27A', FWD: '#FF4D78' };
const emptyStats: Stats = { total_points: 0, minutes: 0, starts: 0, appearances: 0, goals_scored: 0, assists: 0, clean_sheets: 0, saves: 0, bonus: 0, defensive_contribution: 0, ict_index: 0, expected_goals: 0, expected_assists: 0, expected_goal_involvements: 0, recent_form: 0 };
const statsFrom = (row: any): Stats => ({ total_points: n(row?.total_points), minutes: n(row?.minutes), starts: n(row?.starts), appearances: n(row?.appearances ?? row?.starts), goals_scored: n(row?.goals_scored), assists: n(row?.assists), clean_sheets: n(row?.clean_sheets), saves: n(row?.saves), bonus: n(row?.bonus), defensive_contribution: n(row?.defensive_contribution), ict_index: n(row?.ict_index), expected_goals: n(row?.expected_goals), expected_assists: n(row?.expected_assists), expected_goal_involvements: n(row?.expected_goal_involvements), recent_form: n(row?.recent_form) });

export default function PlayerAnalysisScreen() {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors, width), [colors, width]);
  const { activeLeagueId } = useAppSession();
  const isFocused = useIsFocused();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameweek, setGameweek] = useState(1);
  const [pool, setPool] = useState<Player[]>([]);
  const [selected, setSelected] = useState<Player | null>(null);
  const [comparisonPlayer, setComparisonPlayer] = useState<Player | null>(null);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [playerQuery, setPlayerQuery] = useState('');
  const selectedIdRef = useRef<number | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);

  const loadDetail = useCallback(async (player: Player, throughGameweek: number) => {
    setDetailLoading(true);
    try {
      const [statsResult, fixturesResult] = await Promise.all([
        supabase.from('player_gameweek_stats').select('gameweek, minutes, total_points, goals_scored, assists, expected_goals, expected_assists').eq('player_id', player.id).lte('gameweek', Math.max(throughGameweek, 1)).order('gameweek', { ascending: false }).limit(5),
        supabase.from('fixtures').select('gameweek, home_team_id, away_team_id, home_team_short, away_team_short, home_difficulty, away_difficulty').or(`home_team_id.eq.${player.team_id},away_team_id.eq.${player.team_id}`).eq('is_finished', false).order('gameweek', { ascending: true }).limit(5),
      ]);
      if (statsResult.error) throw statsResult.error;
      if (fixturesResult.error) throw fixturesResult.error;
      const historyGameweeks = (statsResult.data || []).map((row: any) => n(row.gameweek)).filter(Boolean);
      const historyFixturesResult = historyGameweeks.length
        ? await supabase.from('fixtures').select('gameweek, home_team_id, away_team_id, home_team_short, away_team_short').in('gameweek', historyGameweeks).or(`home_team_id.eq.${player.team_id},away_team_id.eq.${player.team_id}`)
        : { data: [], error: null };
      if (historyFixturesResult.error) throw historyFixturesResult.error;
      const fixtureByGameweek = new Map<number, any>();
      (historyFixturesResult.data || []).forEach((fixture: any) => fixtureByGameweek.set(Number(fixture.gameweek), fixture));
      if (selectedIdRef.current !== player.id) return;
      setMatches((statsResult.data || []).map((row: any) => {
        const fixture = fixtureByGameweek.get(Number(row.gameweek));
        const isHome = fixture ? Number(fixture.home_team_id) === player.team_id : false;
        return { gameweek: n(row.gameweek), minutes: n(row.minutes), points: n(row.total_points), goals: n(row.goals_scored), assists: n(row.assists), xg: n(row.expected_goals), xa: n(row.expected_assists), opponent: fixture ? (isHome ? fixture.away_team_short : fixture.home_team_short) || '—' : '—', isHome };
      }));
      setFixtures((fixturesResult.data || []).map((fixture: any) => {
        const isHome = Number(fixture.home_team_id) === player.team_id;
        return { gameweek: n(fixture.gameweek), opponent: (isHome ? fixture.away_team_short : fixture.home_team_short) || 'OPP', isHome, difficulty: n(isHome ? fixture.home_difficulty : fixture.away_difficulty) || 3 };
      }));
    } catch (cause: any) {
      if (selectedIdRef.current !== player.id) return;
      setError(cause?.message || 'Player detail could not be loaded.');
      setMatches([]); setFixtures([]);
    } finally { setDetailLoading(false); }
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    if (!activeLeagueId) { setError('Select a league to use player analysis.'); setLoading(false); return; }
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const { data: gameweeks, error: gameweeksError } = await supabase.from('league_gameweeks').select('gameweek, is_current, is_finished').eq('league_id', activeLeagueId).order('gameweek');
      if (gameweeksError) throw gameweeksError;
      const current = n(gameweeks?.find((row: any) => row.is_current)?.gameweek || gameweeks?.find((row: any) => !row.is_finished)?.gameweek || gameweeks?.[gameweeks.length - 1]?.gameweek || 1);
      setGameweek(current);
      const [playersResult, aggregatesResult] = await Promise.all([
        supabase.from('players').select('id, web_name, first_name, second_name, team_id, team_name, team_short_name, element_type').eq('is_active', true),
        supabase.rpc('get_player_pool_current_stats', { p_through_gameweek: current }),
      ]);
      if (playersResult.error) throw playersResult.error;
      if (aggregatesResult.error) throw aggregatesResult.error;
      const aggregateById = new Map<number, any>((aggregatesResult.data || []).map((row: any) => [n(row.player_id), row]));
      const nextPool: Player[] = (playersResult.data || []).map((player: any) => ({ ...player, team_id: n(player.team_id), team_short_name: player.team_short_name || player.team_name?.slice(0, 3).toUpperCase() || 'PL', element_type: player.element_type as Position, stats: statsFrom(aggregateById.get(n(player.id)) || emptyStats) })).sort((a, b) => b.stats.total_points - a.stats.total_points || a.web_name.localeCompare(b.web_name));
      setPool(nextPool);
      const target = nextPool.find(player => player.id === selectedIdRef.current) || nextPool[0] || null;
      selectedIdRef.current = target?.id || null;
      setSelected(target);
      if (target) await loadDetail(target, current);
    } catch (cause: any) { setError(cause?.message || 'Player analysis could not be loaded.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [activeLeagueId, loadDetail]);

  useEffect(() => { if (isFocused) void load(); }, [isFocused, load]);
  const choose = (player: Player) => { selectedIdRef.current = player.id; setSelected(player); setError(null); void loadDetail(player, gameweek); };
  const openPicker = (mode: Exclude<PickerMode, null>) => { setPlayerQuery(''); setPickerMode(mode); };
  const pickPlayer = (player: Player) => {
    if (pickerMode === 'COMPARE') setComparisonPlayer(player);
    else choose(player);
    setPickerMode(null);
  };
  const pickerPlayers = useMemo(() => {
    const query = playerQuery.trim().toLowerCase();
    return query ? pool.filter(player => `${player.web_name} ${player.team_name}`.toLowerCase().includes(query)) : pool;
  }, [playerQuery, pool]);

  const overview = useMemo(() => {
    if (!selected) return null;
    const s = selected.stats; const gi = s.goals_scored + s.assists; const xgi = s.expected_goal_involvements || s.expected_goals + s.expected_assists;
    return { s, gi, xgi, goalDelta: s.goals_scored - s.expected_goals, assistDelta: s.assists - s.expected_assists, giDelta: gi - xgi, pointsPerStart: s.total_points / Math.max(s.starts || s.appearances, 1), startRate: s.starts / Math.max(gameweek, 1) };
  }, [gameweek, selected]);

  if (loading) return <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /><Text style={styles.loadingText}>BUILDING PLAYER ANALYSIS</Text></View>;

  return <View style={styles.container}>
    <View style={styles.pickerContainer}><Text style={styles.metaLabel}>Select a player to compare actual and expected output</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerScroll}>{pool.slice(0, 24).map(player => <TouchableOpacity key={player.id} style={[styles.picker, selected?.id === player.id && styles.pickerActive]} onPress={() => choose(player)}><Text style={[styles.pickerText, selected?.id === player.id && styles.pickerTextActive]}>{player.web_name}</Text></TouchableOpacity>)}<TouchableOpacity style={styles.browsePicker} onPress={() => openPicker('PRIMARY')}><Ionicons name="search-outline" size={14} color={colors.accent} /><Text style={styles.browsePickerText}>ALL PLAYERS</Text></TouchableOpacity></ScrollView></View>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.accent} />}>
      {error && <View style={styles.error}><Ionicons name="alert-circle-outline" size={17} color={colors.warning} /><Text style={styles.errorText}>{error}</Text></View>}
      {!selected || !overview ? <View style={styles.empty}><Text style={styles.emptyText}>No active players are available for analysis.</Text></View> : <>
        <View style={styles.hero}><View style={styles.heroCopy}><Text style={styles.playerName}>{selected.web_name}</Text><Text style={styles.playerMeta}>{selected.team_name} · {selected.first_name} {selected.second_name}</Text></View><View style={styles.heroActions}><View style={[styles.position, { backgroundColor: positionColor[selected.element_type] || colors.surfaceMuted }]}><Text style={styles.positionText}>{selected.element_type}</Text></View><TouchableOpacity style={styles.compareButton} onPress={() => openPicker('COMPARE')}><Ionicons name="git-compare-outline" size={15} color={colors.accent} /><Text style={styles.compareButtonText}>{comparisonPlayer ? 'CHANGE' : 'COMPARE'}</Text></TouchableOpacity></View></View>
        <Heading title="Underlying vs actual" detail="Positive values show output above expected numbers. Treat small samples with caution." styles={styles} />
        <View style={styles.deltaGrid}><Delta label="GOALS vs xG" actual={overview.s.goals_scored} expected={overview.s.expected_goals} delta={overview.goalDelta} colors={colors} styles={styles} /><Delta label="ASSISTS vs xA" actual={overview.s.assists} expected={overview.s.expected_assists} delta={overview.assistDelta} colors={colors} styles={styles} /><Delta label="GI vs xGI" actual={overview.gi} expected={overview.xgi} delta={overview.giDelta} colors={colors} styles={styles} /></View>
        <Heading title="Manager snapshot" styles={styles} />
        <View style={styles.snapshotGrid}><Snapshot label="FORM" value={number(overview.s.recent_form)} meta="pts / appearance · last 5" styles={styles} /><Snapshot label="MINUTES" value={String(overview.s.minutes)} meta={`${overview.s.starts} starts · ${overview.s.appearances} apps`} styles={styles} /><Snapshot label="PTS / START" value={number(overview.pointsPerStart)} meta={`${overview.s.total_points} total points`} styles={styles} /><Snapshot label="START RATE" value={`${Math.round(overview.startRate * 100)}%`} meta={`${overview.s.starts} of ${gameweek} gameweeks`} styles={styles} /></View>
        <Heading title="Player comparison" detail={comparisonPlayer ? `${selected.web_name} vs ${comparisonPlayer.web_name}` : 'Compare current-season output with any active player.'} styles={styles} />
        {comparisonPlayer ? <Comparison primary={selected} comparison={comparisonPlayer} styles={styles} colors={colors} onChange={() => openPicker('COMPARE')} onClear={() => setComparisonPlayer(null)} /> : <TouchableOpacity style={styles.addComparison} onPress={() => openPicker('COMPARE')}><Ionicons name="git-compare-outline" size={19} color={colors.accent} /><View><Text style={styles.addComparisonTitle}>Add a comparison player</Text><Text style={styles.addComparisonMeta}>Compare form, output, xGI, minutes and reliability.</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textMuted} /></TouchableOpacity>}
        <Heading title="Role & scoring inputs" styles={styles} />
        <View style={styles.roleCard}><Role label="xGI" value={number(overview.xgi, 2)} icon="sparkles-outline" colors={colors} styles={styles} /><Role label="ICT" value={number(overview.s.ict_index)} icon="pulse-outline" colors={colors} styles={styles} /><Role label="BONUS" value={String(overview.s.bonus)} icon="star-outline" colors={colors} styles={styles} /><Role label={selected.element_type === 'GKP' ? 'SAVES' : 'DEFCON'} value={String(selected.element_type === 'GKP' ? overview.s.saves : overview.s.defensive_contribution)} icon={selected.element_type === 'GKP' ? 'hand-left-outline' : 'shield-checkmark-outline'} colors={colors} styles={styles} /></View>
        <Heading title="Next five fixtures" styles={styles} />
        {detailLoading ? <LoadingDetail styles={styles} colors={colors} text="Refreshing player detail" /> : fixtures.length === 0 ? <EmptyDetail text="No upcoming fixtures are available yet." styles={styles} /> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fixtureList}>{fixtures.map(fixture => <FixtureCard key={`${fixture.gameweek}-${fixture.opponent}`} fixture={fixture} colors={colors} styles={styles} />)}</ScrollView>}
        <Heading title="Recent match record" detail="Official FPL points and per-match expected output." styles={styles} />
        {detailLoading ? <LoadingDetail styles={styles} colors={colors} /> : matches.length === 0 ? <EmptyDetail text="No completed match records are available for this player." styles={styles} /> : matches.map(match => <View key={match.gameweek} style={styles.match}><View style={styles.matchHeader}><View><Text style={styles.matchTitle}>GW {match.gameweek} · {match.isHome ? 'vs' : '@'} {match.opponent}</Text><Text style={styles.matchMeta}>{match.minutes}' played</Text></View><Text style={styles.points}>{match.points} PTS</Text></View><View style={styles.matchMetrics}><Mini label="G" value={String(match.goals)} styles={styles} /><Mini label="A" value={String(match.assists)} styles={styles} /><Mini label="xG" value={number(match.xg, 2)} styles={styles} /><Mini label="xA" value={number(match.xa, 2)} styles={styles} /><Mini label="xGI" value={number(match.xg + match.xa, 2)} styles={styles} /></View></View>)}
      </>}
    </ScrollView>
    <Modal visible={pickerMode !== null} transparent animationType="fade" onRequestClose={() => setPickerMode(null)}>
      <View style={styles.selectorOverlay}><View style={styles.selectorCard}><View style={styles.selectorHeader}><View><Text style={styles.selectorEyebrow}>{pickerMode === 'COMPARE' ? 'PLAYER COMPARISON' : 'PLAYER ANALYSIS'}</Text><Text style={styles.selectorTitle}>{pickerMode === 'COMPARE' ? 'Choose comparison player' : 'Choose a player'}</Text></View><TouchableOpacity style={styles.selectorClose} onPress={() => setPickerMode(null)}><Ionicons name="close" size={20} color={colors.textPrimary} /></TouchableOpacity></View><View style={styles.searchBox}><Ionicons name="search-outline" size={17} color={colors.textMuted} /><TextInput value={playerQuery} onChangeText={setPlayerQuery} placeholder="Search player or club" placeholderTextColor={colors.textMuted} autoFocus style={styles.searchInput} /></View><ScrollView style={styles.playerResults} keyboardShouldPersistTaps="handled">{pickerPlayers.map(player => <TouchableOpacity key={player.id} style={styles.playerResult} onPress={() => pickPlayer(player)}><View style={[styles.resultPosition, { backgroundColor: positionColor[player.element_type] || colors.surfaceMuted }]}><Text style={styles.resultPositionText}>{player.element_type}</Text></View><View style={styles.resultCopy}><Text style={styles.resultName}>{player.web_name}</Text><Text style={styles.resultMeta}>{player.team_name} · {player.stats.total_points} pts</Text></View>{(pickerMode === 'PRIMARY' ? selected?.id : comparisonPlayer?.id) === player.id && <Ionicons name="checkmark-circle" size={19} color={colors.accent} />}</TouchableOpacity>)}{pickerPlayers.length === 0 && <View style={styles.noResults}><Text style={styles.noResultsText}>No active player matches that search.</Text></View>}</ScrollView></View></View>
    </Modal>
  </View>;
}

function Heading({ title, detail, styles }: { title: string; detail?: string; styles: any }) { return <View><Text style={styles.heading}>{title}</Text>{detail ? <Text style={styles.subheading}>{detail}</Text> : null}</View>; }
function Delta({ label, actual, expected, delta, colors, styles }: { label: string; actual: number; expected: number; delta: number; colors: AppColors; styles: any }) { const tone = delta > .15 ? colors.accent : delta < -.15 ? colors.danger : colors.textSecondary; const verdict = delta > .15 ? 'OVERPERFORMING' : delta < -.15 ? 'UNDERPERFORMING' : 'IN LINE'; return <View style={styles.delta}><Text style={styles.deltaLabel}>{label}</Text><View style={styles.deltaValues}><Text style={styles.actual}>{actual}</Text><Text style={styles.expected}> / {number(expected, 2)}</Text></View><Text style={[styles.deltaNumber, { color: tone }]}>{signed(delta)}</Text><Text style={[styles.verdict, { color: tone }]}>{verdict}</Text></View>; }
function Snapshot({ label, value, meta, styles }: { label: string; value: string; meta: string; styles: any }) { return <View style={styles.snapshot}><Text style={styles.snapshotLabel}>{label}</Text><Text style={styles.snapshotValue}>{value}</Text><Text numberOfLines={1} style={styles.snapshotMeta}>{meta}</Text></View>; }
function Role({ label, value, icon, colors, styles }: { label: string; value: string; icon: React.ComponentProps<typeof Ionicons>['name']; colors: AppColors; styles: any }) { return <View style={styles.role}><Ionicons name={icon} size={16} color={colors.accent} /><Text style={styles.roleValue}>{value}</Text><Text style={styles.roleLabel}>{label}</Text></View>; }
function FixtureCard({ fixture, colors, styles }: { fixture: Fixture; colors: AppColors; styles: any }) { const theme = fixture.difficulty <= 2 ? { bg: colors.accentSoft, border: colors.accentBorder, text: colors.accent } : fixture.difficulty === 3 ? { bg: colors.surfaceMuted, border: colors.border, text: colors.textPrimary } : { bg: colors.dangerSoft, border: colors.dangerBorder, text: colors.danger }; return <View style={[styles.fixture, { backgroundColor: theme.bg, borderColor: theme.border }]}><Text style={styles.fixtureGw}>GW {fixture.gameweek}</Text><Text style={[styles.fixtureOpponent, { color: theme.text }]}>{fixture.isHome ? 'vs ' : '@ '}{fixture.opponent}</Text><Text style={styles.fixtureMeta}>{fixture.isHome ? 'HOME' : 'AWAY'} · FDR {fixture.difficulty}</Text></View>; }
function Mini({ label, value, styles }: { label: string; value: string; styles: any }) { return <View style={styles.mini}><Text style={styles.miniLabel}>{label}</Text><Text style={styles.miniValue}>{value}</Text></View>; }
function LoadingDetail({ styles, colors, text }: { styles: any; colors: AppColors; text?: string }) { return <View style={styles.loadingDetail}><ActivityIndicator size="small" color={colors.accent} />{text ? <Text style={styles.loadingDetailText}>{text}</Text> : null}</View>; }
function EmptyDetail({ text, styles }: { text: string; styles: any }) { return <View style={styles.emptyDetail}><Text style={styles.emptyDetailText}>{text}</Text></View>; }
function Comparison({ primary, comparison, styles, colors, onChange, onClear }: { primary: Player; comparison: Player; styles: any; colors: AppColors; onChange: () => void; onClear: () => void }) { const metrics = [
  ['TOTAL PTS', String(primary.stats.total_points), String(comparison.stats.total_points)],
  ['FORM', number(primary.stats.recent_form), number(comparison.stats.recent_form)],
  ['PTS / START', number(primary.stats.total_points / Math.max(primary.stats.starts || primary.stats.appearances, 1)), number(comparison.stats.total_points / Math.max(comparison.stats.starts || comparison.stats.appearances, 1))],
  ['GOAL INV.', String(primary.stats.goals_scored + primary.stats.assists), String(comparison.stats.goals_scored + comparison.stats.assists)],
  ['xGI', number(primary.stats.expected_goal_involvements || primary.stats.expected_goals + primary.stats.expected_assists, 2), number(comparison.stats.expected_goal_involvements || comparison.stats.expected_goals + comparison.stats.expected_assists, 2)],
  ['MINUTES', String(primary.stats.minutes), String(comparison.stats.minutes)],
]; return <View style={styles.comparisonCard}><View style={styles.comparisonHeader}><Text style={styles.comparisonName} numberOfLines={1}>{primary.web_name}</Text><Text style={styles.comparisonVs}>VS</Text><Text style={[styles.comparisonName, styles.comparisonNameRight]} numberOfLines={1}>{comparison.web_name}</Text></View>{metrics.map(([label, left, right]) => <View key={label} style={styles.comparisonRow}><Text style={styles.comparisonValue}>{left}</Text><Text style={styles.comparisonLabel}>{label}</Text><Text style={[styles.comparisonValue, styles.comparisonValueRight]}>{right}</Text></View>)}<View style={styles.comparisonActions}><TouchableOpacity style={styles.comparisonAction} onPress={onChange}><Text style={styles.comparisonActionText}>CHANGE PLAYER</Text></TouchableOpacity><TouchableOpacity style={styles.comparisonRemove} onPress={onClear}><Text style={[styles.comparisonActionText, { color: colors.danger }]}>REMOVE</Text></TouchableOpacity></View></View>; }

const createStyles = (colors: AppColors, width: number) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: colors.background }, loadingText: { ...appTypography.label, color: colors.textMuted },
  pickerContainer: { paddingVertical: appSpacing.sm, backgroundColor: colors.backgroundElevated, borderBottomWidth: 1, borderBottomColor: colors.border }, metaLabel: { ...appTypography.label, color: colors.textSecondary, marginHorizontal: appSpacing.md, marginBottom: appSpacing.sm }, pickerScroll: { gap: 7, paddingHorizontal: appSpacing.md }, picker: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.small }, pickerActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent }, pickerText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' }, pickerTextActive: { color: colors.accent },
  browsePicker: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: appRadius.small }, browsePickerText: { ...appTypography.label, color: colors.accent, fontSize: 8 },
  content: { width: '100%', maxWidth: 900, alignSelf: 'center', padding: appSpacing.md, paddingBottom: 42 }, error: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: appSpacing.sm, padding: appSpacing.sm, backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium }, errorText: { flex: 1, color: colors.warning, fontSize: 11, fontWeight: '700' }, empty: { alignItems: 'center', padding: 40, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.large }, emptyText: { color: colors.textMuted, fontSize: 12 },
  hero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: appSpacing.sm, padding: appSpacing.md, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.large }, heroCopy: { flex: 1, minWidth: 0 }, playerName: { ...appTypography.screenTitle, color: colors.textPrimary, fontSize: 21 }, playerMeta: { ...appTypography.metadata, color: colors.textMuted, marginTop: 2 }, heroActions: { flexDirection: 'row', alignItems: 'center', gap: 7, marginLeft: appSpacing.sm }, position: { minWidth: 46, alignItems: 'center', paddingVertical: 7, borderRadius: appRadius.small }, positionText: { color: colors.black, fontSize: 10, fontWeight: '900' }, compareButton: { minHeight: 31, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: appRadius.small }, compareButtonText: { ...appTypography.label, color: colors.accent, fontSize: 8 },
  heading: { ...appTypography.sectionTitle, color: colors.textPrimary, marginTop: appSpacing.lg, marginBottom: 4 }, subheading: { ...appTypography.metadata, color: colors.textMuted, marginBottom: appSpacing.sm }, deltaGrid: { flexDirection: width > 650 ? 'row' : 'column', gap: appSpacing.sm }, delta: { flex: 1, padding: appSpacing.md, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium }, deltaLabel: { ...appTypography.label, color: colors.textMuted, fontSize: 8 }, deltaValues: { flexDirection: 'row', alignItems: 'baseline', marginTop: 5 }, actual: { color: colors.textPrimary, fontSize: 24, fontWeight: '900' }, expected: { color: colors.textMuted, fontSize: 13, fontWeight: '700' }, deltaNumber: { fontSize: 14, fontWeight: '900', marginTop: 3 }, verdict: { ...appTypography.label, fontSize: 8, marginTop: 2 },
  snapshotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: appSpacing.sm }, snapshot: { width: width > 650 ? '23.7%' : '48.5%', minHeight: 92, padding: appSpacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium }, snapshotLabel: { ...appTypography.label, color: colors.textMuted, fontSize: 8 }, snapshotValue: { color: colors.accent, fontSize: 20, fontWeight: '900', marginTop: 6 }, snapshotMeta: { ...appTypography.metadata, color: colors.textMuted, fontSize: 8, marginTop: 4 },
  addComparison: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 10, padding: appSpacing.md, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: appRadius.medium }, addComparisonTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' }, addComparisonMeta: { ...appTypography.metadata, flex: 1, color: colors.textMuted, marginTop: 2 }, comparisonCard: { padding: appSpacing.md, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: appRadius.medium }, comparisonHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: appSpacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }, comparisonName: { flex: 1, color: colors.textPrimary, fontSize: 12, fontWeight: '900' }, comparisonNameRight: { textAlign: 'right' }, comparisonVs: { ...appTypography.label, color: colors.accent, fontSize: 9 }, comparisonRow: { flexDirection: 'row', alignItems: 'center', minHeight: 33, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }, comparisonValue: { flex: 1, color: colors.textPrimary, fontSize: 12, fontWeight: '900' }, comparisonValueRight: { textAlign: 'right' }, comparisonLabel: { width: 86, ...appTypography.label, color: colors.textMuted, fontSize: 8, textAlign: 'center' }, comparisonActions: { flexDirection: 'row', gap: 8, marginTop: appSpacing.sm }, comparisonAction: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderRadius: appRadius.small }, comparisonRemove: { minHeight: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: colors.surface, borderRadius: appRadius.small }, comparisonActionText: { ...appTypography.label, color: colors.accent, fontSize: 8 },
  roleCard: { flexDirection: 'row', justifyContent: 'space-between', gap: 4, padding: appSpacing.sm, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium }, role: { flex: 1, alignItems: 'center', gap: 3 }, roleValue: { color: colors.textPrimary, fontSize: 16, fontWeight: '900' }, roleLabel: { ...appTypography.label, color: colors.textMuted, fontSize: 8 },
  fixtureList: { gap: appSpacing.sm }, fixture: { width: 108, minHeight: 82, justifyContent: 'center', padding: appSpacing.sm, borderWidth: 1, borderRadius: appRadius.medium }, fixtureGw: { ...appTypography.label, color: colors.textMuted, fontSize: 8 }, fixtureOpponent: { fontSize: 16, fontWeight: '900', marginTop: 4 }, fixtureMeta: { ...appTypography.label, color: colors.textMuted, fontSize: 8, marginTop: 4 }, loadingDetail: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium }, loadingDetailText: { ...appTypography.metadata, color: colors.textMuted }, emptyDetail: { minHeight: 68, alignItems: 'center', justifyContent: 'center', padding: appSpacing.md, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium }, emptyDetailText: { ...appTypography.metadata, color: colors.textMuted, textAlign: 'center' },
  match: { marginBottom: appSpacing.sm, padding: appSpacing.md, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium }, matchHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: appSpacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }, matchTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '900' }, matchMeta: { ...appTypography.metadata, color: colors.textMuted, marginTop: 2 }, points: { color: colors.accent, fontSize: 15, fontWeight: '900' }, matchMetrics: { flexDirection: 'row', gap: 6, marginTop: appSpacing.sm }, mini: { flex: 1, alignItems: 'center', paddingVertical: 7, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: appRadius.small }, miniLabel: { ...appTypography.label, color: colors.textMuted, fontSize: 8 }, miniValue: { color: colors.textPrimary, fontSize: 12, fontWeight: '800', marginTop: 2 },
  selectorOverlay: { flex: 1, justifyContent: 'center', padding: appSpacing.md, backgroundColor: 'rgba(0,0,0,0.8)' }, selectorCard: { maxHeight: '82%', backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: appRadius.large, overflow: 'hidden' }, selectorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: appSpacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, selectorEyebrow: { ...appTypography.label, color: colors.accent, fontSize: 8 }, selectorTitle: { ...appTypography.sectionTitle, color: colors.textPrimary, marginTop: 2 }, selectorClose: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: 17 }, searchBox: { flexDirection: 'row', alignItems: 'center', gap: 7, margin: appSpacing.md, paddingHorizontal: appSpacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.small }, searchInput: { flex: 1, minHeight: 40, color: colors.textPrimary, fontSize: 13 }, playerResults: { borderTopWidth: 1, borderTopColor: colors.border }, playerResult: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: appSpacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }, resultPosition: { width: 34, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: appRadius.small }, resultPositionText: { color: colors.black, fontSize: 8, fontWeight: '900' }, resultCopy: { flex: 1, minWidth: 0 }, resultName: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' }, resultMeta: { ...appTypography.metadata, color: colors.textMuted, marginTop: 2 }, noResults: { padding: 28, alignItems: 'center' }, noResultsText: { ...appTypography.metadata, color: colors.textMuted },
});
