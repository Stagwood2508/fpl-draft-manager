import React, { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Platform, View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from '@/utils/supabase';
import { useFonts } from 'expo-font';
import { 
  Ionicons, 
  MaterialCommunityIcons, 
  FontAwesome 
} from '@expo/vector-icons';

export default function RootLayout() {
  const rawSegments = useSegments();
  const router = useRouter();
  
  const [authInitialized, setAuthInitialized] = useState(false);
  const [sessionActive, setSessionActive] = useState<boolean>(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [hasLeague, setHasLeague] = useState<boolean | null>(null);

  // 1. Preload Vector Icon Fonts for Web & Native
  const [fontsLoaded, fontError] = useFonts({
    ...Ionicons.font,
    ...MaterialCommunityIcons.font,
    ...FontAwesome.font,
  });

  // Inject vector icon CSS fonts for Web runtime bundler compatibility
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const iconFontStyles = `
        @font-face {
          font-family: 'Ionicons';
          src: url(${require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf')}) format('truetype');
        }
        @font-face {
          font-family: 'MaterialCommunityIcons';
          src: url(${require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf')}) format('truetype');
        }
        @font-face {
          font-family: 'FontAwesome';
          src: url(${require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/FontAwesome.ttf')}) format('truetype');
        }
      `;
      const style = document.createElement('style');
      style.type = 'text/css';
      style.appendChild(document.createTextNode(iconFontStyles));
      document.head.appendChild(style);
    }
  }, []);

  // Check if active user has a valid league membership
  const checkLeagueMembership = async (userId: string) => {
    try {
      const { data: membership } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      setHasLeague(!!membership?.league_id);
    } catch (err) {
      console.error('Error verifying league membership:', err);
      setHasLeague(false);
    }
  };

  // 2. Auth State & Initial Session Handler
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uId = session?.user?.id || null;
      setSessionActive(!!session);
      setCurrentUserId(uId);

      if (uId) {
        checkLeagueMembership(uId).finally(() => setAuthInitialized(true));
      } else {
        setHasLeague(false);
        setAuthInitialized(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const uId = session?.user?.id || null;
      setSessionActive(!!session);
      setCurrentUserId(uId);

      if (uId) {
        checkLeagueMembership(uId);
      } else {
        setHasLeague(false);
      }
      setAuthInitialized(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 3. 📡 REALTIME WEB LISTENER: Instantly detects when user joins/creates a league on Web
  useEffect(() => {
    if (!currentUserId) return;

    // Guaranteed order: .on() BEFORE .subscribe()
    const membershipChannel = supabase
      .channel(`user-league-sync-${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'league_members',
          filter: `user_id=eq.${currentUserId}`,
        },
        () => {
          console.log('⚡ Realtime league membership update detected! Re-evaluating routing...');
          checkLeagueMembership(currentUserId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(membershipChannel);
    };
  }, [currentUserId]);

// 4. Reactive Routing Guard
  useEffect(() => {
    if (!authInitialized || (!fontsLoaded && !fontError) || hasLeague === null) return;

    const segments = rawSegments as string[];
    const currentSegment = segments[0] || '';
    const currentSubSegment = segments[1] || '';

    const inAuthGroup = currentSegment === '(auth)';
    
    const isActivelyOnboarding = 
      currentSubSegment === 'onboarding' || 
      currentSubSegment === 'league-onboarding' || 
      currentSubSegment === 'create-league' || 
      currentSubSegment === 'join-league';

    if (!sessionActive) {
      // 🔒 Unauthenticated: Lock to Auth flow
      if (!inAuthGroup) {
        router.replace('/(auth)/login');
      }
    } else {
      if (!hasLeague) {
        // 🔒 Authenticated but no league: Hold inside onboarding screens
        if (!isActivelyOnboarding) {
          router.replace('/(auth)/onboarding');
        }
      } else {
        // ✅ Authenticated & in a league: Redirect ONLY if currently trapped on Auth screens
        if (inAuthGroup) {
          router.replace('/(tabs)/dashboard');
        }
      }
    }
  }, [sessionActive, hasLeague, authInitialized, fontsLoaded, fontError, rawSegments]);

  // Keep showing splash loader until BOTH auth state AND icon fonts are ready
  if (!authInitialized || (!fontsLoaded && !fontError)) {
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
      fontSize: 15,
    },
    animation: 'slide_from_right', 
  }}
>
  {/* 1. MAIN LAYOUT GROUPS */}
  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
  <Stack.Screen name="(auth)" options={{ headerShown: false }} />

  {/* 2. LIVE DRAFT ROOMS */}
  <Stack.Screen 
    name="draft-room/index" 
    options={{ 
      title: "LIVE DRAFT ROOM",
      headerShown: false,
      animation: "slide_from_bottom",
    }} 
  />
  <Stack.Screen 
    name="draft/index" 
    options={{ 
      title: "DRAFT ROOM",
      headerShown: false,
      animation: "slide_from_bottom",
    }} 
  />

  {/* 3. USER & PROFILE MODAL */}
  <Stack.Screen 
    name="profile" 
    options={{ 
      title: "ACCOUNT IDENTITY",
      headerBackTitle: "",
      headerStyle: { backgroundColor: '#0A0A0A' },
      presentation: 'modal',
    }} 
  />

  {/* 4. COMMISSIONER & ADMIN SCREENS */}
  <Stack.Screen 
    name="(admin)/league-settings" 
    options={{ 
      title: "COMMISSIONER RULES PANEL",
      headerBackTitle: "",
      headerStyle: { backgroundColor: '#0A0A0A' },
    }} 
  />
  <Stack.Screen 
    name="(admin)/cup-wizard" 
    options={{ 
      title: "CUP WIZARD",
      headerBackTitle: "",
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