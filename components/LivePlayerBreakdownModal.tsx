import React, { useMemo } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppColors } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

export interface LivePlayerScore {
  fixture_id: string;
  user_id: string;
  fixture_side: 'HOME' | 'AWAY';
  manager_team_name: string;
  player_id: number;
  player_name: string;
  club_name: string;
  position: string;
  minutes: number;
  fpl_points: number;
  defcon_points: number;
  combined_points: number;
  appearance_points: number;
  goal_count: number;
  goal_points: number;
  assist_count: number;
  assist_points: number;
  clean_sheet_count: number;
  clean_sheet_points: number;
  goals_conceded_count: number;
  goals_conceded_points: number;
  save_count: number;
  save_points: number;
  penalties_saved_count: number;
  penalties_saved_points: number;
  penalties_missed_count: number;
  penalties_missed_points: number;
  own_goal_count: number;
  own_goal_points: number;
  yellow_card_count: number;
  yellow_card_points: number;
  red_card_count: number;
  red_card_points: number;
  bonus_points: number;
  other_fpl_points: number;
  bps: number;
  defensive_contribution: number;
  clearances_blocks_interceptions: number;
  recoveries: number;
  tackles: number;
  stats_updated_at: string | null;
  lineup_status: string;
}

interface Props {
  visible: boolean;
  player: LivePlayerScore | null;
  gameweek: number;
  onClose: () => void;
}

interface BreakdownRow {
  label: string;
  detail: string;
  points: number;
}

const isGoalkeeper = (position: string) => ['1', 'GK', 'GKP'].includes(position.toUpperCase());
const isDefender = (position: string) => ['2', 'DEF'].includes(position.toUpperCase());
const isMidfielder = (position: string) => ['3', 'MID'].includes(position.toUpperCase());

const formatUpdatedAt = (value: string | null) => {
  if (!value) return 'Awaiting first live update';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Live update received';
  return `Updated ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export default function LivePlayerBreakdownModal({ visible, player, gameweek, onClose }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!player) return null;

  const goalkeeper = isGoalkeeper(player.position);
  const defender = isDefender(player.position);
  const midfielder = isMidfielder(player.position);

  const rows: BreakdownRow[] = [
    { label: 'Appearance', detail: `${player.minutes} minutes`, points: player.appearance_points },
    { label: 'Goals', detail: `${player.goal_count}`, points: player.goal_points },
    { label: 'Assists', detail: `${player.assist_count}`, points: player.assist_points },
    ...((goalkeeper || defender || midfielder) ? [{
      label: 'Clean sheets', detail: `${player.clean_sheet_count}`, points: player.clean_sheet_points,
    }] : []),
    ...((goalkeeper || defender) ? [{
      label: 'Goals conceded', detail: `${player.goals_conceded_count}`, points: player.goals_conceded_points,
    }] : []),
    ...(goalkeeper ? [
      { label: 'Saves', detail: `${player.save_count}`, points: player.save_points },
      { label: 'Penalties saved', detail: `${player.penalties_saved_count}`, points: player.penalties_saved_points },
    ] : []),
    { label: 'Penalties missed', detail: `${player.penalties_missed_count}`, points: player.penalties_missed_points },
    { label: 'Own goals', detail: `${player.own_goal_count}`, points: player.own_goal_points },
    { label: 'Yellow cards', detail: `${player.yellow_card_count}`, points: player.yellow_card_points },
    { label: 'Red cards', detail: `${player.red_card_count}`, points: player.red_card_points },
    { label: 'Bonus', detail: `${player.bps} BPS`, points: player.bonus_points },
    ...(player.other_fpl_points !== 0 ? [{
      label: 'Live FPL adjustment', detail: 'Official total reconciliation', points: player.other_fpl_points,
    }] : []),
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <SafeAreaView style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>GAMEWEEK {gameweek} · {player.manager_team_name}</Text>
              <Text style={styles.playerName}>{player.player_name}</Text>
              <Text style={styles.playerMeta}>{player.club_name} · {player.position} · {player.minutes}'</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityLabel="Close score breakdown">
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.totalStrip}>
            <View>
              <Text style={styles.totalLabel}>LIVE TOTAL</Text>
              <Text style={styles.totalValue}>{player.combined_points}</Text>
            </View>
            <View style={styles.totalParts}>
              <View style={styles.totalPart}>
                <Text style={styles.totalPartValue}>{player.fpl_points}</Text>
                <Text style={styles.totalPartLabel}>FPL</Text>
              </View>
              <Text style={styles.totalPlus}>+</Text>
              <View style={styles.totalPart}>
                <Text style={styles.totalPartValue}>{player.defcon_points}</Text>
                <Text style={styles.totalPartLabel}>DEFCON</Text>
              </View>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionTitle}>FPL SCORING</Text>
            <View style={styles.breakdownTable}>
              {rows.map((row) => (
                <View key={row.label} style={styles.breakdownRow}>
                  <View style={styles.breakdownCopy}>
                    <Text style={styles.breakdownLabel}>{row.label}</Text>
                    <Text style={styles.breakdownDetail}>{row.detail}</Text>
                  </View>
                  <Text style={[
                    styles.breakdownPoints,
                    row.points > 0 && styles.positivePoints,
                    row.points < 0 && styles.negativePoints,
                  ]}>
                    {row.points > 0 ? '+' : ''}{row.points}
                  </Text>
                </View>
              ))}
            </View>

            <Text style={styles.sectionTitle}>DEFCON</Text>
            <View style={styles.defconCard}>
              {goalkeeper ? (
                <Text style={styles.defconExplanation}>Goalkeepers are not eligible for DEFCON points.</Text>
              ) : (
                <>
                  <View style={styles.defconHeadline}>
                    <View>
                      <Text style={styles.defconValue}>{player.defensive_contribution}</Text>
                      <Text style={styles.defconValueLabel}>CONTRIBUTIONS</Text>
                    </View>
                    <View style={styles.defconAward}>
                      <Text style={styles.defconAwardValue}>+{player.defcon_points}</Text>
                      <Text style={styles.defconValueLabel}>POINTS</Text>
                    </View>
                  </View>
                  <View style={styles.metricGrid}>
                    <View style={styles.metric}><Text style={styles.metricValue}>{player.clearances_blocks_interceptions}</Text><Text style={styles.metricLabel}>CBI</Text></View>
                    <View style={styles.metric}><Text style={styles.metricValue}>{player.recoveries}</Text><Text style={styles.metricLabel}>RECOVERIES</Text></View>
                    <View style={styles.metric}><Text style={styles.metricValue}>{player.tackles}</Text><Text style={styles.metricLabel}>TACKLES</Text></View>
                  </View>
                </>
              )}
            </View>

            <Text style={styles.updateText}>{formatUpdatedAt(player.stats_updated_at)} · {player.lineup_status} lineup</Text>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.72)', alignItems: 'center', justifyContent: 'center', padding: 14 },
  card: { width: '100%', maxWidth: 620, maxHeight: '92%', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, backgroundColor: colors.backgroundDeep, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerCopy: { flex: 1, paddingRight: 12 },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  playerName: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', marginTop: 3 },
  playerMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', marginTop: 4 },
  closeButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  totalStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 13, backgroundColor: colors.accentSoft, borderBottomWidth: 1, borderBottomColor: colors.accentBorder },
  totalLabel: { color: colors.textSecondary, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  totalValue: { color: colors.accent, fontSize: 34, fontWeight: '900', lineHeight: 37 },
  totalParts: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  totalPart: { alignItems: 'center', minWidth: 46 },
  totalPartValue: { color: colors.textPrimary, fontSize: 19, fontWeight: '900' },
  totalPartLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '900', marginTop: 1 },
  totalPlus: { color: colors.textMuted, fontSize: 17, fontWeight: '900' },
  scrollContent: { padding: 16, paddingBottom: 22 },
  sectionTitle: { color: colors.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 0.7, marginBottom: 7, marginTop: 4 },
  breakdownTable: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden', marginBottom: 15 },
  breakdownRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  breakdownCopy: { flex: 1 },
  breakdownLabel: { color: colors.textPrimary, fontSize: 11, fontWeight: '800' },
  breakdownDetail: { color: colors.textMuted, fontSize: 9, marginTop: 1 },
  breakdownPoints: { width: 42, color: colors.textMuted, fontSize: 13, fontWeight: '900', textAlign: 'right' },
  positivePoints: { color: colors.accent },
  negativePoints: { color: colors.danger },
  defconCard: { padding: 13, borderRadius: 8, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  defconExplanation: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', textAlign: 'center', paddingVertical: 6 },
  defconHeadline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  defconValue: { color: colors.textPrimary, fontSize: 24, fontWeight: '900' },
  defconAward: { alignItems: 'flex-end' },
  defconAwardValue: { color: colors.accent, fontSize: 24, fontWeight: '900' },
  defconValueLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '900', letterSpacing: 0.4 },
  metricGrid: { flexDirection: 'row', marginTop: 12, paddingTop: 11, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '900' },
  metricLabel: { color: colors.textMuted, fontSize: 7, fontWeight: '900', marginTop: 2 },
  updateText: { color: colors.textMuted, fontSize: 8, fontWeight: '700', textAlign: 'center', textTransform: 'uppercase' },
});
