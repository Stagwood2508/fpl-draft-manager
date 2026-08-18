import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { usePathname, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

const categories = ['BUG', 'IDEA', 'USABILITY', 'OTHER'] as const;

export default function FeedbackScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const pathname = usePathname();
  const [category, setCategory] = useState<(typeof categories)[number]>('BUG');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submit = async () => {
    const cleanMessage = message.trim();
    if (cleanMessage.length < 10) {
      Alert.alert('More Detail Needed', 'Please enter at least 10 characters.');
      return;
    }

    try {
      setSubmitting(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Please sign in before sending feedback.');
      const leagueId = await AsyncStorage.getItem('active_league_id');
      const { error } = await supabase.from('tester_feedback').insert({
        user_id: user.id,
        league_id: leagueId,
        category,
        message: cleanMessage,
        route: pathname,
        platform: Platform.OS,
        app_version: Constants.expoConfig?.version ?? 'unknown',
      });
      if (error) throw error;
      setSubmitted(true);
      setMessage('');
    } catch (error: any) {
      Alert.alert('Could Not Send Feedback', error?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Tester Feedback</Text>
            <Text style={styles.subtitle}>Report a problem or suggest an improvement</Text>
          </View>
          <TouchableOpacity onPress={() => router.back()}><Text style={styles.close}>CLOSE</Text></TouchableOpacity>
        </View>

        {submitted && (
          <View style={styles.success}><Text style={styles.successText}>Feedback received. Thank you for helping test the app.</Text></View>
        )}

        <Text style={styles.label}>Category</Text>
        <View style={styles.categoryRow}>
          {categories.map(item => (
            <TouchableOpacity key={item} style={[styles.category, category === item && styles.categoryActive]} onPress={() => setCategory(item)}>
              <Text style={[styles.categoryText, category === item && styles.categoryTextActive]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>What happened?</Text>
        <TextInput
          style={styles.messageInput}
          value={message}
          onChangeText={(value) => { setMessage(value); setSubmitted(false); }}
          placeholder="Tell us what you expected, what happened, and which screen you were using."
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={2000}
          textAlignVertical="top"
        />
        <Text style={styles.counter}>{message.length}/2000</Text>

        <TouchableOpacity style={[styles.submit, submitting && styles.disabled]} onPress={submit} disabled={submitting}>
          <Text style={styles.submitText}>{submitting ? 'SENDING...' : 'SEND FEEDBACK'}</Text>
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  keyboardView: { flex: 1 },
  content: { padding: appSpacing.lg, maxWidth: 760, width: '100%', alignSelf: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 28 },
  title: { ...appTypography.screenTitle, color: colors.textPrimary, textTransform: 'uppercase' },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  close: { color: colors.accent, fontSize: 12, fontWeight: '900' },
  label: { ...appTypography.label, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 8 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 },
  category: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 13, paddingVertical: 9, borderRadius: appRadius.small },
  categoryActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  categoryText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  categoryTextActive: { color: colors.accent },
  messageInput: { minHeight: 180, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, padding: 14, borderRadius: appRadius.medium, fontSize: 14, lineHeight: 20 },
  counter: { color: colors.textMuted, fontSize: 11, textAlign: 'right', marginTop: 5 },
  submit: { backgroundColor: colors.accentFill, padding: 15, alignItems: 'center', borderRadius: appRadius.small, marginTop: 18 },
  submitText: { color: colors.accentForeground, fontWeight: '900', fontSize: 13 },
  disabled: { opacity: 0.6 },
  success: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder, padding: 13, borderRadius: appRadius.small, marginBottom: 20 },
  successText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
});
