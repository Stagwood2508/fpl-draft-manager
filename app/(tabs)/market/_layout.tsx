import { createMaterialTopTabNavigator } from 'expo-router/js-top-tabs';
import { withLayoutContext } from 'expo-router';
import { Platform } from 'react-native';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

const { Navigator } = createMaterialTopTabNavigator();

export const MaterialTopTabs = withLayoutContext(Navigator);

export default function MarketLayout() {
  const { colors } = useAppTheme();
  return (
    <MaterialTopTabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,

        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '800',
          letterSpacing: 0.4,
          textTransform: 'uppercase',
        },

        tabBarIndicatorStyle: {
          backgroundColor: colors.accentFill,
          height: 2,
        },

        tabBarStyle: {
          backgroundColor: colors.backgroundDeep,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          elevation: 0,
          shadowOpacity: 0,
        },

        tabBarItemStyle: {
          minHeight: 48,
        },

        animationEnabled: Platform.OS !== 'web',
      }}
    >
      {/* 🙈 Hide the index redirect file from the top tabs visually */}
      <MaterialTopTabs.Screen
        name="index"
        options={{
          tabBarItemStyle: { display: 'none' },
        }}
      />

      <MaterialTopTabs.Screen
        name="transfer-list"
        options={{ title: 'Transfer List' }}
      />

      <MaterialTopTabs.Screen
        name="waivers-trades"
        options={{ title: 'Waivers & Trades' }}
      />

      <MaterialTopTabs.Screen
        name="waiver-history"
        options={{ title: 'Transactions' }}
      />
    </MaterialTopTabs>
  );
}
