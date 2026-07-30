import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  FlatList,
  ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../utils/supabase';

interface DraftSession {
  current_round: number;
  current_pick_index: number;
  current_picker_id: string;
  pick_deadline: string;
  draft_status: string;
}

interface DraftedPlayer {
  id: number;
  web_name: string;
  element_type: string;
  team_name: string;
  total_points: number;
  draft_rank: number;
}

interface ManagerProfile {
  user_id: string;
  team_name: string;
}

interface TickerPickItem {
  pickNumber: number;
  managerName: string;
  playerName: string;
  position: string;
}

type MainTab = 'POOL' | 'WATCHLIST' | 'SQUAD';
type SortMetric = 'RANK' | 'POINTS';

// 🔲 CUSTOM COLOR POSITION BADGE COMPONENT
const PositionBadge = ({ position }: { position: string }) => {
  let backgroundColor = '#333';
  let textColor = '#FFF';

  switch (position) {
    case 'GKP':
      backgroundColor = '#FFD60A'; // Yellow
      textColor = '#000';
      break;
    case 'DEF':
      backgroundColor = '#0A84FF'; // Blue
      break;
    case 'MID':
      backgroundColor = '#30D158'; // Green
      textColor = '#000';
      break;
    case 'FWD':
      backgroundColor = '#BF5AF2'; // Purple
      break;
  }

  return (
    <View style={[styles.posBadgeBox, { backgroundColor }]}>
      <Text style={[styles.posBadgeText, { color: textColor }]}>{position}</Text>
    </View>
  );
};

// ⏱️ DYNAMIC TURN BANNER & EXPIRY TICKER MODULE
const IsolatedTurnClock = React.memo(({ 
  deadline, 
  status,
  isMyTurn,
  picksUntilMyTurn,
  currentPickIndex,
  currentPickerId,
  managersList,
  onTimeout 
}: { 
  deadline: string; 
  status: string; 
  isMyTurn: boolean;
  picksUntilMyTurn: number;
  currentPickIndex: number;
  currentPickerId: string;
  managersList: ManagerProfile[];
  onTimeout: () => void;
}) => {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const triggerGate = useRef(false);

  useEffect(() => {
    triggerGate.current = false;
  }, [deadline]);

  useEffect(() => {
    const targetDeadline = deadline ? new Date(deadline).getTime() : Date.now() + 60000;
    
    if (status === 'COMPLETED') {
      setSecondsLeft(0);
      return;
    }

    const calculateTime = () => {
      const diff = targetDeadline - Date.now();
      if (diff <= 0) {
        setSecondsLeft(0);
        clearInterval(timer);
        if (!triggerGate.current) {
          triggerGate.current = true;
          onTimeout();
        }
      } else {
        setSecondsLeft(Math.ceil(diff / 1000));
      }
    };

    calculateTime();
    const timer = setInterval(calculateTime, 1000);
    return () => clearInterval(timer);
  }, [deadline, status, onTimeout]);

  if (status === 'COMPLETED') {
    return (
      <View style={[styles.turnHeader, styles.completedBg]}>
        <Text style={styles.turnLabel}>DRAFT COMPLETED</Text>
      </View>
    );
  }

  let headerStyle = isMyTurn ? styles.myTurnBg : styles.rivalTurnBg;
  let clockTextColor = '#00ff87';

  if (secondsLeft <= 5) {
    headerStyle = styles.criticalRedBg;
    clockTextColor = '#FF453A';
  } else if (secondsLeft <= 15) {
    headerStyle = styles.warningAmberBg;
    clockTextColor = '#FF9500';
  } else if (!isMyTurn) {
    clockTextColor = '#888';
  }

  const activeManager = managersList.find(m => m.user_id === currentPickerId);
  const activeManagerName = activeManager?.team_name || 'RIVAL MANAGER';

  return (
    <View style={[styles.turnHeader, headerStyle]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.turnLabel}>
          {isMyTurn ? 'YOUR TURN TO PICK' : `${activeManagerName.toUpperCase()} IS DRAFTING`}
        </Text>
        <Text style={styles.turnMetaSub}>
          Pick #{currentPickIndex} • {isMyTurn ? 'Your pick is active' : `${picksUntilMyTurn} picks until your turn`}
        </Text>
      </View>
      
      <View style={styles.clockContainer}>
        <Ionicons name="time" size={16} color={clockTextColor} />
        <Text style={[styles.clockText, { color: clockTextColor }]}>
          {String(secondsLeft).padStart(2, '0')}s
        </Text>
      </View>
    </View>
  );
});

// 📋 PREMIUM GRID PLAYER ROW COMPONENT
const PlayerPoolRow = React.memo(({ 
  item, 
  isSelected, 
  isOnWatchlist, 
  isMyTurn, 
  showPickCheckbox,
  watchlistIndex,
  onInspect, 
  onToggleWatchlist, 
  onSelect,
  onLongPressRow,
  onMoveUp,
  onMoveDown
}: {
  item: DraftedPlayer;
  isSelected: boolean;
  isOnWatchlist: boolean;
  isMyTurn: boolean;
  showPickCheckbox: boolean;
  watchlistIndex?: number;
  onInspect: (p: DraftedPlayer) => void;
  onToggleWatchlist: (p: DraftedPlayer) => void;
  onSelect: (p: DraftedPlayer) => void;
  onLongPressRow?: (p: DraftedPlayer) => void;
  onMoveUp?: (p: DraftedPlayer) => void;
  onMoveDown?: (p: DraftedPlayer) => void;
}) => (
  <View style={[styles.playerPoolRow, isSelected && styles.playerPoolRowSelected]}>
    <TouchableOpacity 
      style={styles.rowClickContainer} 
      onPress={() => onInspect(item)}
      onLongPress={() => onLongPressRow && onLongPressRow(item)}
      delayLongPress={300}
    >
      {watchlistIndex !== undefined && (
        <Text style={styles.watchlistIndexNumberText}>{watchlistIndex}. </Text>
      )}
      <View style={{ flex: 2 }}>
        <Text style={styles.poolPlayerNameText} numberOfLines={1}>{item.web_name}</Text>
        <Text style={styles.poolPlayerTeamText}>{item.team_name}</Text>
      </View>
      <PositionBadge position={item.element_type} />
      <View style={styles.splitMetricCell}>
        <Text style={styles.splitMetricVal}>#{item.draft_rank === 999 ? 'N/A' : item.draft_rank}</Text>
        <Text style={styles.splitMetricLabel}>Rank</Text>
      </View>
      <View style={styles.splitMetricCell}>
        <Text style={styles.splitMetricVal}>{item.total_points}</Text>
        <Text style={styles.splitMetricLabel}>Pts</Text>
      </View>
    </TouchableOpacity>

    <View style={styles.rowActionsCell}>
      {onMoveUp && onMoveDown ? (
        <View style={styles.shifterButtonsContainer}>
          <TouchableOpacity style={styles.shifterArrowPad} onPress={() => onMoveUp(item)}>
            <Ionicons name="chevron-up" size={14} color="#888" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.shifterArrowPad} onPress={() => onMoveDown(item)}>
            <Ionicons name="chevron-down" size={14} color="#888" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.shifterArrowPad, { backgroundColor: '#240C0A', marginRight: 4 }]} 
            onPress={() => onToggleWatchlist(item)}
          >
            <Ionicons name="trash-outline" size={13} color="#FF453A" />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={{ padding: 6, marginRight: 2 }} onPress={() => onToggleWatchlist(item)}>
          <Ionicons name={isOnWatchlist ? "star" : "star-outline"} size={18} color={isOnWatchlist ? "#FFD60A" : "#444"} />
        </TouchableOpacity>
      )}
      
      {showPickCheckbox && isMyTurn && (
        <TouchableOpacity style={{ padding: 6 }} onPress={() => onSelect(item)}>
          <Ionicons name={isSelected ? "checkbox" : "square-outline"} size={22} color="#00ff87" />
        </TouchableOpacity>
      )}
    </View>
  </View>
));

export default function LiveDraftRoomScreen() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<DraftSession | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [turnDurationSeconds, setTurnDurationSeconds] = useState<number>(60);
  const [localSyncing, setLocalSyncing] = useState(false);

  // 📢 Announcement Banner & Auto-Scrolling Ticker Hooks
  const [latestPickAlert, setLatestPickAlert] = useState<{
    managerName: string;
    playerName: string;
    position: string;
    team: string;
    pickNumber: number;
  } | null>(null);

  const [recentPicksFeed, setRecentPicksFeed] = useState<TickerPickItem[]>([]);
  const tickerScrollViewRef = useRef<ScrollView | null>(null);
  const tickerScrollPos = useRef(0);

  const [activeTab, setActiveTab] = useState<MainTab>('POOL');
  const [sortOrder, setSortOrder] = useState<SortMetric>('RANK');

  const [availablePlayers, setAvailablePlayers] = useState<DraftedPlayer[]>([]);
  const [watchlistIds, setWatchlistIds] = useState<number[]>([]);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [managersList, setManagersList] = useState<ManagerProfile[]>([]);
  
  const [selectedPlayer, setSelectedPlayer] = useState<DraftedPlayer | null>(null);
  const [inspectingPlayer, setInspectingPlayer] = useState<DraftedPlayer | null>(null);
  const [dragMovingPlayer, setDragMovingPlayer] = useState<DraftedPlayer | null>(null);

  const [draftStartTimeStr, setDraftStartTimeStr] = useState<string | null>(null);
  const [waitingRoomCountdown, setWaitingRoomCountdown] = useState<string>('00:00');

  const [isDebugDrawerOpen, setIsDebugDrawerOpen] = useState(false);
  const [isQuickRefVisible, setIsQuickRefVisible] = useState(false);
  const [quickRefTab, setQuickRefTab] = useState<'WATCHLIST' | 'POOL'>('WATCHLIST');

  const [myRoster, setMyRoster] = useState<Record<string, (DraftedPlayer | null)[]>>({
    GKP: [null, null], DEF: [null, null, null, null, null], MID: [null, null, null, null, null], FWD: [null, null, null]
  });

  const [filledPositions, setFilledPositions] = useState<Record<string, boolean>>({
    GKP: false, DEF: false, MID: false, FWD: false
  });

  const [picksUntilMyTurn, setPicksUntilMyTurn] = useState<number>(0);
  const isProcessingAutopick = useRef(false);

  // 🔄 AUTOMATIC SCROLLING ENGINE FOR BOTTOM TICKER
  useEffect(() => {
    if (recentPicksFeed.length === 0) return;

    const scrollTimer = setInterval(() => {
      tickerScrollPos.current += 1.5;
      if (tickerScrollPos.current > recentPicksFeed.length * 160) {
        tickerScrollPos.current = 0;
      }
      tickerScrollViewRef.current?.scrollTo({ x: tickerScrollPos.current, animated: false });
    }, 30);

    return () => clearInterval(scrollTimer);
  }, [recentPicksFeed]);

  // ⏱️ MANAGES PRE-LIVE WAITING ROOM COUNTDOWN & DRAFT KICKOFF
  useEffect(() => {
    if (!draftStartTimeStr || session?.draft_status === 'LIVE' || session?.draft_status === 'DRAFTING') return;

    const calculateWaitingClock = async () => {
      const targetTime = new Date(draftStartTimeStr).getTime();
      const diff = targetTime - Date.now();

      if (diff <= 0) {
        setWaitingRoomCountdown('00:00');
        clearInterval(waitingTimer);

        if (session?.draft_status === 'WAITING_ROOM' && leagueId) {
          console.log("🚀 Kickoff time reached! Launching draft via update_league_draft_status...");
          try {
            const { data, error } = await supabase.rpc('update_league_draft_status', {
              p_league_id: leagueId,
              p_status: 'LIVE'
            });

            if (error) {
              console.warn("update_league_draft_status RPC Error:", error.message);
              
              const fallback = await supabase.rpc('initialize_draft_session', { p_league_id: leagueId });
              
              if (fallback.error) {
                console.warn("RPC fallbacks failed. Performing direct table launch...", fallback.error.message);
                const { data: { user } } = await supabase.auth.getUser();
                await supabase
                  .from('draft_sessions')
                  .update({
                    draft_status: 'LIVE',
                    current_pick_index: 1,
                    current_round: 1,
                    current_picker_id: user?.id,
                    pick_deadline: new Date(Date.now() + (turnDurationSeconds || 60) * 1000).toISOString()
                  })
                  .eq('league_id', leagueId);

                await supabase
                  .from('leagues')
                  .update({ draft_status: 'DRAFTING', status: 'DRAFTING' })
                  .eq('id', leagueId);
              }
            } else {
              console.log("Draft successfully transitioned to LIVE:", data);
            }
          } catch (err: any) {
            console.error("Failed to execute live draft launch:", err.message || err);
          }
        }
      } else {
        const mins = Math.floor(diff / (1000 * 60));
        const secs = Math.floor((diff % (1000 * 60)) / 1000);
        setWaitingRoomCountdown(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
      }
    };

    calculateWaitingClock();
    const waitingTimer = setInterval(calculateWaitingClock, 1000);
    return () => clearInterval(waitingTimer);
  }, [draftStartTimeStr, session?.draft_status, leagueId, turnDurationSeconds]);

  useEffect(() => {
    let activeChannel: any = null;

    const engineStartup = async () => {
      try {
        console.log('============= 🧪 DRAFT DEBUG STARTUP =============');
        const { data: authData } = await supabase.auth.getUser();
        if (!authData?.user) return;
        const currentUid = authData.user.id;
        setMyUserId(currentUid);

        const { data: member } = await supabase.from('league_members').select('league_id').limit(1).single();
        if (!member) return;
        const currentLid = member.league_id;
        setLeagueId(currentLid);

        const { data: settingsData } = await supabase
          .from('league_settings')
          .select('draft_clock_duration, draft_start_time')
          .eq('league_id', currentLid)
          .maybeSingle();

        const customDuration = settingsData?.draft_clock_duration || 60;
        setTurnDurationSeconds(customDuration);
        
        if (settingsData?.draft_start_time) {
          setDraftStartTimeStr(settingsData.draft_start_time);
        }

        const { data: teamsProfiles } = await supabase
          .from('league_members')
          .select('user_id, team_name')
          .eq('league_id', currentLid);
        if (teamsProfiles) setManagersList(teamsProfiles);

        // Register Realtime Listener
        activeChannel = supabase
          .channel(`live-draft-room-${currentLid}`)
          .on(
            'postgres_changes', 
            { 
              event: 'UPDATE', 
              schema: 'public', 
              table: 'draft_sessions', 
              filter: `league_id=eq.${currentLid}` 
            }, 
            (payload) => {
              console.log('📡 REALTIME BROADCAST DETECTED:', payload.new);
              
              const incomingSession = payload.new as DraftSession;
              setSession(incomingSession);
              isProcessingAutopick.current = false;
              syncPipelineEngine(incomingSession, currentLid, currentUid, teamsProfiles || []);
            }
          )
          .subscribe((status) => {
            console.log(`🔌 Supabase WebSocket Connection Status: ${status}`);
          });

        let { data: activeSession } = await supabase.from('draft_sessions').select('*').eq('league_id', currentLid).maybeSingle();
        
        if (activeSession) {
          setSession(activeSession);
          await syncPipelineEngine(activeSession, currentLid, currentUid, teamsProfiles || []);
        } else {
          const fallbackSession: DraftSession = {
            current_round: 1,
            current_pick_index: 1,
            current_picker_id: '',
            pick_deadline: new Date().toISOString(),
            draft_status: 'WAITING_ROOM'
          };
          setSession(fallbackSession);
          await syncPipelineEngine(fallbackSession, currentLid, currentUid, teamsProfiles || []);
        }
      } catch (err) {
        console.error('CRITICAL STARTUP EXCEPTION ERROR:', err);
      } finally {
        setLoading(false);
      }
    };

    engineStartup();
    return () => { 
      if (activeChannel) {
        supabase.removeChannel(activeChannel); 
      }
    };
  }, []);

  const syncPipelineEngine = async (
    currentSession: DraftSession, 
    lId = leagueId, 
    uId = myUserId,
    profilesList = managersList
  ) => {
    if (!lId || !uId || !currentSession) return;
    try {
      const [membersResponse, picksResponse, watchlistResponse, playersResponse] = await Promise.all([
        supabase.from('league_members').select('user_id').eq('league_id', lId),
        supabase.from('draft_picks').select('player_id, user_id, round_number, overall_pick_number').eq('league_id', lId).order('overall_pick_number', { ascending: true }),
        supabase.from('watchlists').select('player_id').eq('league_id', lId).eq('user_id', uId).order('priority_order', { ascending: true }),
        supabase.from('players').select('id, web_name, element_type, team_name, total_points, draft_rank')
      ]);

      const membersList = membersResponse.data || [];
      const committedPicks = picksResponse.data || [];
      const watchlistRows = watchlistResponse.data || [];
      const masterPool = playersResponse.data || [];

      setWatchlistIds(watchlistRows.map(r => r.player_id));

      let totalRankCounter = 1;
      const parsedPool: DraftedPlayer[] = masterPool
        .sort((a, b) => (b.total_points || 0) - (a.total_points || 0))
        .map(p => {
          let typeStr = String(p.element_type || '').trim().toUpperCase();
          if (typeStr.includes('GKP') || typeStr === '1' || typeStr.includes('GOAL')) typeStr = 'GKP';
          else if (typeStr.includes('DEF') || typeStr === '2' || typeStr.includes('BACK')) typeStr = 'DEF';
          else if (typeStr.includes('MID') || typeStr === '3' || typeStr.includes('WING')) typeStr = 'MID';
          else if (typeStr.includes('FWD') || typeStr === '4' || typeStr.includes('FORW') || typeStr.includes('STRIKER')) typeStr = 'FWD';
          else typeStr = 'MID';

          const trueCalculatedRank = p.draft_rank && p.draft_rank !== 999 ? p.draft_rank : totalRankCounter++;

          return {
            id: p.id,
            web_name: p.web_name,
            element_type: typeStr,
            team_name: p.team_name,
            total_points: p.total_points || 0,
            draft_rank: trueCalculatedRank
          };
        });

      const draftedPlayerIds = new Set(committedPicks.map(p => p.player_id));
      setAvailablePlayers(parsedPool.filter(p => !draftedPlayerIds.has(p.id)));

      // 📢 POPULATE RECENT PICKS TICKER FEED & ANNOUNCEMENT BANNER
      if (committedPicks.length > 0) {
        const activeProfiles = profilesList.length > 0 ? profilesList : managersList;
        
        // 1. Single Latest Pick Announcement Banner
        const lastPick = committedPicks[committedPicks.length - 1];
        const lastPlayer = parsedPool.find(p => p.id === lastPick.player_id);
        const lastManager = activeProfiles.find(m => m.user_id === lastPick.user_id);

        if (lastPlayer) {
          setLatestPickAlert({
            managerName: lastManager?.team_name || 'Rival Manager',
            playerName: lastPlayer.web_name,
            position: lastPlayer.element_type,
            team: lastPlayer.team_name,
            pickNumber: lastPick.overall_pick_number || committedPicks.length,
          });
        }

        // 2. Horizontal Scroll Ticker Strip (Last 10 Picks)
        const recentFeed: TickerPickItem[] = committedPicks
          .slice(-10)
          .reverse()
          .map(pick => {
            const player = parsedPool.find(p => p.id === pick.player_id);
            const manager = activeProfiles.find(m => m.user_id === pick.user_id);
            return {
              pickNumber: pick.overall_pick_number || 0,
              managerName: manager?.team_name || 'Manager',
              playerName: player?.web_name || 'Player',
              position: player?.element_type || 'MID',
            };
          });

        setRecentPicksFeed(recentFeed);
      }

      const totalLeagueManagers = membersList.length || 1;
      const currentPickIndex = currentSession.current_pick_index;
      const roundNum = Math.ceil(currentPickIndex / totalLeagueManagers);
      const isRoundEven = roundNum % 2 === 0;
      const myIndexInLeague = membersList.findIndex(m => m.user_id === uId);
      
      let targetPickForMe = roundNum * totalLeagueManagers; 
      if (!isRoundEven) {
        targetPickForMe = ((roundNum - 1) * totalLeagueManagers) + (myIndexInLeague + 1);
      } else {
        targetPickForMe = (roundNum * totalLeagueManagers) - myIndexInLeague;
      }
      setPicksUntilMyTurn(targetPickForMe >= currentPickIndex ? targetPickForMe - currentPickIndex : 0);

      const freshRoster: Record<string, (DraftedPlayer | null)[]> = {
        GKP: [null, null], DEF: [null, null, null, null, null], MID: [null, null, null, null, null], FWD: [null, null, null]
      };

      committedPicks.filter(p => p.user_id === uId).forEach(pick => {
        const foundPlayer = parsedPool.find(p => p.id === pick.player_id);
        if (foundPlayer) {
          const pos = foundPlayer.element_type;
          const openIdx = freshRoster[pos].findIndex(slot => slot === null);
          if (openIdx !== -1) freshRoster[pos][openIdx] = foundPlayer;
        }
      });
      setMyRoster(freshRoster);

      setFilledPositions({
        GKP: freshRoster.GKP.filter(x => x !== null).length >= 2,
        DEF: freshRoster.DEF.filter(x => x !== null).length >= 5,
        MID: freshRoster.MID.filter(x => x !== null).length >= 5,
        FWD: freshRoster.FWD.filter(x => x !== null).length >= 3
      });

    } catch (err) {
      console.error('Data pipeline loading exception:', err);
    }
  };

  const memoizedFilteredPlayers = useMemo(() => {
    let sorted = [...availablePlayers];
    sorted.sort((a, b) => sortOrder === 'RANK' ? (a.draft_rank - b.draft_rank) : (b.total_points - a.total_points));
    sorted = sorted.filter(p => !filledPositions[p.element_type]);
    if (activeFilter !== 'ALL') sorted = sorted.filter(p => p.element_type === activeFilter);
    return sorted;
  }, [sortOrder, availablePlayers, activeFilter, filledPositions]);

  const executeDirectPriorityReindex = async (targetPlayerId: number, targetIndex: number) => {
    if (!leagueId || !myUserId) return;
    
    let baseIds = watchlistIds.filter(id => id !== targetPlayerId);
    baseIds.splice(targetIndex, 0, targetPlayerId);

    setWatchlistIds(baseIds); 
    setDragMovingPlayer(null);

    try {
      await Promise.all(baseIds.map((id, index) => 
        supabase.from('watchlists')
          .update({ priority_order: index + 1 })
          .eq('league_id', leagueId)
          .eq('user_id', myUserId)
          .eq('player_id', id)
      ));
      if (session) await syncPipelineEngine(session);
    } catch (err) {
      console.error(err);
    }
  };

  const handleMoveWatchlistPlayer = async (player: DraftedPlayer, direction: 'UP' | 'DOWN') => {
    const idx = watchlistIds.indexOf(player.id);
    if (idx === -1) return;
    const targetIdx = direction === 'UP' ? idx - 1 : idx + 1;
    if (targetIdx >= 0 && targetIdx < watchlistIds.length) {
      await executeDirectPriorityReindex(player.id, targetIdx);
    }
  };

  const handleSelectPress = (player: DraftedPlayer) => {
    setSelectedPlayer(selectedPlayer?.id === player.id ? null : player);
  };

  const toggleWatchlist = async (player: DraftedPlayer) => {
    if (!leagueId || !myUserId) return;
    const isAdded = watchlistIds.includes(player.id);
    try {
      if (isAdded) {
        await supabase.from('watchlists').delete().eq('league_id', leagueId).eq('user_id', myUserId).eq('player_id', player.id);
      } else {
        await supabase.from('watchlists').insert({ league_id: leagueId, user_id: myUserId, player_id: player.id, priority_order: watchlistIds.length + 1 });
      }
      if (session) await syncPipelineEngine(session);
    } catch (err) {
      console.error(err);
    }
  };

  // 🚨 TIMEOUT AUTO-PICK EXECUTOR
  const handleTurnTimeoutTrigger = useCallback(async () => {
    if (!session || !leagueId || isProcessingAutopick.current) return;
    const activeStatus = session.draft_status;
    if (activeStatus !== 'LIVE' && activeStatus !== 'DRAFTING') return;

    try {
      isProcessingAutopick.current = true;
      const currentPicker = session.current_picker_id;

      console.log(`⏱️ Turn timer expired. Invoking execute_draft_autopick...`);

      if (!currentPicker) return;

      const { data, error } = await supabase.rpc('execute_draft_autopick', {
        p_league_id: leagueId,
        p_user_id: currentPicker
      });

      if (error) {
        console.error("execute_draft_autopick RPC Error:", error.message);
      } else {
        console.log("Auto-pick committed successfully:", data);
      }
    } catch (err) {
      console.error("Auto-pick execution failed:", err);
    } finally {
      isProcessingAutopick.current = false;
    }
  }, [session, leagueId]);

  // ⚡ FIXED SINGLE-RPC MANUAL PICK SUBMISSION HANDLER
  const submitManualPick = async () => {
    if (!selectedPlayer || !session || !leagueId || !myUserId || localSyncing) return;
    try {
      setLocalSyncing(true);

      const { data: pickResult, error: pickError } = await supabase.rpc('execute_draft_pick', {
        p_league_id: leagueId,
        p_user_id: myUserId,
        p_player_id: selectedPlayer.id
      });

      if (pickError) throw pickError;

      if (pickResult && !pickResult.success) {
        if (pickResult.error === 'PLAYER_ALREADY_TAKEN') {
          Alert.alert('Selection Sniped!', 'Another manager drafted this player right before you.');
        } else if (pickResult.error === 'NOT_YOUR_TURN') {
          Alert.alert('Not Your Turn', 'Please wait for your pick in the turn order.');
        } else {
          Alert.alert('Selection Refused', pickResult.error || 'Could not submit pick.');
        }
        setSelectedPlayer(null);
        return;
      }

      // Pick succeeded! Reset selection and let Realtime subscription sync the update
      setSelectedPlayer(null);

    } catch (err: any) {
      Alert.alert(
        'Draft Transmission Failure', 
        err.message || 'Pick failed.'
      );
    } finally {
      setLocalSyncing(false);
    }
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color="#00ff87" /></View>;
  }

  const isLive = session?.draft_status === 'LIVE' || session?.draft_status === 'DRAFTING';
  const isMyTurn = isLive && session?.draft_status !== 'COMPLETED' && session?.current_picker_id === myUserId;
  const watchlistPlayers = availablePlayers.filter(p => watchlistIds.includes(p.id)).sort((a,b) => watchlistIds.indexOf(a.id) - watchlistIds.indexOf(b.id));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flex: 1 }}>
        {/* 📢 DYNAMIC HEADER STATE ENGINE */}
        {isLive || session?.draft_status === 'COMPLETED' ? (
          <React.Fragment>
            <IsolatedTurnClock 
              deadline={session?.pick_deadline || ''} 
              status={session?.draft_status || 'LIVE'} 
              isMyTurn={isMyTurn}
              picksUntilMyTurn={picksUntilMyTurn} 
              currentPickIndex={session?.current_pick_index || 1}
              currentPickerId={session?.current_picker_id || ''} 
              managersList={managersList} 
              onTimeout={handleTurnTimeoutTrigger} 
            />

            {/* Single Latest Pick Announcement Banner */}
            {isLive && latestPickAlert && (
              <View style={styles.latestPickBanner}>
                <Ionicons name="flash" size={14} color="#00ff87" />
                <Text style={styles.latestPickText} numberOfLines={1}>
                  <Text style={{ color: '#00ff87', fontWeight: '900' }}>
                    {latestPickAlert.managerName.toUpperCase()}
                  </Text>
                  {' '}drafted{' '}
                  <Text style={{ color: '#FFF', fontWeight: '900' }}>
                    {latestPickAlert.playerName}
                  </Text>
                  {' '}({latestPickAlert.position} • {latestPickAlert.team})
                </Text>
              </View>
            )}
          </React.Fragment>
        ) : (
          /* PRE-DRAFT WAITING ROOM HEADER */
          <View style={styles.nonBlockingWaitingRoomHeader}>
            <View style={styles.waitingHeaderMetaCol}>
              <Text style={styles.waitingHeaderTitleText}>🔴 PRE-DRAFT PREPARATION ACTIVE</Text>
              <Text style={styles.waitingHeaderMetaSub}>Realtime pipeline linked. Setup your watchlists below!</Text>
            </View>
            <View style={styles.headerClockBadgeContainer}>
              <Ionicons name="time" size={14} color="#00ff87" />
              <Text style={styles.headerClockBadgeStringText}>{waitingRoomCountdown}</Text>
            </View>
          </View>
        )}

        <View style={styles.tabNavbarGroup}>
          {(['POOL', 'WATCHLIST', 'SQUAD'] as MainTab[]).map((tab) => (
            <TouchableOpacity key={tab} style={[styles.navTabBtn, activeTab === tab && styles.navTabBtnActive]} onPress={() => setActiveTab(tab)}>
              <Text style={[styles.navTabText, activeTab === tab && styles.navTabTextActive]}>
                {tab === 'POOL' ? 'PLAYER POOL' : tab === 'WATCHLIST' ? 'WATCHLIST' : 'MY SQUAD'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ flex: 1 }}>
          {activeTab === 'POOL' && (
            <FlatList
              data={memoizedFilteredPlayers}
              keyExtractor={(item) => item.id.toString()}
              initialNumToRender={15}
              maxToRenderPerBatch={20}
              windowSize={5}
              removeClippedSubviews={Platform.OS === 'android'}
              ListEmptyComponent={<Text style={styles.emptyNoticeText}>No eligible players available inside formation slots.</Text>}
              ListHeaderComponent={
                <View style={styles.toolbarRow}>
                  <View style={styles.miniPositionRow}>
                    {['ALL', 'GKP', 'DEF', 'MID', 'FWD'].map(pos => (
                      <TouchableOpacity 
                        key={pos} disabled={pos !== 'ALL' && filledPositions[pos]}
                        style={[styles.miniPosBadge, activeFilter === pos && styles.miniPosBadgeActive, pos !== 'ALL' && filledPositions[pos] && styles.disabledPositionTab]} 
                        onPress={() => setActiveFilter(pos)}
                      >
                        <Text style={[styles.miniPosText, activeFilter === pos && styles.miniPosTextActive, pos !== 'ALL' && filledPositions[pos] && { color: '#222', textDecorationLine: 'line-through' }]}>{pos}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity style={styles.sortToggleBtn} onPress={() => setSortOrder(sortOrder === 'RANK' ? 'POINTS' : 'RANK')}>
                    <Ionicons name="swap-vertical" size={12} color="#00ff87" />
                    <Text style={styles.sortToggleText}>SORT: {sortOrder}</Text>
                  </TouchableOpacity>
                </View>
              }
              contentContainerStyle={{ paddingBottom: 30 }}
              renderItem={({ item }) => (
                <PlayerPoolRow
                  item={item} isSelected={selectedPlayer?.id === item.id} isOnWatchlist={watchlistIds.includes(item.id)}
                  isMyTurn={isMyTurn} showPickCheckbox={isLive} onInspect={setInspectingPlayer} onToggleWatchlist={toggleWatchlist} onSelect={handleSelectPress}
                />
              )}
            />
          )}

          {activeTab === 'WATCHLIST' && (
            <FlatList
              data={watchlistPlayers}
              keyExtractor={(item) => item.id.toString()}
              ListHeaderComponent={<Text style={styles.sectionHeading}>⭐ PRESS & HOLD ROWS TO REORDER PRIORITY QUEUE</Text>}
              ListEmptyComponent={<Text style={styles.emptyNoticeText}>No players added to watchlist queue.</Text>}
              contentContainerStyle={{ paddingBottom: 30 }}
              renderItem={({ item }) => (
                <PlayerPoolRow
                  item={item} isSelected={selectedPlayer?.id === item.id} isOnWatchlist={true} isMyTurn={isMyTurn}
                  watchlistIndex={watchlistIds.indexOf(item.id) + 1} showPickCheckbox={isLive} onInspect={setInspectingPlayer}
                  onToggleWatchlist={toggleWatchlist} onSelect={handleSelectPress} onLongPressRow={(p) => setDragMovingPlayer(p)}
                  onMoveUp={(p) => handleMoveWatchlistPlayer(p, 'UP')} onMoveDown={(p) => handleMoveWatchlistPlayer(p, 'DOWN')}
                />
              )}
            />
          )}

          {activeTab === 'SQUAD' && (
            <ScrollView contentContainerStyle={styles.pitchScrollBounds}>
              <View style={styles.footballPitchFieldContainer}>
                <View style={styles.fieldOuterBorderLine}>
                  <View style={styles.penaltyBoxTopArcArea} />
                  <View style={styles.centerFieldCircleDivider} />
                  
                  {/* FORWARDS */}
                  <View style={styles.pitchTacticalRowZone}>
                    <Text style={styles.pitchZoneIndicatorLabelText}>FORWARDS</Text>
                    <View style={styles.pitchPlayersHorizontalRowInline}>
                      {myRoster.FWD.map((player, idx) => (
                        <TouchableOpacity key={`fwd-${idx}`} style={[styles.pitchPlayerCardNode, player ? styles.pitchNodeFilled : styles.pitchNodeEmpty]} onPress={() => player && setInspectingPlayer(player)}>
                          <Ionicons name="shirt" size={20} color={player ? '#FF0055' : "#222"} />
                          <Text style={styles.pitchPlayerNameLabelText} numberOfLines={1}>{player ? player.web_name : 'Open Slot'}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* MIDFIELDERS */}
                  <View style={styles.pitchTacticalRowZone}>
                    <Text style={styles.pitchZoneIndicatorLabelText}>MIDFIELDERS</Text>
                    <View style={styles.pitchPlayersHorizontalRowInline}>
                      {myRoster.MID.map((player, idx) => (
                        <TouchableOpacity key={`mid-${idx}`} style={[styles.pitchPlayerCardNode, player ? styles.pitchNodeFilled : styles.pitchNodeEmpty]} onPress={() => player && setInspectingPlayer(player)}>
                          <Ionicons name="shirt" size={20} color={player ? "#30D158" : "#222"} />
                          <Text style={styles.pitchPlayerNameLabelText} numberOfLines={1}>{player ? player.web_name : 'Open'}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* DEFENDERS */}
                  <View style={styles.pitchTacticalRowZone}>
                    <Text style={styles.pitchZoneIndicatorLabelText}>DEFENDERS</Text>
                    <View style={styles.pitchPlayersHorizontalRowInline}>
                      {myRoster.DEF.map((player, idx) => (
                        <TouchableOpacity key={`def-${idx}`} style={[styles.pitchPlayerCardNode, player ? styles.pitchNodeFilled : styles.pitchNodeEmpty]} onPress={() => player && setInspectingPlayer(player)}>
                          <Ionicons name="shirt" size={20} color={player ? "#0A84FF" : "#222"} />
                          <Text style={styles.pitchPlayerNameLabelText} numberOfLines={1}>{player ? player.web_name : 'Open'}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* GOALKEEPERS */}
                  <View style={styles.pitchTacticalRowZone}>
                    <Text style={styles.pitchZoneIndicatorLabelText}>GOALKEEPERS</Text>
                    <View style={styles.pitchPlayersHorizontalRowInline}>
                      {myRoster.GKP.map((player, idx) => (
                        <TouchableOpacity key={`gkp-${idx}`} style={[styles.pitchPlayerCardNode, player ? styles.pitchNodeFilled : styles.pitchNodeEmpty]} onPress={() => player && setInspectingPlayer(player)}>
                          <Ionicons name="shirt" size={20} color={player ? "#FFD60A" : "#222"} />
                          <Text style={styles.pitchPlayerNameLabelText} numberOfLines={1}>{player ? player.web_name : 'Open'}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={styles.bottomGoalBoxContainerLine} />
                </View>
              </View>
            </ScrollView>
          )}
        </View>

        {/* 📺 PINNED BOTTOM AUTO-SCROLLING TICKER STRIP */}
        {isLive && recentPicksFeed.length > 0 && (
          <View style={styles.bottomTickerPinnedStrip}>
            <ScrollView 
              ref={tickerScrollViewRef}
              horizontal 
              showsHorizontalScrollIndicator={false} 
              scrollEnabled={false}
              contentContainerStyle={{ paddingHorizontal: 4 }}
            >
              {[...recentPicksFeed, ...recentPicksFeed].map((item, idx) => (
                <View key={`bottom-ticker-${item.pickNumber}-${idx}`} style={styles.tickerChip}>
                  <Text style={styles.tickerPickNum}>#{item.pickNumber}</Text>
                  <Text style={styles.tickerPlayerName}>{item.playerName}</Text>
                  <PositionBadge position={item.position} />
                  <Text style={styles.tickerManagerName}>({item.managerName})</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {isLive && (
          <TouchableOpacity 
            style={styles.floatingQuickRefFab} 
            onPress={() => setIsQuickRefVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="list-circle" size={24} color="#000" />
            <Text style={styles.fabLabelText}>TARGETS</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity 
          style={styles.diagnosticDebugFab} 
          onPress={() => setIsDebugDrawerOpen(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="bug-outline" size={16} color="#000" />
          <Text style={styles.debugFabLabelText}>DEBUG</Text>
        </TouchableOpacity>
      </View>

      {isLive && selectedPlayer && (activeTab === 'POOL' || activeTab === 'WATCHLIST') && (
        <View style={styles.workbenchActionSheet}>
          <View style={{ flex: 1 }}>
            <Text style={styles.workbenchTitle}>Confirm: {selectedPlayer.web_name}</Text>
            <Text style={styles.workbenchSub}>Deployment slot: Rank {selectedPlayer.draft_rank}</Text>
          </View>
          <TouchableOpacity 
            style={[styles.submitPickBtn, localSyncing && { opacity: 0.6 }]} 
            onPress={submitManualPick}
            disabled={localSyncing}
          >
            {localSyncing ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Text style={styles.submitPickBtnText}>SUBMIT PICK</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* REORDER INDEX QUEUE MODAL */}
      <Modal visible={dragMovingPlayer !== null} transparent animationType="fade">
        <View style={styles.modalBlurOverlay}>
          <View style={[styles.modalCardContainer, { maxHeight: '80%' }]}>
            <Text style={styles.modalPlayerTitle}>Reposition priority queue</Text>
            <Text style={styles.modalPlayerSub}>Select the target priority rank index assignment for {dragMovingPlayer?.web_name}</Text>
            <ScrollView style={{ marginVertical: 14 }}>
              {watchlistIds.map((_, index) => (
                <TouchableOpacity 
                  key={`target-idx-${index}`} style={styles.prioritySelectorChipRow}
                  onPress={() => dragMovingPlayer && executeDirectPriorityReindex(dragMovingPlayer.id, index)}
                >
                  <Text style={styles.prioritySelectorRowLabelText}>Move to Priority Rank Position #{index + 1}</Text>
                  <Ionicons name="arrow-forward" size={14} color="#00ff87" />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.closeModalBtn} onPress={() => setDragMovingPlayer(null)}><Text style={styles.closeModalBtnText}>CANCEL MOVEMENT</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* PLAYER CARD HOVER INSPECT MODAL */}
      <Modal visible={inspectingPlayer !== null} animationType="slide" transparent>
        <View style={styles.modalBlurOverlay}>
          <View style={styles.modalCardContainer}>
            {inspectingPlayer && (
              <>
                <Text style={styles.modalPlayerTitle}>{inspectingPlayer.web_name}</Text>
                <Text style={styles.modalPlayerSub}>{inspectingPlayer.element_type} • {inspectingPlayer.team_name}</Text>
                <View style={styles.dividerLine} />
                <Text style={styles.statsMetricsHeader}>CURRENT SEASON PERFORMANCE DATA</Text>
                <View style={styles.metricsGridContainer}>
                  <View style={styles.metricItemBox}><Text style={styles.metricValText}>{inspectingPlayer.total_points}</Text><Text style={styles.metricLabelText}>Total Points</Text></View>
                  <View style={styles.metricItemBox}><Text style={styles.metricValText}>#{inspectingPlayer.draft_rank === 999 ? 'N/A' : inspectingPlayer.draft_rank}</Text><Text style={styles.metricLabelText}>Draft Rank</Text></View>
                </View>
                <TouchableOpacity style={styles.closeModalBtn} onPress={() => setInspectingPlayer(null)}><Text style={styles.closeModalBtnText}>CLOSE PLAYER CARD</Text></TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* QUICK TARGET SHEET */}
      <Modal 
        visible={isQuickRefVisible} 
        animationType="slide" 
        transparent={true}
        onRequestClose={() => setIsQuickRefVisible(false)}
      >
        <View style={styles.quickRefOverlayPanel}>
          <View style={styles.quickRefCardContainer}>
            <View style={styles.drawerDragHandleRow}>
              <TouchableOpacity style={styles.closeDrawerHitbox} onPress={() => setIsQuickRefVisible(false)}>
                <Ionicons name="chevron-down" size={16} color="#555" />
                <Text style={styles.closeDrawerLabelText}>DISMISS HUB</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.quickRefTabsContainerRow}>
              <TouchableOpacity style={[styles.quickRefSubTabBtn, quickRefTab === 'WATCHLIST' && styles.quickRefSubTabBtnActive]} onPress={() => setQuickRefTab('WATCHLIST')}>
                <Text style={[styles.quickRefSubTabText, quickRefTab === 'WATCHLIST' && styles.quickRefSubTabTextActive]}>⭐ WATCHLIST ({watchlistPlayers.length})</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.quickRefSubTabBtn, quickRefTab === 'POOL' && styles.quickRefSubTabBtnActive]} onPress={() => setQuickRefTab('POOL')}>
                <Text style={[styles.quickRefSubTabText, quickRefTab === 'POOL' && styles.quickRefSubTabTextActive]}>🏃 LEAGUE POOL ({memoizedFilteredPlayers.length})</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={quickRefTab === 'WATCHLIST' ? watchlistPlayers : memoizedFilteredPlayers.slice(0, 30)}
              keyExtractor={(item) => `quick-ref-${item.id}`}
              renderItem={({ item, index }) => (
                <View style={styles.quickRefCompactRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.quickRefPlayerNameText} numberOfLines={1}>{quickRefTab === 'WATCHLIST' ? `${index + 1}. ` : ''}{item.web_name}</Text>
                    <Text style={styles.quickRefPlayerTeamText}>{item.team_name} • {item.element_type}</Text>
                  </View>
                  <View style={styles.quickRefMetricStack}><Text style={styles.quickRefMetricVal}>#{item.draft_rank}</Text></View>
                  <TouchableOpacity style={styles.quickRefActionSelectBtn} onPress={() => { handleSelectPress(item); setIsQuickRefVisible(false); }}>
                    <Ionicons name="add-circle-outline" size={16} color="#00ff87" />
                  </TouchableOpacity>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* DIAGNOSTICS DRAWER */}
      <Modal 
        visible={isDebugDrawerOpen} 
        animationType="slide" 
        transparent={true}
        onRequestClose={() => setIsDebugDrawerOpen(false)}
      >
        <View style={styles.debugDrawerOverlayPanel}>
          <View style={styles.debugDrawerCardContainer}>
            <View style={styles.debugDrawerHeaderRow}>
              <Text style={styles.debugDrawerTitleText}>🔬 SYSTEM PIPELINE DIAGNOSTICS</Text>
              <TouchableOpacity style={styles.debugCloseBtn} onPress={() => setIsDebugDrawerOpen(false)}>
                <Text style={styles.debugCloseBtnText}>DISMISS</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1, marginTop: 10 }}>
              <Text style={styles.debugSectionSubHeading}>GLOBAL SESSION METRICS</Text>
              <View style={styles.debugDataGridCard}>
                <Text style={styles.debugGridMetaItemText}>⚡ Status Parameter: {session?.draft_status || 'NULL'}</Text>
                <Text style={styles.debugGridMetaItemText}>🔢 Overall Pick Index: {session?.current_pick_index || 0}</Text>
                <Text style={styles.debugGridMetaItemText}>🔄 Round Matrix Bracket: {session?.current_round || 0}</Text>
              </View>
              <Text style={styles.debugSectionSubHeading}>MANAGED ROSTER ALLOCATION COUNTS</Text>
              <View style={styles.debugDataGridCard}>
                <Text style={styles.debugGridMetaItemText}>🧤 Goalkeepers (GKP): {myRoster.GKP.filter(Boolean).length} / 2</Text>
                <Text style={styles.debugGridMetaItemText}>🛡️ Defenders (DEF): {myRoster.DEF.filter(Boolean).length} / 5</Text>
                <Text style={styles.debugGridMetaItemText}>⚔️ Midfielders (MID): {myRoster.MID.filter(Boolean).length} / 5</Text>
                <Text style={styles.debugGridMetaItemText}>🚀 Forwards (FWD): {myRoster.FWD.filter(Boolean).length} / 3</Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' },
  turnHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: '#222' },
  myTurnBg: { backgroundColor: '#1A3B22', borderLeftWidth: 4, borderLeftColor: '#00ff87' },
  rivalTurnBg: { backgroundColor: '#111', borderLeftWidth: 4, borderLeftColor: '#444' },
  warningAmberBg: { backgroundColor: '#3D2A0A', borderLeftWidth: 4, borderLeftColor: '#FF9500' },
  criticalRedBg: { backgroundColor: '#3A1412', borderLeftWidth: 4, borderLeftColor: '#FF453A' },
  completedBg: { backgroundColor: '#1C1C1E', justifyContent: 'center' },
  turnLabel: { color: '#FFF', fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  turnMetaSub: { color: '#888', fontSize: 11, fontWeight: '600', marginTop: 2 },
  clockContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#000', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 4, borderWidth: 1, borderColor: '#222' },
  clockText: { fontSize: 14, fontWeight: '900', marginLeft: 6, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },

  latestPickBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111C15',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#00ff8733',
    gap: 8,
  },
  latestPickText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },

  bottomTickerPinnedStrip: {
    backgroundColor: '#0D0D0D',
    borderTopWidth: 1,
    borderTopColor: '#222',
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
    paddingVertical: 6,
  },
  tickerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#262626',
    gap: 6,
  },
  tickerPickNum: {
    color: '#00ff87',
    fontSize: 10,
    fontWeight: '900',
  },
  tickerPlayerName: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  tickerManagerName: {
    color: '#666',
    fontSize: 10,
    fontWeight: '600',
  },

  tabNavbarGroup: { flexDirection: 'row', backgroundColor: '#111', borderBottomWidth: 1, borderColor: '#222' },
  navTabBtn: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  navTabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#00ff87', backgroundColor: '#161616' },
  navTabText: { color: '#666', fontSize: 11, fontWeight: '800' },
  navTabTextActive: { color: '#00ff87', fontWeight: '900' },
  toolbarRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, marginVertical: 10 },
  miniPositionRow: { flexDirection: 'row', backgroundColor: '#111', padding: 2, borderRadius: 4, borderWidth: 1, borderColor: '#222' },
  miniPosBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 2 },
  miniPosBadgeActive: { backgroundColor: '#222' },
  miniPosText: { color: '#555', fontSize: 10, fontWeight: '800' },
  miniPosTextActive: { color: '#00ff87' },
  disabledPositionTab: { backgroundColor: '#0A0A0A', opacity: 0.15 },
  sortToggleBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 4, borderWidth: 1, borderColor: '#222' },
  sortToggleText: { color: '#888', fontSize: 10, fontWeight: '800', marginLeft: 6 },
  playerPoolRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderBottomColor: '#1c1c1c', backgroundColor: '#111' },
  playerPoolRowSelected: { backgroundColor: '#161C18' },
  rowClickContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14 },
  rowActionsCell: { flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
  posBadgeBox: { width: 42, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 4, marginHorizontal: 8 },
  posBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.2 },
  watchlistIndexNumberText: { color: '#888', fontSize: 13, fontWeight: '800', marginRight: 4, minWidth: 20 },
  shifterButtonsContainer: { flexDirection: 'row', marginRight: 4 },
  shifterArrowPad: { padding: 6, backgroundColor: '#1C1C1E', borderRadius: 4, marginLeft: 4 },
  poolPlayerNameText: { color: '#DDD', fontSize: 13, fontWeight: '800' },
  poolPlayerTeamText: { color: '#555', fontSize: 11, fontWeight: '600', marginTop: 1 },
  splitMetricCell: { width: 55, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: '#1A1A1A', paddingLeft: 4 },
  splitMetricVal: { color: '#FFF', fontSize: 12, fontWeight: '800' },
  splitMetricLabel: { color: '#444', fontSize: 8, fontWeight: '700', marginTop: 1 },
  sectionHeading: { color: '#00ff87', fontSize: 10, fontWeight: '900', paddingHorizontal: 14, marginVertical: 12, letterSpacing: 0.3 },
  emptyNoticeText: { color: '#444', fontSize: 11, textAlign: 'center', padding: 20, fontWeight: '600' },
  pitchScrollBounds: { paddingBottom: 20 },
  footballPitchFieldContainer: { backgroundColor: '#14381B', margin: 12, borderRadius: 8, padding: 12, borderWidth: 2, borderColor: '#5F8566', elevation: 4 },
  fieldOuterBorderLine: { borderWidth: 1.5, borderColor: '#A2C4A6', borderRadius: 4, paddingVertical: 16, alignItems: 'center', position: 'relative' },
  penaltyBoxTopArcArea: { position: 'absolute', top: -1, width: 100, height: 40, borderBottomWidth: 1.5, borderColor: '#A2C4A6', borderLeftWidth: 1.5, borderRightWidth: 1.5 },
  centerFieldCircleDivider: { position: 'absolute', top: '52%', width: '100%', height: 1.5, backgroundColor: '#A2C4A6' },
  bottomGoalBoxContainerLine: { position: 'absolute', bottom: -1, width: 100, height: 40, borderTopWidth: 1.5, borderColor: '#A2C4A6', borderLeftWidth: 1.5, borderRightWidth: 1.5 },
  pitchTacticalRowZone: { width: '100%', alignItems: 'center', marginVertical: 10, zIndex: 10 },
  pitchZoneIndicatorLabelText: { color: '#A2C4A6', fontSize: 8, fontWeight: '900', letterSpacing: 1, marginBottom: 8 },
  pitchPlayersHorizontalRowInline: { flexDirection: 'row', justifyContent: 'center', width: '100%', gap: 8, paddingHorizontal: 4 },
  pitchPlayerCardNode: { flex: 1, maxWidth: 80, minWidth: 60, height: 64, backgroundColor: '#0B1E11', borderWidth: 1, borderRadius: 4, borderColor: '#1E4627', alignItems: 'center', justifyContent: 'center', padding: 4 },
  pitchNodeFilled: { backgroundColor: '#08170C', borderColor: '#00ff8744' },
  pitchNodeEmpty: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: '#4E6A54' },
  pitchPlayerNameLabelText: { color: '#FFF', fontSize: 10, fontWeight: '800', marginTop: 4, textAlign: 'center' },
  prioritySelectorChipRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1A1A1A', padding: 14, borderRadius: 4, marginVertical: 4, borderWidth: 1, borderColor: '#222' },
  prioritySelectorRowLabelText: { color: '#DDD', fontSize: 12, fontWeight: '700' },
  workbenchActionSheet: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161616', borderTopWidth: 2, borderTopColor: '#00ff87', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#111' },
  submitPickBtn: { backgroundColor: '#00ff87', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 2 },
  submitPickBtnText: { color: '#000', fontSize: 11, fontWeight: '900' },
  workbenchTitle: { color: '#FFF', fontSize: 20, fontWeight: '900' },
  workbenchSub: { color: '#666', fontSize: 11, fontWeight: '600' },
  modalBlurOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 20 },
  modalCardContainer: { backgroundColor: '#111', padding: 20, borderRadius: 4, borderWidth: 1, borderColor: '#333' },
  modalPlayerTitle: { color: '#FFF', fontSize: 20, fontWeight: '900' },
  modalPlayerSub: { color: '#00ff87', fontSize: 12, fontWeight: '700', marginTop: 4 },
  dividerLine: { height: 1, backgroundColor: '#222', marginVertical: 14 },
  statsMetricsHeader: { color: '#555', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  metricsGridContainer: { flexDirection: 'row', gap: 12, marginVertical: 14 },
  metricItemBox: { flex: 1, backgroundColor: '#000', padding: 12, borderRadius: 2, borderWidth: 1, borderColor: '#222' },
  metricValText: { color: '#FFF', fontSize: 16, fontWeight: '900' },
  metricLabelText: { color: '#444', fontSize: 10, fontWeight: '700', marginTop: 2 },
  closeModalBtn: { backgroundColor: '#222', paddingVertical: 12, alignItems: 'center', borderRadius: 2, marginTop: 10 },
  closeModalBtnText: { color: '#AAA', fontSize: 11, fontWeight: '800' },
  nonBlockingWaitingRoomHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#111', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#222', borderLeftWidth: 4, borderLeftColor: '#FFD60A' },
  waitingHeaderMetaCol: { flex: 1, marginRight: 8 },
  waitingHeaderTitleText: { color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  waitingHeaderMetaSub: { color: '#555', fontSize: 10, fontWeight: '600', marginTop: 2 },
  headerClockBadgeContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#000', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 4, borderWidth: 1, borderColor: '#222' },
  headerClockBadgeStringText: { color: '#00ff87', fontSize: 16, fontWeight: '900', marginLeft: 6, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  floatingQuickRefFab: { position: 'absolute', bottom: 85, right: 16, backgroundColor: '#00ff87', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 30, flexDirection: 'row', alignItems: 'center', elevation: 8, zIndex: 999 },
  fabLabelText: { color: '#000', fontSize: 11, fontWeight: '900', marginLeft: 4, letterSpacing: 0.5 },
  quickRefOverlayPanel: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  quickRefCardContainer: { backgroundColor: '#111', borderTopLeftRadius: 12, borderTopRightRadius: 12, borderTopWidth: 2, borderTopColor: '#222', height: '65%', paddingHorizontal: 14 },
  drawerDragHandleRow: { alignItems: 'center', paddingVertical: 10 },
  closeDrawerHitbox: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 12, backgroundColor: '#1C1C1E', borderRadius: 20 },
  closeDrawerLabelText: { color: '#555', fontSize: 9, fontWeight: '800', marginLeft: 4, letterSpacing: 0.5 },
  quickRefTabsContainerRow: { flexDirection: 'row', backgroundColor: '#0A0A0A', padding: 3, borderRadius: 6, marginBottom: 12, borderWidth: 1, borderColor: '#222' },
  quickRefSubTabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 4 },
  quickRefSubTabBtnActive: { backgroundColor: '#161616' },
  quickRefSubTabText: { color: '#555', fontSize: 10, fontWeight: '800' },
  quickRefSubTabTextActive: { color: '#00ff87' },
  quickRefCompactRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#1c1c1c', gap: 10 },
  quickRefPlayerNameText: { color: '#DDD', fontSize: 13, fontWeight: '800' },
  quickRefPlayerTeamText: { color: '#555', fontSize: 10, fontWeight: '600', marginTop: 1 },
  quickRefMetricStack: { alignItems: 'center', width: 45 },
  quickRefMetricVal: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  quickRefActionSelectBtn: { borderWidth: 1, borderColor: '#333', backgroundColor: '#1C1C1E', padding: 8, borderRadius: 4 },
  diagnosticDebugFab: { position: 'absolute', bottom: 85, left: 16, backgroundColor: '#FF9500', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 30, flexDirection: 'row', alignItems: 'center', elevation: 8, zIndex: 1000 },
  debugDrawerOverlayPanel: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  debugDrawerCardContainer: { backgroundColor: '#111', borderTopLeftRadius: 12, borderTopRightRadius: 12, borderTopWidth: 2, borderTopColor: '#FF9500', height: '75%', padding: 16 },
  debugDrawerHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#222', paddingBottom: 12 },
  debugDrawerTitleText: { color: '#FF9500', fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  debugCloseBtn: { backgroundColor: '#222', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 4 },
  debugCloseBtnText: { color: '#AAA', fontSize: 10, fontWeight: '800' },
  debugSectionSubHeading: { color: '#555', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, marginTop: 14, marginBottom: 6 },
  debugDataGridCard: { backgroundColor: '#000', borderRadius: 4, padding: 12, borderWidth: 1, borderColor: '#222' },
  debugGridMetaItemText: { color: '#AAA', fontSize: 12, fontWeight: '700', marginVertical: 3 },
  debugFabLabelText: { color: '#000', fontSize: 11, fontWeight: '900', marginLeft: 4, letterSpacing: 0.5 },
});