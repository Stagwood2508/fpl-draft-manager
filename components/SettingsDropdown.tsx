import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';

import { supabase } from '@/utils/supabase';

export default function SettingsDropdown() {
  const router = useRouter();

  const [menuOpen, setMenuOpen] = useState(false);
  const [isCommish, setIsCommish] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function checkRole() {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        if (!user) {
          return;
        }

        const { data: membership, error: membershipError } =
          await supabase
            .from('league_members')
            .select('role')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle();

        if (membershipError) {
          throw membershipError;
        }

        if (mounted) {
          setIsCommish(membership?.role === 'COMMISSIONER');
        }
      } catch (error) {
        console.error(
          '[SETTINGS DROPDOWN] Failed to check commissioner role:',
          error
        );

        if (mounted) {
          setIsCommish(false);
        }
      }
    }

    void checkRole();

    return () => {
      mounted = false;
    };
  }, []);

  const handleSignOut = async () => {
    if (signingOut) {
      return;
    }

    try {
      setSigningOut(true);
      setMenuOpen(false);

      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      /*
       * AppSessionContext will also detect SIGNED_OUT and update
       * the root route guard. This explicit navigation provides
       * immediate visual feedback.
       */
      router.replace('/(auth)/login');
    } catch (error) {
      console.error('[SETTINGS DROPDOWN] Sign-out failed:', error);
      setSigningOut(false);
    }
  };

  return (
    <View style={styles.anchorContainer}>
      <TouchableOpacity
        style={styles.cogButton}
        onPress={() => setMenuOpen((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel="Open settings"
      >
        <Text style={styles.cogIconText}>⚙️</Text>
      </TouchableOpacity>

      {menuOpen && (
        <View style={styles.dropdownBox}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuOpen(false);
              router.push('/profile');
            }}
          >
            <Text style={styles.menuItemText}>👤 My Profile</Text>
          </TouchableOpacity>

          {isCommish && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                router.push('/(admin)/league-settings');
              }}
            >
              <Text
                style={[
                  styles.menuItemText,
                  styles.commissionerText,
                ]}
              >
                🛠️ Commissioner Settings
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.menuItem, styles.lastMenuItem]}
            onPress={handleSignOut}
            disabled={signingOut}
          >
            <Text style={[styles.menuItemText, styles.signOutText]}>
              {signingOut ? 'Signing Out…' : '➔ Sign Out'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  anchorContainer: {
    position: 'relative',
    zIndex: 9999,
  },

  cogButton: {
    padding: 6,
    paddingHorizontal: 10,
  },

  cogIconText: {
    fontSize: 18,
    color: '#FFF',
  },

  dropdownBox: {
    position: 'absolute',
    top: 40,
    right: 0,
    width: 210,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 20,
    zIndex: 10000,
  },

  menuItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },

  lastMenuItem: {
    borderBottomWidth: 0,
  },

  menuItemText: {
    color: '#DDD',
    fontSize: 13,
    fontWeight: '700',
  },

  commissionerText: {
    color: '#00ff87',
  },

  signOutText: {
    color: '#FF453A',
  },
});