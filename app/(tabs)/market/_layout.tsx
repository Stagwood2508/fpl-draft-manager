import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { withLayoutContext } from 'expo-router';
import { Platform } from 'react-native';

const { Navigator } = createMaterialTopTabNavigator();

// Bridge Material Top Tabs into Expo Router context natively
export const MaterialTopTabs = withLayoutContext(Navigator);

export default function PlayersLayout() {
  return (
    <MaterialTopTabs
      screenOptions={{
        tabBarActiveTintColor: '#00ff87',
        tabBarInactiveTintColor: '#666',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
        tabBarIndicatorStyle: { backgroundColor: '#00ff87', height: 2 },
        tabBarStyle: { backgroundColor: '#0A0A0A' },
        // Fix for Android swiping jitter issues
        animationEnabled: Platform.OS !== 'web',
      }}
    >
      <MaterialTopTabs.Screen name="waivers" options={{ title: "Waivers" }} />
      <MaterialTopTabs.Screen name="trades" options={{ title: "Trades" }} />
      <MaterialTopTabs.Screen name="log" options={{ title: "Log" }} />
    </MaterialTopTabs>
  );
}