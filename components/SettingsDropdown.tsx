import React, { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';

import { supabase } from '@/utils/supabase';
import { AppColors, appRadius, appTypography } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { useAppSession } from '@/features/account/hooks/useAppSession';

export default function SettingsDropdown() {
  const router = useRouter();
  const { colors, resolvedMode, toggleMode } = useAppTheme();
  const { activeLeagueId } = useAppSession();
  const styles = useMemo(() => createStyles(colors), [colors]);

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

        if (!user || !activeLeagueId) {
          return;
        }

        const { data: membership, error: membershipError } =
          await supabase
            .from('league_members')
            .select('role')
            .eq('user_id', user.id)
            .eq('league_id', activeLeagueId)
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
  }, [activeLeagueId]);

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

          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); router.push('/feedback'); }}>
            <Text style={styles.menuItemText}>Tester Feedback</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); router.push('/account'); }}>
            <Text style={styles.menuItemText}>Privacy & Account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuOpen(false);
              router.push('/notifications?settings=1');
            }}
            accessibilityRole="button"
            accessibilityLabel="Open notification and push settings"
          >
            <Text style={styles.menuItemText}>🔔 Notifications & Push</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => void toggleMode()}
            accessibilityRole="switch"
            accessibilityState={{ checked: resolvedMode === 'light' }}
            accessibilityLabel="Use light mode"
          >
            <View style={styles.appearanceRow}>
              <Text style={styles.menuItemText}>
                {resolvedMode === 'light' ? '☀️ Light Mode' : '🌙 Dark Mode'}
              </Text>
              <View style={[styles.modeSwitch, resolvedMode === 'light' && styles.modeSwitchLight]}>
                <View style={[styles.modeSwitchThumb, resolvedMode === 'light' && styles.modeSwitchThumbLight]} />
              </View>
            </View>
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

          {isCommish && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                router.push('/(admin)/gameweek-simulator');
              }}
            >
              <Text style={[styles.menuItemText, styles.simulatorText]}>
                Gameweek Rehearsal
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

const createStyles = (colors: AppColors) => StyleSheet.create({
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
    color: colors.textPrimary,
  },

  dropdownBox: {
    position: 'absolute',
    top: 40,
    right: 0,
    width: 210,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: appRadius.medium,
    shadowColor: colors.black,
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
    borderBottomColor: colors.border,
  },

  lastMenuItem: {
    borderBottomWidth: 0,
  },

  menuItemText: {
    ...appTypography.body,
    color: colors.textPrimary,
    fontSize: 13,
  },

  appearanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  modeSwitch: {
    width: 34,
    height: 20,
    padding: 2,
    borderRadius: 10,
    backgroundColor: colors.surfacePressed,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },

  modeSwitchLight: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentBorder,
  },

  modeSwitchThumb: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.textMuted,
  },

  modeSwitchThumbLight: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
  },

  commissionerText: {
    color: colors.accent,
  },

  simulatorText: {
    color: colors.warning,
  },

  signOutText: {
    color: colors.danger,
  },
});
