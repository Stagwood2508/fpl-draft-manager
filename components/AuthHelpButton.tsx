import React, { useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

interface AuthHelpButtonProps {
  title: string;
  message: string;
}

const GUIDE_CARDS = [
  {
    icon: 'football-outline' as const,
    title: 'Draft FPL is different',
    message: 'This is a private fantasy football league with the people you invite. Every Premier League player can belong to only one manager in your league.',
  },
  {
    icon: 'people-outline' as const,
    title: 'Build a unique squad',
    message: 'Managers take turns choosing players in a live draft. Once a player is selected, nobody else in the league can pick them.',
  },
  {
    icon: 'list-outline' as const,
    title: 'Choose your weekly lineup',
    message: 'Before each gameweek, select the players in your starting team. Their real-life performances earn points for your squad.',
  },
  {
    icon: 'swap-horizontal-outline' as const,
    title: 'Keep improving',
    message: 'After the draft, strengthen your squad through waivers and trades. Available players can be claimed, while trades need another manager to agree.',
  },
  {
    icon: 'trophy-outline' as const,
    title: 'Compete your way',
    message: 'Follow the standings, fixtures and scores throughout the season. Your commissioner sets the league rules, scoring and draft settings.',
  },
];

export default function AuthHelpButton({ title, message }: AuthHelpButtonProps) {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const pagerRef = useRef<ScrollView>(null);
  const cardWidth = Math.min(width - 48, 440);
  const cards = useMemo(() => [
    ...GUIDE_CARDS,
    { icon: 'help-circle-outline' as const, title, message },
  ], [message, title]);

  const openGuide = () => {
    setCardIndex(0);
    setVisible(true);
    requestAnimationFrame(() => pagerRef.current?.scrollTo({ x: 0, animated: false }));
  };

  const moveToCard = (nextIndex: number) => {
    setCardIndex(nextIndex);
    pagerRef.current?.scrollTo({ x: cardWidth * nextIndex, animated: true });
  };

  return (
    <>
    <TouchableOpacity
      style={[styles.button, { borderColor: colors.accent, backgroundColor: colors.surface }]}
      onPress={openGuide}
      accessibilityRole="button"
      accessibilityLabel={`Help: ${title}`}
      accessibilityHint="Shows instructions for completing this screen"
    >
      <Ionicons name="help" size={17} color={colors.accent} />
      <Text style={[styles.label, { color: colors.accent }]}>HELP</Text>
    </TouchableOpacity>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.backdrop}>
        <View style={[styles.modal, { width: cardWidth, backgroundColor: colors.surface, borderColor: colors.borderStrong }]}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Close draft FPL guide"
          >
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>

          <Text style={[styles.eyebrow, { color: colors.accent }]}>DRAFT FPL GUIDE</Text>
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={event => setCardIndex(Math.round(event.nativeEvent.contentOffset.x / cardWidth))}
          >
            {cards.map(card => (
              <View key={card.title} style={[styles.card, { width: cardWidth }]}>
                <View style={[styles.iconCircle, { backgroundColor: colors.accentSoft ?? colors.surface, borderColor: colors.accent }]}>
                  <Ionicons name={card.icon} size={34} color={colors.accent} />
                </View>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{card.title}</Text>
                <Text style={[styles.cardMessage, { color: colors.textSecondary }]}>{card.message}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.dots}>
            {cards.map((card, index) => (
              <View key={card.title} style={[styles.dot, { backgroundColor: index === cardIndex ? colors.accent : colors.borderStrong }]} />
            ))}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => moveToCard(cardIndex - 1)}
              disabled={cardIndex === 0}
              accessibilityRole="button"
              accessibilityLabel="Previous guide card"
            >
              <Text style={[styles.backText, { color: colors.textSecondary, opacity: cardIndex === 0 ? 0.35 : 1 }]}>BACK</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.nextButton, { backgroundColor: colors.accentFill }]}
              onPress={() => cardIndex === cards.length - 1 ? setVisible(false) : moveToCard(cardIndex + 1)}
              accessibilityRole="button"
              accessibilityLabel={cardIndex === cards.length - 1 ? 'Close guide' : 'Next guide card'}
            >
              <Text style={[styles.nextText, { color: colors.accentForeground }]}>{cardIndex === cards.length - 1 ? "LET'S GO" : 'NEXT'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    top: 16,
    right: 16,
    minHeight: 36,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    zIndex: 2,
  },
  label: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: 'rgba(0, 0, 0, 0.78)' },
  modal: { borderWidth: 1, borderRadius: 16, overflow: 'hidden', paddingTop: 24, paddingBottom: 18 },
  closeButton: { position: 'absolute', top: 10, right: 10, width: 42, height: 42, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1, textAlign: 'center', marginBottom: 4 },
  card: { alignItems: 'center', paddingHorizontal: 28, paddingVertical: 20 },
  iconCircle: { width: 74, height: 74, borderRadius: 37, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  cardTitle: { fontSize: 23, fontWeight: '900', textAlign: 'center', marginBottom: 12 },
  cardMessage: { fontSize: 14, lineHeight: 21, textAlign: 'center', minHeight: 84 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginTop: 2, marginBottom: 18 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  backButton: { minWidth: 74, minHeight: 44, justifyContent: 'center', alignItems: 'flex-start' },
  backText: { fontSize: 12, fontWeight: '900' },
  nextButton: { minWidth: 112, minHeight: 44, borderRadius: 6, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  nextText: { fontSize: 12, fontWeight: '900' },
});
