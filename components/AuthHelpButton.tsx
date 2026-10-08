import React from 'react';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

interface AuthHelpButtonProps {
  title: string;
  message: string;
}

export default function AuthHelpButton({ title, message }: AuthHelpButtonProps) {
  const { colors } = useAppTheme();

  const showHelp = () => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
      return;
    }
    Alert.alert(title, message, [{ text: 'GOT IT' }]);
  };

  return (
    <TouchableOpacity
      style={[styles.button, { borderColor: colors.accent, backgroundColor: colors.surface }]}
      onPress={showHelp}
      accessibilityRole="button"
      accessibilityLabel={`Help: ${title}`}
      accessibilityHint="Shows instructions for completing this screen"
    >
      <Ionicons name="help" size={17} color={colors.accent} />
      <Text style={[styles.label, { color: colors.accent }]}>HELP</Text>
    </TouchableOpacity>
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
});
