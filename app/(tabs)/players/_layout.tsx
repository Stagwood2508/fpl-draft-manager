import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { withLayoutContext } from 'expo-router';
import { Platform } from 'react-native';

const { Navigator } = createMaterialTopTabNavigator();
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
        animationEnabled: Platform.OS !== 'web',
      }}
    >
      {/* 🙈 Hide the index redirect file from the top tabs visually */}
      <MaterialTopTabs.Screen 
        name="index" 
        options={{ 
          tabBarItemStyle: { display: 'none' } 
        }} 
      />

      {/* ✅ Clean and simple: Only your true visible sub-tabs live here */}
      <MaterialTopTabs.Screen name="scout" options={{ title: "Scout Pool" }} />
      <MaterialTopTabs.Screen name="watchlist" options={{ title: "Watchlist" }} />
    </MaterialTopTabs>
  );
}