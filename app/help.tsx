import React, { useEffect, useMemo, useState } from 'react';
import {
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
import Head from 'expo-router/head';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { HELP_SECTIONS, HelpSection } from '@/features/help/helpContent';
import { resetFirstVisitGuides } from '@/components/FirstVisitGuide';

const normalize = (value: string) => value.trim().toLowerCase();

const sectionSearchText = (section: HelpSection) => normalize([
  section.title,
  section.summary,
  ...section.keywords,
  ...section.items.flatMap(item => [item.title, item.body, item.tip || '']),
].join(' '));

export default function HelpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  const { colors } = useAppTheme();
  const { currentUserId } = useAppSession();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const requestedSection = Array.isArray(params.section) ? params.section[0] : params.section;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([requestedSection || 'getting-started'])
  );

  useEffect(() => {
    if (requestedSection && HELP_SECTIONS.some(section => section.id === requestedSection)) {
      setExpanded(current => new Set([...current, requestedSection]));
    }
  }, [requestedSection]);

  const filteredSections = useMemo(() => {
    const term = normalize(query);
    if (!term) return HELP_SECTIONS;

    return HELP_SECTIONS
      .filter(section => sectionSearchText(section).includes(term))
      .map(section => {
        const sectionMatch = normalize([
          section.title,
          section.summary,
          ...section.keywords,
        ].join(' ')).includes(term);
        if (sectionMatch) return section;
        return {
          ...section,
          items: section.items.filter(item => normalize(`${item.title} ${item.body} ${item.tip || ''}`).includes(term)),
        };
      });
  }, [query]);

  const toggleSection = (sectionId: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const searching = Boolean(normalize(query));

  const replayWalkthroughs = async () => {
    await resetFirstVisitGuides(currentUserId);
    const message = 'Walkthroughs have been reset. Open Home, Squad, Players, Market, League Hub or the Draft Room to see its guide again.';
    if (Platform.OS === 'web') window.alert(`Walkthroughs reset\n\n${message}`);
    else Alert.alert('Walkthroughs reset', message);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <Head>
        <title>Help Centre | FPL Draft Manager</title>
        <meta name="description" content="How to use FPL Draft Manager: drafting, squads, waivers, free agents, trades, live scoring, leagues and account settings." />
      </Head>

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/login')}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>FPL DRAFT MANAGER</Text>
          <Text style={styles.headerTitle}>Help Centre</Text>
        </View>
        <View style={styles.headerBadge}>
          <Ionicons name="help-circle-outline" size={22} color={colors.accent} />
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>APP GUIDE</Text>
          <Text style={styles.heroTitle}>What would you like help with?</Text>
          <Text style={styles.heroBody}>Search for a feature or open a topic below. League-specific point values are available separately from the Rules button in League Hub.</Text>
          {currentUserId ? (
            <TouchableOpacity
              style={styles.replayWalkthroughButton}
              onPress={() => void replayWalkthroughs()}
              accessibilityLabel="Replay screen walkthroughs"
            >
              <Ionicons name="play-circle-outline" size={18} color={colors.accent} />
              <Text style={styles.replayWalkthroughText}>REPLAY SCREEN WALKTHROUGHS</Text>
            </TouchableOpacity>
          ) : null}
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={20} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search drafts, waivers, trades…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Search the help guide"
            />
            {query ? (
              <TouchableOpacity style={styles.clearButton} onPress={() => setQuery('')} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={19} color={colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {filteredSections.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="search-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No matching help topic</Text>
            <Text style={styles.emptyBody}>Try a shorter term, or clear the search and browse all topics.</Text>
          </View>
        ) : (
          filteredSections.map(section => {
            const isExpanded = searching || expanded.has(section.id);
            return (
              <View key={section.id} style={styles.sectionCard}>
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={() => toggleSection(section.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                >
                  <View style={styles.sectionIcon}>
                    <Ionicons name={section.icon as any} size={20} color={colors.accent} />
                  </View>
                  <View style={styles.sectionCopy}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                    <Text style={styles.sectionSummary}>{section.summary}</Text>
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>

                {isExpanded ? (
                  <View style={styles.answerList}>
                    {section.items.map(item => (
                      <View key={`${section.id}-${item.title}`} style={styles.answerItem}>
                        <Text style={styles.answerTitle}>{item.title}</Text>
                        <Text style={styles.answerBody}>{item.body}</Text>
                        {item.tip ? (
                          <View style={styles.tipRow}>
                            <Ionicons name="bulb-outline" size={14} color={colors.warning} />
                            <Text style={styles.tipText}>{item.tip}</Text>
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })
        )}

        <View style={styles.supportCard}>
          <View style={styles.supportIcon}><Ionicons name="chatbox-ellipses-outline" size={22} color={colors.accentForeground} /></View>
          <View style={styles.supportCopy}>
            <Text style={styles.supportTitle}>Found a problem?</Text>
            <Text style={styles.supportBody}>Signed-in beta testers can send a report from Settings → Tester Feedback.</Text>
          </View>
        </View>

        <Text style={styles.publicNote}>Public guide: fpl-draft-manager.vercel.app/help</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, backgroundColor: colors.backgroundDeep, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0, paddingHorizontal: 7 },
  headerEyebrow: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  headerTitle: { ...appTypography.screenTitle, color: colors.textPrimary, fontSize: 18, marginTop: 1 },
  headerBadge: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: 12 },
  scrollView: { flex: 1 },
  content: { width: '100%', maxWidth: 840, alignSelf: 'center', padding: appSpacing.md, paddingBottom: 44, gap: 9 },
  heroCard: { padding: appSpacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: appRadius.large },
  heroEyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  heroTitle: { color: colors.textPrimary, fontSize: 21, fontWeight: '900', marginTop: 3 },
  heroBody: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', lineHeight: 17, marginTop: 5 },
  replayWalkthroughButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 39, marginTop: 13, paddingHorizontal: 12, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: appRadius.small },
  replayWalkthroughText: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.35 },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14, paddingHorizontal: 13, backgroundColor: colors.backgroundDeep, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: appRadius.medium },
  searchInput: { flex: 1, minWidth: 0, color: colors.textPrimary, fontSize: 13, fontWeight: '700', paddingVertical: 10 },
  clearButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  sectionCard: { overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium },
  sectionHeader: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12 },
  sectionIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: 11 },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '900' },
  sectionSummary: { color: colors.textMuted, fontSize: 9.5, fontWeight: '600', lineHeight: 14, marginTop: 3 },
  answerList: { borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingHorizontal: 13 },
  answerItem: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  answerTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '900' },
  answerBody: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', lineHeight: 17, marginTop: 4 },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, padding: 8, backgroundColor: colors.warningSoft, borderRadius: appRadius.small },
  tipText: { flex: 1, color: colors.textSecondary, fontSize: 9.5, fontWeight: '700', lineHeight: 14 },
  emptyCard: { alignItems: 'center', padding: 28, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium },
  emptyTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 8 },
  emptyBody: { maxWidth: 360, color: colors.textMuted, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 4 },
  supportCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: appRadius.medium },
  supportIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentFill, borderRadius: 12 },
  supportCopy: { flex: 1, minWidth: 0 },
  supportTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '900' },
  supportBody: { color: colors.textSecondary, fontSize: 9.5, fontWeight: '600', lineHeight: 14, marginTop: 2 },
  publicNote: { color: colors.textMuted, fontSize: 9, fontWeight: '700', textAlign: 'center', marginTop: 6 },
});

