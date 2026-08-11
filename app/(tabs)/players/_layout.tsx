import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { withLayoutContext } from 'expo-router';
import { Platform } from 'react-native';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

const { Navigator } = createMaterialTopTabNavigator();
export const MaterialTopTabs = withLayoutContext(Navigator);

export default function PlayersLayout() {
  const { colors } = useAppTheme();
  return (
    <MaterialTopTabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
        tabBarIndicatorStyle: { backgroundColor: colors.accent, height: 2 },
        tabBarStyle: { backgroundColor: colors.backgroundDeep, borderBottomColor: colors.border, borderBottomWidth: 1 },
        animationEnabled: Platform.OS !== 'web',
      }}
    >

      {/* ✅ Clean and simple: Only your true visible sub-tabs live here */}
      <MaterialTopTabs.Screen name="scout" options={{ title: "Scout Pool" }} />
      <MaterialTopTabs.Screen name="watchlist" options={{ title: "Watchlist" }} />
    </MaterialTopTabs>
  );
}
