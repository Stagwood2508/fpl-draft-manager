import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { withLayoutContext } from 'expo-router';
import { Platform } from 'react-native';
import { appColors } from '@/constants/theme';

const { Navigator } = createMaterialTopTabNavigator();

export const MaterialTopTabs = withLayoutContext(Navigator);

export default function MarketLayout() {
  return (
    <MaterialTopTabs
screenOptions={{
  tabBarActiveTintColor: appColors.accent,
  tabBarInactiveTintColor: appColors.textMuted,

  tabBarLabelStyle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  tabBarIndicatorStyle: {
    backgroundColor: appColors.accent,
    height: 2,
  },

  tabBarStyle: {
    backgroundColor: appColors.backgroundDeep,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
    elevation: 0,
    shadowOpacity: 0,
  },

  tabBarItemStyle: {
    minHeight: 48,
  },

  animationEnabled: Platform.OS !== 'web',
}}
    >
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

      <MaterialTopTabs.Screen
  name="index"
  options={{
    href: null,
  }}
/>
    </MaterialTopTabs>
  );
}
