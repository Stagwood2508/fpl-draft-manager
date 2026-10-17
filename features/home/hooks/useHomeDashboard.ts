import { useCallback, useEffect, useState } from 'react';

import { getLeagueActivity, LeagueActivityItem } from '@/features/market/services/leagueActivity';
import {
  GameweekPresentationState,
  resolveGameweekPresentationState,
} from '@/utils/gameweekPresentation';
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
  presentationState: GameweekPresentationState;
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

export interface HomeLivePlayer {
  playerId: number;
  playerName: string;
  clubName: string;
  minutes: number;
  points: number;
  goals: number;
  assists: number;
  yellowCards: number;
  code: number | null;
  photoCode: number | null;
  teamId: number | null;
}

export interface HomePremierLeagueFixture {
  id: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  kickoffTime: string | null;
  isFinished: boolean;
}

export interface HomeNextEvent {
  playerName: string;
  opponent: string;
  kickoffTime: string;
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
  fixtures: HomeFixture[];
  livePlayers: HomeLivePlayer[];
  premierLeagueFixtures: HomePremierLeagueFixture[];
  nextEvent: HomeNextEvent | null;
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
  fixtures: [],
  livePlayers: [],
  premierLeagueFixtures: [],
  nextEvent: null,
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

      const premierLeagueFixturesResponse = selectedGameweek
        ? await supabase
            .from('fixtures')
            .select('id, home_team_id, away_team_id, home_team_short, away_team_short, home_score, away_score, kickoff_time, is_finished, is_finished_provisional')
            .eq('gameweek', Number(selectedGameweek.gameweek))
            .order('kickoff_time', { ascending: true, nullsFirst: false })
        : { data: [], error: null };
      if (premierLeagueFixturesResponse.error) throw premierLeagueFixturesResponse.error;

      const presentationState = resolveGameweekPresentationState({
        deadline: selectedGameweek?.gw_deadline,
        isFinished: Boolean(selectedGameweek?.is_finished),
        fixtures: premierLeagueFixturesResponse.data || [],
        now,
      });

      const gameweek: HomeGameweek | null = selectedGameweek ? {
        gameweek: Number(selectedGameweek.gameweek),
        deadline: selectedGameweek.gw_deadline,
        waiverDeadline: selectedGameweek.waiver_deadline,
        status: selectedGameweek.status || null,
        isFinished: Boolean(selectedGameweek.is_finished),
        waiversProcessed: Boolean(selectedGameweek.is_waiver_processed),
        presentationState,
      } : null;

      const gameweekNumber = gameweek?.gameweek || 1;
      const isLive = gameweek?.presentationState === 'LIVE'
        || gameweek?.presentationState === 'AWAITING_CONFIRMATION';

      const [
        draftResponse,
        standingsResponse,
        fixtureResponse,
        fixturesResponse,
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
          .from('league_fixtures')
          .select('id, gameweek, home_user_id, away_user_id, home_team_name, away_team_name, home_score, away_score, is_finished, is_league_average')
          .eq('league_id', activeLeagueId)
          .eq('gameweek', gameweekNumber)
          .order('home_team_name', { ascending: true }),
        supabase
          .from('rosters')
          .select('is_starting, players(element_type, team_id, web_name)')
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
          // A multi-player offer is stored as one row per player swap. Count
          // its shared package ID below so the dashboard reports offers, not
          // the number of players in those offers.
          .select('id, parent_transaction_id')
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
      if (fixturesResponse.error) throw fixturesResponse.error;
      if (rosterResponse.error) throw rosterResponse.error;
      if (pendingTradeResponse.error) {
        console.warn('[HOME DASHBOARD] Pending trade count unavailable:', pendingTradeResponse.error.message);
      }
      if (announcementResponse.error) throw announcementResponse.error;
      if (chronicleResponse.error && chronicleResponse.error.code !== '42P01') {
        console.warn('[HOME DASHBOARD] Chronicle teaser unavailable:', chronicleResponse.error.message);
      }

      const mapFixture = (raw: any): HomeFixture => ({
        id: String(raw.id),
        gameweek: Number(raw.gameweek),
        homeUserId: raw.home_user_id || null,
        awayUserId: raw.away_user_id || null,
        homeTeamName: raw.home_team_name || 'Home Team',
        awayTeamName: raw.away_team_name || 'Away Team',
        homeScore: Number(raw.home_score || 0),
        awayScore: Number(raw.away_score || 0),
        isFinished: Boolean(raw.is_finished),
        isLeagueAverage: Boolean(raw.is_league_average),
      });
      let fixtures = (fixturesResponse.data || []).map(mapFixture);
      let fixture: HomeFixture | null = fixtureResponse.data ? mapFixture(fixtureResponse.data) : null;

      let livePlayers: HomeLivePlayer[] = [];
      if (isLive) {
        const { data: liveScores } = await supabase.rpc('get_league_live_fixture_scores', {
          p_league_id: activeLeagueId,
          p_gameweek: gameweekNumber,
        });
        const liveScoreByFixture = new Map<string, any>((liveScores || []).map((row: any): [string, any] => [String(row.fixture_id), row]));
        const applyLiveScore = (item: HomeFixture) => {
          const liveFixture = liveScoreByFixture.get(item.id);
          return liveFixture ? {
            ...item,
            homeScore: Number(liveFixture.home_score || 0),
            awayScore: Number(liveFixture.away_score || 0),
          } : item;
        };
        fixtures = fixtures.map(applyLiveScore);
        fixture = fixture ? applyLiveScore(fixture) : null;

        const { data: playerScores, error: playerScoresError } = await supabase.rpc('get_league_gameweek_player_scores', {
          p_league_id: activeLeagueId,
          p_gameweek: gameweekNumber,
        });
        if (playerScoresError) {
          console.warn('[HOME DASHBOARD] Live player scores unavailable:', playerScoresError.message);
        } else {
          const myLiveRows = (playerScores || [])
            .filter((row: any) => String(row.user_id) === String(currentUserId) && Number(row.minutes || 0) > 0)
            .sort((a: any, b: any) => Number(b.combined_points || 0) - Number(a.combined_points || 0));
          const playerIds = myLiveRows.map((row: any) => Number(row.player_id)).filter(Boolean);
          const { data: playerVisuals, error: playerVisualsError } = playerIds.length > 0
            ? await supabase.from('players').select('id, code, photo_code, team_id').in('id', playerIds)
            : { data: [], error: null };
          if (playerVisualsError) console.warn('[HOME DASHBOARD] Live player visuals unavailable:', playerVisualsError.message);
          const visualByPlayer = new Map((playerVisuals || []).map((player: any): [number, any] => [Number(player.id), player]));
          livePlayers = myLiveRows.slice(0, 5).map((row: any) => {
            const visual = visualByPlayer.get(Number(row.player_id));
            return {
              playerId: Number(row.player_id),
              playerName: row.player_name || 'Player',
              clubName: row.club_name || '',
              minutes: Number(row.minutes || 0),
              points: Number(row.combined_points || 0),
              goals: Number(row.goal_count || 0),
              assists: Number(row.assist_count || 0),
              yellowCards: Number(row.yellow_card_count || 0),
              code: visual?.code ?? null,
              photoCode: visual?.photo_code ?? null,
              teamId: visual?.team_id ?? null,
            };
          });
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
      const nextEventFixture = isLive
        ? (premierLeagueFixturesResponse.data || [])
          .filter((item: any) => item.kickoff_time && new Date(item.kickoff_time).getTime() > now)
          .sort((a: any, b: any) => new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime())
          .find((item: any) => starters.some((row: any) => {
            const player = firstRelation<any>(row.players);
            const teamId = Number(player?.team_id || 0);
            return teamId === Number(item.home_team_id) || teamId === Number(item.away_team_id);
          }))
        : null;
      const nextEventPlayer = nextEventFixture
        ? starters.map((row: any) => firstRelation<any>(row.players)).find((player: any) => {
            const teamId = Number(player?.team_id || 0);
            return teamId === Number(nextEventFixture.home_team_id) || teamId === Number(nextEventFixture.away_team_id);
          })
        : null;
      const nextEvent: HomeNextEvent | null = nextEventFixture && nextEventPlayer ? {
        playerName: nextEventPlayer.web_name || 'Your player',
        opponent: Number(nextEventPlayer.team_id) === Number(nextEventFixture.home_team_id)
          ? `${nextEventFixture.away_team_short || 'OPP'} H`
          : `${nextEventFixture.home_team_short || 'OPP'} A`,
        kickoffTime: nextEventFixture.kickoff_time,
      } : null;

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
        fixtures,
        livePlayers,
        premierLeagueFixtures: isLive ? (premierLeagueFixturesResponse.data || []).map((item: any) => ({
          id: Number(item.id),
          homeTeam: item.home_team_short || 'HOME',
          awayTeam: item.away_team_short || 'AWAY',
          homeScore: item.home_score === null || item.home_score === undefined ? null : Number(item.home_score),
          awayScore: item.away_score === null || item.away_score === undefined ? null : Number(item.away_score),
          kickoffTime: item.kickoff_time || null,
          isFinished: Boolean(item.is_finished),
        })) : [],
        nextEvent,
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
        pendingTrades: pendingTradeResponse.error
          ? 0
          : new Set((pendingTradeResponse.data || []).map((trade: any) =>
              String(trade.parent_transaction_id || trade.id)
            )).size,
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
