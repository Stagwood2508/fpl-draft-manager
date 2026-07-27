import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { withLayoutContext } from 'expo-router';

const { Navigator } = createMaterialTopTabNavigator();

// Create an Expo Router-compatible Material Top Tabs component
export const MaterialTopTabs = withLayoutContext(Navigator);

export default function LeagueLayout() {
  return (
    <MaterialTopTabs
      screenOptions={{
        tabBarStyle: { 
          backgroundColor: '#0F0F0F', 
          borderBottomWidth: 1, 
          borderBottomColor: '#1A1A1A' 
        },
        tabBarLabelStyle: { 
          fontSize: 12, 
          fontWeight: '900', 
          letterSpacing: 0.8 
        },
        tabBarActiveTintColor: '#00ff87',
        tabBarInactiveTintColor: '#666666',
        tabBarIndicatorStyle: { 
          backgroundColor: '#00ff87', 
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
      
      {/* Hide waivers from the top tab bar headers */}
      <MaterialTopTabs.Screen
        name="waivers"
        options={{
          href: null,
        }}
      />
    </MaterialTopTabs>
  );
}