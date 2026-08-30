import { useCallback, useEffect, useState } from 'react';

import { getLeagueActivity, LeagueActivityItem } from '@/features/market/services/leagueActivity';
import { supabase } from '@/utils/supabase';

export interface HomeLeagueMembership {
  leagueId: string;
  teamName: string;
  role: string;
  league: {
    id: string;
    name: string;
    commissionerId: string;
    draftStatus: string;
    status: string | null;
  };
}

export interface HomeGameweek {
  gameweek: number;
  deadline: string;
  waiverDeadline: string;
  status: string | null;
  isFinished: boolean;
  waiversProcessed: boolean;
}

export interface HomeStanding {
  rank: number;
  userId: string;
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  pointsFor: number;
}

export interface HomeFixture {
  id: string;
  gameweek: number;
  homeUserId: string | null;
  awayUserId: string | null;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  isFinished: boolean;
  isLeagueAverage: boolean;
}

export interface HomeLineupSummary {
  formation: string;
  rosterCount: number;
  starterCount: number;
  snapshotStatus: string | null;
}

export interface HomeWaiverSummary {
  priority: number | null;
  managerCount: number;
  pendingClaims: number;
  marketStatus: string | null;
}

export interface HomeAnnouncement {
  id: string;
  title: string;
  body: string;
  priority: 'NORMAL' | 'URGENT';
  isPinned: boolean;
  publishedAt: string;
  expiresAt: string | null;
}

export interface HomeChronicle {
  id: string;
  gameweek: number;
  title: string;
  summary: string;
  publishedAt: string;
}

interface HomeDashboardState {
  memberships: HomeLeagueMembership[];
  activeLeague: HomeLeagueMembership['league'] | null;
  isCommissioner: boolean;
  draftCompleted: boolean;
  gameweek: HomeGameweek | null;
  standings: HomeStanding[];
  fixture: HomeFixture | null;
  lineup: HomeLineupSummary;
  waiver: HomeWaiverSummary;
  pendingTrades: number;
  recentActivity: LeagueActivityItem[];
  announcement: HomeAnnouncement | null;
  chronicle: HomeChronicle | null;
}

const EMPTY_STATE: HomeDashboardState = {
  memberships: [],
  activeLeague: null,
  isCommissioner: false,
  draftCompleted: false,
  gameweek: null,
  standings: [],
  fixture: null,
  lineup: {
    formation: '—',
    rosterCount: 0,
    starterCount: 0,
    snapshotStatus: null,
  },
  waiver: {
    priority: null,
    managerCount: 0,
    pendingClaims: 0,
    marketStatus: null,
  },
  pendingTrades: 0,
  recentActivity: [],
  announcement: null,
  chronicle: null,
};

const firstRelation = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
};

const playerPosition = (relation: any) => {
  const player = firstRelation<any>(relation);
  return String(player?.element_type || '').toUpperCase();
};

export function useHomeDashboard(currentUserId: string | null, activeLeagueId: string | null) {
  const [state, setState] = useState<HomeDashboardState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadDashboard = useCallback(async (background: boolean | 'silent' = false) => {
    if (!currentUserId || !activeLeagueId) {
      setState(EMPTY_STATE);
      setLoading(false);
      return;
    }

    if (background === true) setRefreshing(true);
    else if (background === false) setLoading(true);
    setErrorMessage(null);

    try {
      const [membershipsResponse, gameweeksResponse] = await Promise.all([
        supabase
          .from('league_members')
          .select('league_id, team_name, role, leagues(id, name, commissioner_id, draft_status, status)')
          .eq('user_id', currentUserId),
        supabase
          .from('league_gameweeks')
          .select('gameweek, gw_deadline, waiver_deadline, status, is_finished, is_waiver_processed, is_current')
          .eq('league_id', activeLeagueId)
          .order('gameweek', { ascending: true }),
      ]);

      if (membershipsResponse.error) throw membershipsResponse.error;
      if (gameweeksResponse.error) throw gameweeksResponse.error;

      const memberships: HomeLeagueMembership[] = (membershipsResponse.data || [])
        .map((row: any) => {
          const league = firstRelation<any>(row.leagues);
          if (!league) return null;
          return {
            leagueId: String(row.league_id),
            teamName: row.team_name || 'My Team',
            role: row.role || 'MEMBER',
            league: {
              id: String(league.id),
              name: league.name || 'League',
              commissionerId: String(league.commissioner_id),
              draftStatus: league.draft_status || 'PRE_DRAFT',
              status: league.status || null,
            },
          };
        })
        .filter((item): item is HomeLeagueMembership => Boolean(item));

      const activeMembership = memberships.find(item => item.leagueId === activeLeagueId) || null;
      const now = Date.now();
      const gameweekRows = gameweeksResponse.data || [];
      const selectedGameweek = gameweekRows.find((row: any) =>
        !row.is_finished && (row.is_current || new Date(row.gw_deadline).getTime() > now)
      ) || gameweekRows[gameweekRows.length - 1] || null;

      const gameweek: HomeGameweek | null = selectedGameweek ? {
        gameweek: Number(selectedGameweek.gameweek),
        deadline: selectedGameweek.gw_deadline,
        waiverDeadline: selectedGameweek.waiver_deadline,
        status: selectedGameweek.status || null,
        isFinished: Boolean(selectedGameweek.is_finished),
        waiversProcessed: Boolean(selectedGameweek.is_waiver_processed),
      } : null;

      const gameweekNumber = gameweek?.gameweek || 1;
      const isLive = Boolean(
        gameweek && !gameweek.isFinished && new Date(gameweek.deadline).getTime() <= now
      );

      const [
        draftResponse,
        standingsResponse,
        fixtureResponse,
        rosterResponse,
        snapshotResponse,
        waiverResponse,
        pendingWaiverResponse,
        pendingTradeResponse,
        recentActivity,
        announcementResponse,
        chronicleResponse,
      ] = await Promise.all([
        supabase
          .from('draft_sessions')
          .select('draft_status')
          .eq('league_id', activeLeagueId)
          .maybeSingle(),
        supabase.rpc('get_league_standings_v2', {
          p_league_id: activeLeagueId,
          p_gameweek: gameweekNumber,
          p_is_live: isLive,
        }),
        supabase
          .from('league_fixtures')
          .select('id, gameweek, home_user_id, away_user_id, home_team_name, away_team_name, home_score, away_score, is_finished, is_league_average')
          .eq('league_id', activeLeagueId)
          .eq('gameweek', gameweekNumber)
          .or(`home_user_id.eq.${currentUserId},away_user_id.eq.${currentUserId}`)
          .maybeSingle(),
        supabase
          .from('rosters')
          .select('is_starting, players(element_type)')
          .eq('league_id', activeLeagueId)
          .eq('user_id', currentUserId),
        supabase
          .from('gameweek_lineup_snapshots')
          .select('status')
          .eq('league_id', activeLeagueId)
          .eq('user_id', currentUserId)
          .eq('gameweek', gameweekNumber)
          .maybeSingle(),
        supabase.rpc('get_my_waiver_status', { p_league_id: activeLeagueId }),
        supabase
          .from('waiver_claims')
          .select('id, gameweek')
          .eq('league_id', activeLeagueId)
          .eq('user_id', currentUserId)
          .eq('status', 'pending'),
        supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', activeLeagueId)
          .eq('receiver_id', currentUserId)
          .eq('type', 'TRADE')
          .eq('status', 'PENDING'),
        getLeagueActivity(activeLeagueId, 8),
        supabase
          .from('league_announcements')
          .select('id, title, body, priority, is_pinned, published_at, expires_at')
          .eq('league_id', activeLeagueId)
          .lte('published_at', new Date(now).toISOString())
          .or(`expires_at.is.null,expires_at.gt.${new Date(now).toISOString()}`)
          .order('is_pinned', { ascending: false })
          .order('published_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('league_chronicles')
          .select('id, gameweek, title, summary, published_at')
          .eq('league_id', activeLeagueId)
          .order('gameweek', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (standingsResponse.error) throw standingsResponse.error;
      if (fixtureResponse.error) throw fixtureResponse.error;
      if (rosterResponse.error) throw rosterResponse.error;
      if (announcementResponse.error) throw announcementResponse.error;
      if (chronicleResponse.error && chronicleResponse.error.code !== '42P01') {
        console.warn('[HOME DASHBOARD] Chronicle teaser unavailable:', chronicleResponse.error.message);
      }

      let fixture: HomeFixture | null = fixtureResponse.data ? {
        id: String(fixtureResponse.data.id),
        gameweek: Number(fixtureResponse.data.gameweek),
        homeUserId: fixtureResponse.data.home_user_id || null,
        awayUserId: fixtureResponse.data.away_user_id || null,
        homeTeamName: fixtureResponse.data.home_team_name || 'Home Team',
        awayTeamName: fixtureResponse.data.away_team_name || 'Away Team',
        homeScore: Number(fixtureResponse.data.home_score || 0),
        awayScore: Number(fixtureResponse.data.away_score || 0),
        isFinished: Boolean(fixtureResponse.data.is_finished),
        isLeagueAverage: Boolean(fixtureResponse.data.is_league_average),
      } : null;

      if (fixture && isLive) {
        const { data: liveScores } = await supabase.rpc('get_league_live_fixture_scores', {
          p_league_id: activeLeagueId,
          p_gameweek: gameweekNumber,
        });
        const liveFixture = (liveScores || []).find((row: any) => String(row.fixture_id) === fixture?.id);
        if (liveFixture) {
          fixture = {
            ...fixture,
            homeScore: Number(liveFixture.home_score || 0),
            awayScore: Number(liveFixture.away_score || 0),
          };
        }
      }

      const roster = rosterResponse.data || [];
      const starters = roster.filter((row: any) => row.is_starting);
      const starterCounts = starters.reduce((counts: Record<string, number>, row: any) => {
        const position = playerPosition(row.players);
        counts[position] = (counts[position] || 0) + 1;
        return counts;
      }, {});
      const formation = starters.length === 11
        ? `${starterCounts.DEF || 0}-${starterCounts.MID || 0}-${starterCounts.FWD || 0}`
        : '—';

      const waiverData: any = waiverResponse.data || {};
      const draftStatus = String(draftResponse.data?.draft_status || activeMembership?.league.draftStatus || '');
      const draftCompleted = ['COMPLETED', 'FINISHED'].includes(draftStatus.toUpperCase());

      setState({
        memberships,
        activeLeague: activeMembership?.league || null,
        isCommissioner: activeMembership?.league.commissionerId === currentUserId,
        draftCompleted,
        gameweek,
        standings: (standingsResponse.data || []).map((row: any) => ({
          rank: Number(row.rank || 0),
          userId: String(row.user_id),
          teamName: row.team_name || 'FC Manager',
          played: Number(row.played || 0),
          won: Number(row.won || 0),
          drawn: Number(row.drawn || 0),
          lost: Number(row.lost || 0),
          points: Number(row.points || 0),
          pointsFor: Number(row.total_h2h_score || 0),
        })),
        fixture,
        lineup: {
          formation,
          rosterCount: roster.length,
          starterCount: starters.length,
          snapshotStatus: snapshotResponse.data?.status || null,
        },
        waiver: {
          priority: waiverData.priority === null || waiverData.priority === undefined
            ? null
            : Number(waiverData.priority),
          managerCount: Number(waiverData.manager_count || memberships.length),
          pendingClaims: (pendingWaiverResponse.data || []).filter((claim: any) =>
            Number(claim.gameweek) === Number(waiverData.gameweek ?? gameweekNumber)
          ).length,
          marketStatus: waiverData.market_status || gameweek?.status || null,
        },
        pendingTrades: pendingTradeResponse.count || 0,
        recentActivity: recentActivity.slice(0, 5),
        announcement: announcementResponse.data ? {
          id: String(announcementResponse.data.id),
          title: announcementResponse.data.title,
          body: announcementResponse.data.body,
          priority: announcementResponse.data.priority === 'URGENT' ? 'URGENT' : 'NORMAL',
          isPinned: Boolean(announcementResponse.data.is_pinned),
          publishedAt: announcementResponse.data.published_at,
          expiresAt: announcementResponse.data.expires_at || null,
        } : null,
        chronicle: chronicleResponse.data ? {
          id: String(chronicleResponse.data.id),
          gameweek: Number(chronicleResponse.data.gameweek),
          title: chronicleResponse.data.title,
          summary: chronicleResponse.data.summary,
          publishedAt: chronicleResponse.data.published_at,
        } : null,
      });
    } catch (error: any) {
      console.error('[HOME DASHBOARD] Unable to load summary:', error);
      setErrorMessage(error?.message || 'The league summary could not be loaded.');
    } finally {
      setLoading(false);
      if (background === true) setRefreshing(false);
    }
  }, [activeLeagueId, currentUserId]);

  useEffect(() => {
    if (!activeLeagueId || !currentUserId) return;

    const refresh = () => void loadDashboard(true);
    const topic = `home-summary-${activeLeagueId}-${currentUserId}-${Date.now()}`;
    const channel = supabase
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_gameweeks', filter: `league_id=eq.${activeLeagueId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_fixtures', filter: `league_id=eq.${activeLeagueId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rosters', filter: `league_id=eq.${activeLeagueId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiver_claims', filter: `league_id=eq.${activeLeagueId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `league_id=eq.${activeLeagueId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'free_agent_transactions', filter: `league_id=eq.${activeLeagueId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_announcements', filter: `league_id=eq.${activeLeagueId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_chronicles', filter: `league_id=eq.${activeLeagueId}` }, refresh)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeLeagueId, currentUserId, loadDashboard]);

  return {
    ...state,
    loading,
    refreshing,
    errorMessage,
    refresh: loadDashboard,
  };
}
