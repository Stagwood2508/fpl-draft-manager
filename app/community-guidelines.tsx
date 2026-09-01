import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Head from 'expo-router/head';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

const RULES = [
  'Treat other managers respectfully. Harassment, bullying, threats, hate speech and targeted abuse are prohibited.',
  'Do not post sexual, violent, illegal, dangerous or exploitative content.',
  'Do not share another person’s private information or impersonate another person.',
  'Do not post spam, scams, malicious links or repeated unwanted promotions.',
  'Shared links and podcast content must follow the same rules as written messages.',
];

export default function CommunityGuidelinesScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <SafeAreaView style={styles.safe}>
      <Head><title>Community Guidelines | FPL Draft Manager</title></Head>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerCopy}><Text style={styles.eyebrow}>LEAGUE LOUNGE</Text><Text style={styles.title}>Community Guidelines</Text><Text style={styles.updated}>Effective 1 September 2026</Text></View>
          <TouchableOpacity style={styles.closeButton} onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/login')}><Text style={styles.closeText}>CLOSE</Text></TouchableOpacity>
        </View>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>A private league space</Text>
          <Text style={styles.body}>The League Lounge is visible only to current members of the selected fantasy league. Messages should still be treated as shared content: other managers may retain or report what is posted.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Posting rules</Text>
          {RULES.map(rule => <View key={rule} style={styles.ruleRow}><Text style={styles.ruleMark}>•</Text><Text style={styles.ruleText}>{rule}</Text></View>)}
        </View>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Reporting, blocking and moderation</Text>
          <Text style={styles.body}>Managers can report a message and block its author from the message-options menu. League commissioners can pin or remove messages. Reports must be reviewed and appropriate action taken; serious or repeated misuse may result in Lounge or account access being restricted.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Agreement</Text>
          <Text style={styles.body}>You must accept these guidelines before posting in the Lounge. Continuing to use the Lounge after an updated policy is presented means accepting the updated version.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 820, alignSelf: 'center', padding: appSpacing.lg, paddingBottom: 48, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  title: { ...appTypography.screenTitle, color: colors.textPrimary, marginTop: 5 },
  updated: { color: colors.textMuted, fontSize: 11, marginTop: 5 },
  closeButton: { paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.small },
  closeText: { color: colors.textSecondary, fontSize: 10, fontWeight: '900' },
  card: { padding: appSpacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium, backgroundColor: colors.surface },
  sectionTitle: { ...appTypography.sectionTitle, color: colors.textPrimary, marginBottom: 10 },
  body: { color: colors.textSecondary, fontSize: 13, lineHeight: 21 },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  ruleMark: { width: 18, color: colors.accent, fontSize: 15, lineHeight: 20 },
  ruleText: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
});
