import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/utils/supabase';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    async function checkAuthAndNavigate() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace('/(auth)/login');
        return;
      }

      const { data: membership } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (membership?.league_id) {
        router.replace('/(tabs)/dashboard');
      } else {
        router.replace('/(auth)/onboarding');
      }
    }

    checkAuthAndNavigate();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#00ff87" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' },
});