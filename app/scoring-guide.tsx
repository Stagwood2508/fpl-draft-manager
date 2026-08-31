import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { AppColors } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

interface DefconTier {
  threshold: number;
  points: number;
}

interface DefconConfig {
  tier_1: DefconTier;
  tier_2: DefconTier;
  tier_3: DefconTier;
}

interface ScoringGuide {
  success: boolean;
  league_id: string;
  league_name: string;
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
  defcon_thresholds_def: DefconConfig;
  defcon_thresholds_mid: DefconConfig;
  defcon_thresholds_fwd: DefconConfig;
}

const formatPoints = (value: number) => value > 0 ? `+${value}` : String(value);

function RuleRow({ label, value, detail, colors, styles }: {
  label: string;
  value: string;
  detail?: string;
  colors: AppColors;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.ruleRow}>
      <View style={styles.ruleCopy}>
        <Text style={styles.ruleLabel}>{label}</Text>
        {detail ? <Text style={styles.ruleDetail}>{detail}</Text> : null}
      </View>
      <View style={[styles.pointsPill, value.startsWith('-') && styles.negativePointsPill]}>
        <Text style={[styles.pointsValue, value.startsWith('-') && { color: colors.danger }]}>{value}</Text>
        <Text style={styles.pointsUnit}>PTS</Text>
      </View>
    </View>
  );
}

function DefconCard({ position, description, tiers, styles }: {
  position: string;
  description: string;
  tiers: DefconConfig;
  styles: ReturnType<typeof createStyles>;
}) {
  const orderedTiers = [tiers.tier_1, tiers.tier_2, tiers.tier_3];
  return (
    <View style={styles.defconCard}>
      <View style={styles.defconHeader}>
        <View style={styles.positionBadge}><Text style={styles.positionBadgeText}>{position}</Text></View>
        <View style={styles.defconHeaderCopy}>
          <Text style={styles.defconTitle}>{position === 'DEF' ? 'Defenders' : position === 'MID' ? 'Midfielders' : 'Forwards'}</Text>
          <Text style={styles.defconDescription}>{description}</Text>
        </View>
      </View>
      <View style={styles.tierGrid}>
        {orderedTiers.map((tier, index) => (
          <View key={`${position}-tier-${index + 1}`} style={styles.tierCell}>
            <Text style={styles.tierLabel}>TIER {index + 1}</Text>
            <Text style={styles.tierThreshold}>{tier.threshold}</Text>
            <Text style={styles.tierActions}>actions</Text>
            <Text style={styles.tierPoints}>+{tier.points} pts</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function ScoringGuideScreen() {
  const router = useRouter();
  const { activeLeagueId } = useAppSession();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [guide, setGuide] = useState<ScoringGuide | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGuide = useCallback(async () => {
    if (!activeLeagueId) {
      setError('Select an active league to view its scoring rules.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: guideError } = await supabase.rpc('get_league_scoring_guide', {
        p_league_id: activeLeagueId,
      });
      if (guideError) throw guideError;
      if (!data?.success) throw new Error('The scoring guide could not be loaded.');
      setGuide(data as ScoringGuide);
    } catch (loadError: any) {
      setError(loadError?.message || 'The scoring guide could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [activeLeagueId]);

  useEffect(() => { void loadGuide(); }, [loadGuide]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={21} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>SCORING RULES</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{guide?.league_name || 'League scoring guide'}</Text>
        </View>
        <View style={styles.headerIcon}><Ionicons name="calculator-outline" size={19} color={colors.accent} /></View>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.accent} /><Text style={styles.loadingText}>Loading league rules…</Text></View>
      ) : error || !guide ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={30} color={colors.danger} />
          <Text style={styles.errorText}>{error || 'Scoring rules are unavailable.'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void loadGuide()}><Text style={styles.retryText}>TRY AGAIN</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={styles.heroIcon}><Ionicons name="shield-checkmark-outline" size={24} color={colors.accentForeground} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>LIVE LEAGUE CONFIGURATION</Text>
              <Text style={styles.heroTitle}>{guide.league_name}</Text>
              <Text style={styles.heroBody}>These are the point values currently saved for this league. DEFCON replaces the official defensive-contribution award.</Text>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="football-outline" size={18} color={colors.accent} />
              <View><Text style={styles.sectionTitle}>Attacking returns</Text><Text style={styles.sectionSubtitle}>Your league’s configured rewards and penalties</Text></View>
            </View>
            <RuleRow label="Goal scored · Defender" value={formatPoints(guide.points_goal_def)} colors={colors} styles={styles} />
            <RuleRow label="Goal scored · Midfielder" value={formatPoints(guide.points_goal_mid)} colors={colors} styles={styles} />
            <RuleRow label="Goal scored · Forward" value={formatPoints(guide.points_goal_fwd)} colors={colors} styles={styles} />
            <RuleRow label="Assist · Any position" value={formatPoints(guide.points_assist)} colors={colors} styles={styles} />
            <RuleRow label="Penalty missed" value={formatPoints(guide.points_penalty_miss)} colors={colors} styles={styles} />
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="shield-outline" size={18} color={colors.accent} />
              <View><Text style={styles.sectionTitle}>Defending & discipline</Text><Text style={styles.sectionSubtitle}>Your league’s configured scoring</Text></View>
            </View>
            <RuleRow label="Clean sheet · Goalkeeper/Defender" detail="Requires at least 60 minutes" value={formatPoints(guide.points_clean_sheet_def)} colors={colors} styles={styles} />
            <RuleRow label="Clean sheet · Midfielder" detail="Requires at least 60 minutes" value={formatPoints(guide.points_clean_sheet_mid)} colors={colors} styles={styles} />
            <RuleRow label="Penalty saved · Goalkeeper" value={formatPoints(guide.points_penalty_save)} colors={colors} styles={styles} />
            <RuleRow label="Yellow card" value={formatPoints(guide.points_yellow_card)} colors={colors} styles={styles} />
            <RuleRow label="Red card" value={formatPoints(guide.points_red_card)} colors={colors} styles={styles} />
            <RuleRow label="Own goal" value={formatPoints(guide.points_own_goal)} colors={colors} styles={styles} />
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="timer-outline" size={18} color={colors.accent} />
              <View><Text style={styles.sectionTitle}>Standard scoring</Text><Text style={styles.sectionSubtitle}>Shared rules that are not customized per league</Text></View>
            </View>
            <RuleRow label="Played up to 60 minutes" value="+1" colors={colors} styles={styles} />
            <RuleRow label="Played 60 minutes or more" value="+2" colors={colors} styles={styles} />
            <RuleRow label="Every 3 goalkeeper saves" value="+1" colors={colors} styles={styles} />
            <RuleRow label="Every 2 goals conceded · GKP/DEF" value="-1" colors={colors} styles={styles} />
            <RuleRow label="Bonus points" detail="Awarded to the leading BPS performers" value="+1–3" colors={colors} styles={styles} />
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="analytics-outline" size={18} color={colors.accent} />
              <View><Text style={styles.sectionTitle}>Custom DEFCON tiers</Text><Text style={styles.sectionSubtitle}>Only the highest tier reached is awarded</Text></View>
            </View>
            <DefconCard position="DEF" description="Clearances, blocks, interceptions and tackles" tiers={guide.defcon_thresholds_def} styles={styles} />
            <DefconCard position="MID" description="Clearances, blocks, interceptions, recoveries and tackles" tiers={guide.defcon_thresholds_mid} styles={styles} />
            <DefconCard position="FWD" description="Clearances, blocks, interceptions, recoveries and tackles" tiers={guide.defcon_thresholds_fwd} styles={styles} />
            <View style={styles.infoNote}>
              <Ionicons name="information-circle-outline" size={16} color={colors.info} />
              <Text style={styles.infoNoteText}>Goalkeepers do not receive DEFCON points. Tiers are not cumulative: reaching Tier 3 awards only the Tier 3 value.</Text>
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, backgroundColor: colors.backgroundDeep, borderBottomWidth: 1, borderBottomColor: colors.border },
  backButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0, paddingHorizontal: 7 },
  headerTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
  headerSubtitle: { color: colors.textMuted, fontSize: 9, fontWeight: '700', marginTop: 2 },
  headerIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26, gap: 10 },
  loadingText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  errorText: { maxWidth: 360, color: colors.textSecondary, fontSize: 12, fontWeight: '700', lineHeight: 18, textAlign: 'center' },
  retryButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 20, backgroundColor: colors.accentFill, borderRadius: 8 },
  retryText: { color: colors.accentForeground, fontSize: 10, fontWeight: '900' },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 12, paddingBottom: 34, gap: 10 },
  heroCard: { flexDirection: 'row', gap: 11, padding: 14, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: 12 },
  heroIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentFill, borderRadius: 10 },
  heroCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.75 },
  heroTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 2 },
  heroBody: { color: colors.textSecondary, fontSize: 10, fontWeight: '600', lineHeight: 15, marginTop: 4 },
  sectionCard: { padding: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  sectionTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '900' },
  sectionSubtitle: { color: colors.textMuted, fontSize: 8, fontWeight: '700', marginTop: 2 },
  ruleRow: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  ruleCopy: { flex: 1, minWidth: 0 },
  ruleLabel: { color: colors.textPrimary, fontSize: 11, fontWeight: '800' },
  ruleDetail: { color: colors.textMuted, fontSize: 8, fontWeight: '600', marginTop: 2 },
  pointsPill: { minWidth: 48, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: 8 },
  negativePointsPill: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder },
  pointsValue: { color: colors.accent, fontSize: 13, fontWeight: '900' },
  pointsUnit: { color: colors.textMuted, fontSize: 6, fontWeight: '900', marginTop: 1 },
  defconCard: { marginTop: 10, padding: 10, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: 10 },
  defconHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  positionBadge: { minWidth: 39, alignItems: 'center', paddingHorizontal: 7, paddingVertical: 5, backgroundColor: colors.accentFill, borderRadius: 6 },
  positionBadgeText: { color: colors.accentForeground, fontSize: 9, fontWeight: '900' },
  defconHeaderCopy: { flex: 1, minWidth: 0 },
  defconTitle: { color: colors.textPrimary, fontSize: 11, fontWeight: '900' },
  defconDescription: { color: colors.textMuted, fontSize: 7.5, fontWeight: '600', marginTop: 2 },
  tierGrid: { flexDirection: 'row', gap: 6, marginTop: 9 },
  tierCell: { flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  tierLabel: { color: colors.textMuted, fontSize: 6.5, fontWeight: '900', letterSpacing: 0.45 },
  tierThreshold: { color: colors.textPrimary, fontSize: 18, lineHeight: 20, fontWeight: '900', marginTop: 3 },
  tierActions: { color: colors.textMuted, fontSize: 7, fontWeight: '700' },
  tierPoints: { color: colors.accent, fontSize: 10, fontWeight: '900', marginTop: 4 },
  infoNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 10, padding: 9, backgroundColor: colors.infoSoft, borderWidth: 1, borderColor: colors.info, borderRadius: 8 },
  infoNoteText: { flex: 1, color: colors.textSecondary, fontSize: 8.5, fontWeight: '700', lineHeight: 13 },
});
