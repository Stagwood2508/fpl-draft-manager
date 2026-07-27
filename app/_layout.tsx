import React, { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from '../utils/supabase';

export default function RootStackRouterLayout() {
  const rawSegments = useSegments();
  const router = useRouter();
  
  const [authInitialized, setAuthInitialized] = useState(false);
  const [sessionActive, setSessionActive] = useState<boolean>(false);

// 1. First Hook: Keep this exactly as it was to initialize auth state instantly
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionActive(!!session);
      setAuthInitialized(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionActive(!!session);
      setAuthInitialized(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 2. Second Hook: Handles the routing layout switches safely without blocking initialization
  useEffect(() => {
    if (!authInitialized) return;

    const segments = rawSegments as string[];
    const currentSegment = segments[0] || '';
    const currentSubSegment = segments[1] || '';

    const inAuthGroup = currentSegment === '(auth)';
    const onRootLoadingPage = currentSegment === '';
    
    // 🔍 NEW: Identify if the user is actively trying to set up a league right now
    const isActivelyOnboarding = 
      currentSubSegment === 'league-onboarding' || 
      currentSubSegment === 'create-league' || 
      currentSubSegment === 'join-league';

    if (!sessionActive) {
      if (!inAuthGroup) {
        router.replace('/(auth)/login');
      }
    } else {
      // User is logged in
      if (inAuthGroup || onRootLoadingPage) {
        
        const checkLeagueAndRoute = async () => {
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
              router.replace('/(auth)/login');
              return;
            }

            const { data: membership } = await supabase
              .from('league_members')
              .select('league_id')
              .eq('user_id', user.id)
              .maybeSingle();

            if (membership?.league_id) {
              // Manager has a league -> send to dashboard
              router.replace('/(tabs)/dashboard');
            } else {
              // Manager has NO league. 
              // 🚀 THE FIX: Only force redirect to onboarding IF they aren't already trying to create/join one!
              if (!isActivelyOnboarding) {
                router.replace('/(auth)/onboarding');
              }
            }
          } catch (err) {
            console.error("Routing guard execution error:", err);
            if (!isActivelyOnboarding) {
              router.replace('/(auth)/onboarding');
            }
          }
        };

        checkLeagueAndRoute();
      }
    }
  }, [sessionActive, authInitialized, rawSegments]);

  if (!authInitialized) {
    return (
      <View style={styles.loaderOverlay}>
        <ActivityIndicator size="large" color="#00ff87" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack
          screenOptions={{
            headerStyle: { 
              backgroundColor: '#0A0A0A',
            },
          headerShadowVisible: false,
          headerTintColor: '#FFF',
          headerTitleStyle: { 
            fontWeight: '900', 
            fontSize: 15, // 💡 FIX: Removed letterSpacing from this object
          },
          animation: 'slide_from_right', 
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />

        <Stack.Screen 
          name="profile" 
          options={{ 
            title: "ACCOUNT IDENTITY",
            headerBackTitle: "", // 💡 FIX: Replaced headerBackTitleVisible with empty string assignment
            headerStyle: { backgroundColor: '#0A0A0A' },
          }} 
        />

        <Stack.Screen 
          name="league-settings" 
          options={{ 
            title: "COMMISSIONER RULES PANEL",
            headerBackTitle: "", // 💡 FIX: Replaced headerBackTitleVisible with empty string assignment
            headerStyle: { backgroundColor: '#0A0A0A' },
          }} 
        />
      </Stack>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loaderOverlay: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: '#0A0A0A' 
  }
});