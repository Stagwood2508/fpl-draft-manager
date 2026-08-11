import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { withLayoutContext } from 'expo-router';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

const { Navigator } = createMaterialTopTabNavigator();

// Create an Expo Router-compatible Material Top Tabs component
export const MaterialTopTabs = withLayoutContext(Navigator);

export default function LeagueLayout() {
  const { colors } = useAppTheme();
  return (
    <MaterialTopTabs
      screenOptions={{
        tabBarStyle: { 
          backgroundColor: colors.backgroundDeep,
          borderBottomWidth: 1, 
          borderBottomColor: colors.border,
        },
        tabBarLabelStyle: { 
          fontSize: 12, 
          fontWeight: '900', 
          letterSpacing: 0.8 
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIndicatorStyle: { 
          backgroundColor: colors.accent,
          height: 3, 
          borderRadius: 2 
        },
      }}
    >
      <MaterialTopTabs.Screen
        name="index"
        options={{
          title: 'STANDINGS',
        }}
      />
      <MaterialTopTabs.Screen
        name="matches"
        options={{
          title: 'MATCHES',
        }}
      />
    </MaterialTopTabs>
  );
}
