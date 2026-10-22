import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type FirstVisitGuideCard = {
  icon: IconName;
  title: string;
  message: string;
};

type FirstVisitGuideProps = {
  guideId: string;
  title: string;
  cards: FirstVisitGuideCard[];
  enabled?: boolean;
};

const storageKey = (userId: string, guideId: string) => `fpl-draft-manager:walkthrough:v1:${userId}:${guideId}`;

export async function resetFirstVisitGuides(userId: string | null) {
  if (!userId) return;
  const keys = await AsyncStorage.getAllKeys();
  const prefix = `fpl-draft-manager:walkthrough:v1:${userId}:`;
  const guideKeys = keys.filter(key => key.startsWith(prefix));
  if (guideKeys.length) await AsyncStorage.multiRemove(guideKeys);
}

export default function FirstVisitGuide({ guideId, title, cards, enabled = true }: FirstVisitGuideProps) {
  const { colors } = useAppTheme();
  const { currentUserId } = useAppSession();
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);
  const [visible, setVisible] = useState(false);
  const [checked, setChecked] = useState(false);
  const [index, setIndex] = useState(0);
  const cardWidth = Math.min(width - 48, 430);
  const key = useMemo(() => currentUserId ? storageKey(currentUserId, guideId) : null, [currentUserId, guideId]);

  useEffect(() => {
    let active = true;
    if (!enabled || !key || cards.length === 0) {
      setVisible(false);
      setChecked(true);
      return;
    }

    setChecked(false);
    void AsyncStorage.getItem(key).then(value => {
      if (!active) return;
      setVisible(!value);
      setChecked(true);
      setIndex(0);
    }).catch(() => {
      if (!active) return;
      setVisible(true);
      setChecked(true);
    });
    return () => { active = false; };
  }, [cards.length, enabled, key]);

  const dismiss = async () => {
    if (key) await AsyncStorage.setItem(key, new Date().toISOString()).catch(() => undefined);
    setVisible(false);
  };

  const moveTo = (nextIndex: number) => {
    setIndex(nextIndex);
    pagerRef.current?.scrollTo({ x: cardWidth * nextIndex, animated: true });
  };

  if (!checked || !visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => void dismiss()}>
      <View style={styles.backdrop}>
        <View style={[styles.modal, { width: cardWidth, backgroundColor: colors.backgroundElevated, borderColor: colors.borderStrong }]}>
          <TouchableOpacity style={styles.skipButton} onPress={() => void dismiss()} accessibilityLabel="Do not show this guide again">
            <Text style={[styles.skipText, { color: colors.textMuted }]}>SKIP GUIDE</Text>
          </TouchableOpacity>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>QUICK START</Text>
          <Text style={[styles.guideTitle, { color: colors.textPrimary }]}>{title}</Text>
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={event => setIndex(Math.round(event.nativeEvent.contentOffset.x / cardWidth))}
          >
            {cards.map(card => (
              <View key={card.title} style={[styles.card, { width: cardWidth }]}>
                <View style={[styles.iconCircle, { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder }]}>
                  <Ionicons name={card.icon} size={34} color={colors.accent} />
                </View>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{card.title}</Text>
                <Text style={[styles.cardMessage, { color: colors.textSecondary }]}>{card.message}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.dots}>
            {cards.map((card, dotIndex) => <View key={card.title} style={[styles.dot, { backgroundColor: dotIndex === index ? colors.accent : colors.borderStrong }]} />)}
          </View>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.backButton} onPress={() => moveTo(index - 1)} disabled={index === 0} accessibilityLabel="Previous guide card">
              <Text style={[styles.backText, { color: colors.textSecondary, opacity: index === 0 ? 0.35 : 1 }]}>BACK</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.nextButton, { backgroundColor: colors.accentFill }]} onPress={() => index === cards.length - 1 ? void dismiss() : moveTo(index + 1)} accessibilityLabel={index === cards.length - 1 ? 'Finish guide' : 'Next guide card'}>
              <Text style={[styles.nextText, { color: colors.accentForeground }]}>{index === cards.length - 1 ? "GOT IT" : 'NEXT'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.replayHint, { color: colors.textMuted }]}>You can replay these from Help Centre at any time.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.78)' },
  modal: { borderWidth: 1, borderRadius: 18, overflow: 'hidden', paddingTop: 23, paddingBottom: 16 },
  skipButton: { position: 'absolute', top: 12, right: 14, zIndex: 2, minHeight: 34, justifyContent: 'center', paddingHorizontal: 6 },
  skipText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  eyebrow: { fontSize: 10, fontWeight: '900', textAlign: 'center', letterSpacing: 1 },
  guideTitle: { fontSize: 18, fontWeight: '900', textAlign: 'center', marginTop: 3 },
  card: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 22, paddingBottom: 14 },
  iconCircle: { width: 74, height: 74, borderRadius: 37, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  cardTitle: { fontSize: 22, fontWeight: '900', textAlign: 'center', marginBottom: 10 },
  cardMessage: { minHeight: 70, fontSize: 14, fontWeight: '600', lineHeight: 21, textAlign: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginBottom: 16 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  backButton: { minWidth: 72, minHeight: 44, justifyContent: 'center' },
  backText: { fontSize: 12, fontWeight: '900' },
  nextButton: { minWidth: 110, minHeight: 44, borderRadius: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  nextText: { fontSize: 12, fontWeight: '900' },
  replayHint: { textAlign: 'center', fontSize: 9, fontWeight: '600', marginTop: 12 },
});
