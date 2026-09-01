import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

const LAST_UPDATED = '1 September 2026';

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.safe}>
      <Head>
        <title>Privacy Policy | FPL Draft Manager</title>
        <meta name="description" content="Privacy policy for FPL Draft Manager." />
      </Head>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>PUBLIC INFORMATION</Text>
            <Text style={styles.title}>FPL Draft Manager Privacy Policy</Text>
            <Text style={styles.updated}>Last updated: {LAST_UPDATED}</Text>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/login')}>
            <Text style={styles.closeButtonText}>CLOSE</Text>
          </TouchableOpacity>
        </View>

        <PolicySection title="Who this policy applies to">
          <BodyText>This policy explains how FPL Draft Manager handles information when you create an account or participate in a fantasy football league. For the purposes of this policy, the app and developer are identified as FPL Draft Manager.</BodyText>
        </PolicySection>

        <PolicySection title="Information we collect">
          <Bullet text="Account information, including your email address, profile name and authentication identifier." />
          <Bullet text="Fantasy-league information, including memberships, team names, squads, lineups, draft choices, waiver claims, free-agent activity, trades, fixtures, scores and competition results." />
          <Bullet text="League Lounge content, including messages, reactions, reports, blocks and your acceptance of the community guidelines." />
          <Bullet text="Notification preferences and device push tokens when you enable push notifications." />
          <Bullet text="Tester feedback, crash reports and technical information such as app version, platform, route and error details." />
        </PolicySection>

        <PolicySection title="How we use information">
          <Bullet text="To create and secure your account and provide league, draft, transaction, scoring and notification features." />
          <Bullet text="To show league activity to the other managers participating in the same league." />
          <Bullet text="To provide and moderate private league conversations, investigate reports and enforce the community guidelines." />
          <Bullet text="To operate, troubleshoot, protect and improve the app, and respond to support or privacy requests." />
          <BodyText>We do not sell personal information or use it for third-party advertising.</BodyText>
        </PolicySection>

        <PolicySection title="Services that process data">
          <BodyText>The app uses service providers necessary to operate the product, including Supabase for authentication and database services, Expo/EAS for app delivery and updates, Firebase Cloud Messaging for Android push delivery, and Vercel for the web app. These services may process technical or account information on our behalf under their own security and privacy terms.</BodyText>
        </PolicySection>

        <PolicySection title="Security and international processing">
          <BodyText>Connections use encrypted HTTPS transport. Database access is protected through authentication, row-level access rules and restricted server functions. Service providers may process information in countries outside your own; where applicable, their contractual safeguards and data-processing terms govern those transfers.</BodyText>
        </PolicySection>

        <PolicySection title="Retention and deletion">
          <BodyText>Account and active-league information is retained while your account is operating. When you delete your account, authentication data, memberships, personal preferences, squads and other directly associated personal records are deleted or anonymised. Limited technical error and league audit information may be retained without an active account link where necessary for security, reliability, dispute resolution or preserving completed competition records.</BodyText>
          <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/delete-account')}>
            <Text style={styles.primaryButtonText}>REQUEST OR COMPLETE ACCOUNT DELETION</Text>
          </TouchableOpacity>
        </PolicySection>

        <PolicySection title="Your choices and rights">
          <BodyText>You can review or update profile information in the app, manage notification preferences, and request deletion. Depending on where you live, you may also have rights to request access, correction, restriction, objection or a copy of your personal information.</BodyText>
        </PolicySection>

        <PolicySection title="Privacy questions">
          <BodyText>Signed-in users can submit privacy or data questions through the Tester Feedback screen. If you cannot access the app, use the public account-deletion page to recover access and complete deletion.</BodyText>
        </PolicySection>

        <Text style={styles.footer}>This page is publicly accessible and does not require an FPL Draft Manager account.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.card}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function BodyText({ children }: { children: React.ReactNode }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={styles.body}>{children}</Text>;
}

function Bullet({ text }: { text: string }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.bulletRow}><Text style={styles.bulletMark}>•</Text><Text style={styles.bulletText}>{text}</Text></View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 820, alignSelf: 'center', padding: appSpacing.lg, gap: 14, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  title: { ...appTypography.screenTitle, color: colors.textPrimary, marginTop: 5 },
  updated: { color: colors.textMuted, fontSize: 11, marginTop: 5 },
  closeButton: { borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.small, paddingHorizontal: 12, paddingVertical: 9 },
  closeButtonText: { color: colors.textSecondary, fontSize: 10, fontWeight: '900' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium, padding: appSpacing.lg },
  sectionTitle: { ...appTypography.sectionTitle, color: colors.textPrimary, marginBottom: 10 },
  body: { color: colors.textSecondary, fontSize: 13, lineHeight: 21, marginBottom: 8 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  bulletMark: { color: colors.accent, width: 18, fontSize: 15, lineHeight: 20 },
  bulletText: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  primaryButton: { alignItems: 'center', backgroundColor: colors.accentFill, borderRadius: appRadius.small, padding: 13, marginTop: 7 },
  primaryButtonText: { color: colors.accentForeground, fontSize: 11, fontWeight: '900', textAlign: 'center' },
  footer: { color: colors.textMuted, fontSize: 10, textAlign: 'center', marginTop: 6 },
});
