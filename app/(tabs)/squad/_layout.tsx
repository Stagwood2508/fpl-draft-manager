import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { withLayoutContext } from 'expo-router';
import { Platform } from 'react-native';

const { Navigator } = createMaterialTopTabNavigator();
export const MaterialTopTabs = withLayoutContext(Navigator);

export default function SquadLayout() {
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
      {/* ✅ FIXED: The name must point exactly to 'index' for your default view */}
      <MaterialTopTabs.Screen name="index" options={{ title: "Lineup" }} />
      
      {/* If you add live.tsx or planner.tsx later, you will add their screens right here: */}
      {/* <MaterialTopTabs.Screen name="live" options={{ title: "Live Points" }} /> */}
      {/* <MaterialTopTabs.Screen name="planner" options={{ title: "Planner" }} /> */}
    </MaterialTopTabs>
  );
}