import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/utils/supabase';

interface LeagueMembershipRow {
  league_id: string;
}

interface AppSessionContextValue {
  authInitialized: boolean;
  sessionActive: boolean;
  currentUserId: string | null;
  hasLeague: boolean | null;
  activeLeagueId: string | null;
  refreshLeagueMembership: () => Promise<boolean>;
  selectActiveLeague: (leagueId: string) => Promise<void>;
}

interface AppSessionProviderProps {
  children: ReactNode;
}

export const AppSessionContext =
  createContext<AppSessionContextValue | undefined>(undefined);

const getBrowserStorage = (): Storage | null => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
};

export function AppSessionProvider({
  children,
}: AppSessionProviderProps) {
  const [authInitialized, setAuthInitialized] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [hasLeague, setHasLeague] = useState<boolean | null>(null);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);

  /**
   * Clears all local league state.
   *
   * This is used when the user signs out or when no authenticated
   * Supabase user can be found.
   */
  const clearLeagueState = useCallback(async () => {
    currentUserIdRef.current = null;
    setHasLeague(false);
    setActiveLeagueId(null);

    try {
      await AsyncStorage.removeItem('active_league_id');
      getBrowserStorage()?.removeItem('active_league_id');
    } catch (error) {
      console.error(
        '[APP SESSION] Failed to clear active league storage:',
        error
      );
    }
  }, []);

  /**
   * Queries Supabase for the authenticated user's league membership.
   *
   * Returns:
   * - true when a membership exists
   * - false when the user has no membership
   *
   * Throws:
   * - when Supabase returns a genuine query or authentication error
   */
  const refreshLeagueMembership =
    useCallback(async (): Promise<boolean> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        console.error(
          '[APP SESSION] Failed to resolve authenticated user:',
          userError
        );

        throw userError;
      }

      if (!user) {
        await clearLeagueState();
        return false;
      }

      const { data, error } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('user_id', user.id)
        .returns<LeagueMembershipRow[]>();

      if (error) {
        console.error(
          '[APP SESSION] Failed to query league membership:',
          error
        );

        throw error;
      }

      let storedLeagueId = await AsyncStorage.getItem('active_league_id');
      if (!storedLeagueId) {
        storedLeagueId = getBrowserStorage()?.getItem('active_league_id') ?? null;
      }

      const memberships = data ?? [];
      const storedMembership = memberships.find(
        (membership) => membership.league_id === storedLeagueId
      );
      const leagueId =
        storedMembership?.league_id ?? memberships[0]?.league_id ?? null;
      const membershipExists = Boolean(leagueId);

      setCurrentUserId(user.id);
      setSessionActive(true);
      setHasLeague(membershipExists);
      setActiveLeagueId(leagueId);

      if (leagueId) {
        await AsyncStorage.setItem('active_league_id', leagueId);
        getBrowserStorage()?.setItem('active_league_id', leagueId);
      } else {
        await AsyncStorage.removeItem('active_league_id');
        getBrowserStorage()?.removeItem('active_league_id');
      }

      return membershipExists;
    }, [clearLeagueState]);

  const selectActiveLeague = useCallback(
    async (leagueId: string): Promise<void> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        await clearLeagueState();
        throw new Error('You must be signed in to select a league.');
      }

      const { data, error } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('user_id', user.id)
        .eq('league_id', leagueId)
        .maybeSingle<LeagueMembershipRow>();

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error('You are not a member of that league.');
      }

      await AsyncStorage.setItem('active_league_id', leagueId);
      getBrowserStorage()?.setItem('active_league_id', leagueId);

      setCurrentUserId(user.id);
      setSessionActive(true);
      setHasLeague(true);
      setActiveLeagueId(leagueId);
    },
    [clearLeagueState]
  );

  /**
   * Synchronises React state with the latest Supabase session.
   */
  const synchroniseSession = useCallback(
    async (session: Session | null): Promise<void> => {
      const userId = session?.user?.id ?? null;
      const userChanged = currentUserIdRef.current !== userId;

      currentUserIdRef.current = userId;

      // Do not expose the previous signed-out/user membership result while
      // the newly authenticated user's memberships are still being resolved.
      if (userId && userChanged) {
        setHasLeague(null);
        setActiveLeagueId(null);
      }

      setSessionActive(Boolean(session));
      setCurrentUserId(userId);

      if (!userId) {
        await clearLeagueState();
        return;
      }

      try {
        await refreshLeagueMembership();
      } catch (error) {
        /*
         * A query failure is not the same as "no league".
         * Keep hasLeague as null so the route guard does not incorrectly
         * send the user back into onboarding.
         */
        setHasLeague(null);
        throw error;
      }
    },
    [clearLeagueState, refreshLeagueMembership]
  );

  /**
   * Initial authentication and membership check.
   */
  useEffect(() => {
    let mounted = true;

    const initialise = async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (!mounted) {
          return;
        }

        await synchroniseSession(session);
      } catch (error) {
        console.error(
          '[APP SESSION] Initial session synchronisation failed:',
          error
        );

        if (mounted) {
          setSessionActive(false);
          setCurrentUserId(null);
          setHasLeague(false);
          setActiveLeagueId(null);
        }
      } finally {
        if (mounted) {
          setAuthInitialized(true);
        }
      }
    };

    void initialise();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void (async () => {
        try {
          await synchroniseSession(session);
        } catch (error) {
          console.error(
            '[APP SESSION] Auth state synchronisation failed:',
            error
          );
        } finally {
          if (mounted) {
            setAuthInitialized(true);
          }
        }
      })();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [synchroniseSession]);

  /**
   * Secondary synchronisation for membership changes made elsewhere.
   *
   * The create/join screens will still call refreshLeagueMembership()
   * directly. Realtime is only a backup, not a requirement.
   */
  useEffect(() => {
    if (!currentUserId) {
      return;
    }

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
          void refreshLeagueMembership().catch((error) => {
            console.error(
              '[APP SESSION] Realtime membership refresh failed:',
              error
            );
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(membershipChannel);
    };
  }, [currentUserId, refreshLeagueMembership]);

  const value = useMemo<AppSessionContextValue>(
    () => ({
      authInitialized,
      sessionActive,
      currentUserId,
      hasLeague,
      activeLeagueId,
      refreshLeagueMembership,
      selectActiveLeague,
    }),
    [
      activeLeagueId,
      authInitialized,
      currentUserId,
      hasLeague,
      refreshLeagueMembership,
      selectActiveLeague,
      sessionActive,
    ]
  );

  return (
    <AppSessionContext.Provider value={value}>
      {children}
    </AppSessionContext.Provider>
  );
}
