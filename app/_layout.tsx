import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter, useSegments } from 'expo-router';
import {
  Platform,
  View,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  Ionicons,
  MaterialCommunityIcons,
  FontAwesome,
} from '@expo/vector-icons';

import {
  AppSessionProvider,
} from '@/features/account/context/AppSessionContext';
import { useAppSession } from '@/features/account/hooks/useAppSession';

export default function RootLayout() {
  return (
    <AppSessionProvider>
      <RootLayoutContent />
    </AppSessionProvider>
  );
}

function RootLayoutContent() {
  const rawSegments = useSegments();
  const router = useRouter();

  const {
    authInitialized,
    sessionActive,
    hasLeague,
  } = useAppSession();

  const [fontsLoaded, fontError] = useFonts({
    ...Ionicons.font,
    ...MaterialCommunityIcons.font,
    ...FontAwesome.font,
  });

  // These must be declared here, inside RootLayoutContent,
  // but outside every useEffect.
  const fontsReady = fontsLoaded || Boolean(fontError);
  const membershipReady = !sessionActive || hasLeague !== null;

  const appReady =
    authInitialized &&
    fontsReady &&
    membershipReady;

  // Inject vector icon font declarations for Expo Web.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }

    const existingStyle = document.getElementById(
      'expo-vector-icon-font-styles'
    );

    if (existingStyle) {
      return;
    }

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
    style.id = 'expo-vector-icon-font-styles';
    style.type = 'text/css';
    style.appendChild(document.createTextNode(iconFontStyles));

    document.head.appendChild(style);
  }, []);

  // Global authentication and league-membership route guard.
  useEffect(() => {
    if (!appReady) {
      return;
    }

    const segments = rawSegments as string[];
    const currentSegment = segments[0] ?? '';
    const currentSubSegment = segments[1] ?? '';

    const inAuthGroup = currentSegment === '(auth)';

    const isActivelyOnboarding =
      currentSubSegment === 'onboarding' ||
      currentSubSegment === 'league-onboarding' ||
      currentSubSegment === 'create-league' ||
      currentSubSegment === 'join-league';

    if (!sessionActive) {
      if (!inAuthGroup) {
        router.replace('/(auth)/login');
      }

      return;
    }

    if (!hasLeague) {
      if (!isActivelyOnboarding) {
        router.replace('/(auth)/onboarding');
      }

      return;
    }

    if (inAuthGroup) {
      router.replace('/(tabs)/dashboard');
    }
  }, [
    appReady,
    hasLeague,
    rawSegments,
    router,
    sessionActive,
  ]);

  return (
    <GestureHandlerRootView style={styles.root}>
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
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="notifications" options={{ headerShown: false }} />
          <Stack.Screen name="(admin)/league-announcements" options={{ headerShown: false }} />
        </Stack>

        {!appReady && (
          <View style={styles.loaderOverlay}>
            <ActivityIndicator size="large" color="#00ff87" />
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
    zIndex: 999,
  },
});
