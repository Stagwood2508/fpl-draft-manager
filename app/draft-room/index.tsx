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
  ScrollView,
  TextInput,
  useWindowDimensions,
  Animated,
  Vibration,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer, type AudioPlayer } from 'expo-audio';
import { supabase } from '../../utils/supabase';
import PlayerCardModal from '../../components/PlayerCardModal';

interface DraftSession {
  current_round: number;
  current_pick_index: number;
  current_picker_id: string;
  pick_deadline: string | null;
  draft_status: string;
  pause_started_at?: string | null;
  paused_seconds_remaining?: number | null;
  paused_by?: string | null;
  updated_at?: string | null;
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
  draft_order: number | null;
}

interface TickerPickItem {
  pickNumber: number;
  managerName: string;
  playerName: string;
  position: string;
  pickSource: string;
  pickReason: string | null;
}

interface ManagerAutopickState {
  league_id: string;
  user_id: string;
  consecutive_autopicks: number;
  is_away: boolean;
}

interface WatchlistDraftedAlert {
  playerName: string;
  managerName: string;
  pickNumber: number;
}

interface PickConfirmation {
  playerName: string;
  club: string;
  position: string;
  managerName: string;
  round: number;
  pickNumber: number;
}

type MainTab = 'POOL' | 'WATCHLIST' | 'SQUAD';
type SortMetric = 'RANK' | 'POINTS';
type RealtimeConnectionState = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'OFFLINE';

const getAutopickReasonLabel = (reason: string | null) => {
  if (reason === 'MANAGER_AWAY') return 'AWAY';
  if (reason === 'COMMISSIONER_FORCED') return 'COMMISSIONER';
  return 'TIMER';
};

const getDraftTurnKey = (draftSession: DraftSession | null) =>
  draftSession
    ? `${draftSession.current_round}:${draftSession.current_pick_index}:${draftSession.current_picker_id}`
    : null;

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
  pausedSecondsRemaining,
  isMyTurn,
  picksUntilMyTurn,
  currentPickIndex,
  currentPickerId,
  managersList,
  connectionState,
  activeManagerAway,
  onDeadlineReached,
}: { 
  deadline: string | null;
  status: string; 
  pausedSecondsRemaining?: number | null;
  isMyTurn: boolean;
  picksUntilMyTurn: number;
  currentPickIndex: number;
  currentPickerId: string;
  managersList: ManagerProfile[];
  connectionState: RealtimeConnectionState;
  activeManagerAway: boolean;
  onDeadlineReached?: () => void;
}) => {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const turnPulse = useRef(new Animated.Value(0)).current;
  const handledDeadlineRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isMyTurn || status === 'COMPLETED') {
      turnPulse.stopAnimation();
      turnPulse.setValue(0);
      return;
    }

    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(turnPulse, {
          toValue: 1,
          duration: 520,
          useNativeDriver: true,
        }),
        Animated.timing(turnPulse, {
          toValue: 0,
          duration: 760,
          useNativeDriver: true,
        }),
      ]),
      { iterations: 3 }
    );

    pulseAnimation.start();
    return () => pulseAnimation.stop();
  }, [isMyTurn, status, turnPulse]);

useEffect(() => {
  if (status === 'PAUSED') {
    setSecondsLeft(pausedSecondsRemaining || 0);
    return;
  }

  const targetDeadline = deadline
    ? new Date(deadline).getTime()
    : Date.now() + 60000;

  if (status === 'COMPLETED') {
    setSecondsLeft(0);
    return;
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  const calculateTime = () => {
    const diff = targetDeadline - Date.now();

    if (diff <= 0) {
      setSecondsLeft(0);

      if (
        isMyTurn &&
        handledDeadlineRef.current !== deadline
      ) {
        handledDeadlineRef.current = deadline;
        onDeadlineReached?.();
      }

      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      return;
    }

    setSecondsLeft(Math.ceil(diff / 1000));
  };

  calculateTime();
  timer = setInterval(calculateTime, 1000);

  return () => {
    if (timer) {
      clearInterval(timer);
    }
  };
}, [deadline, status, pausedSecondsRemaining, isMyTurn, onDeadlineReached]);

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
      {isMyTurn && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.myTurnPulseOverlay,
            {
              opacity: turnPulse.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.34],
              }),
              transform: [
                {
                  scale: turnPulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.985, 1.025],
                  }),
                },
              ],
            },
          ]}
        />
      )}
      <View style={{ flex: 1 }}>
        {isMyTurn && (
          <View style={styles.yourTurnPill}>
            <View style={styles.yourTurnLiveDot} />
            <Text style={styles.yourTurnPillText}>YOUR PICK IS LIVE</Text>
          </View>
        )}
        <Text style={styles.turnLabel}>
          {activeManagerAway
            ? `${activeManagerName.toUpperCase()} IS IN AWAY MODE`
            : isMyTurn
              ? 'YOUR TURN TO PICK'
              : `${activeManagerName.toUpperCase()} IS DRAFTING`}
        </Text>
        <Text style={styles.turnMetaSub}>
          Pick #{currentPickIndex} • {isMyTurn ? 'Your pick is active' : `${picksUntilMyTurn} picks until your turn`}
        </Text>
      </View>
      
      <View style={styles.turnStatusRail}>
        <View style={styles.connectionStatusPill}>
          <View
            style={[
              styles.connectionStatusDot,
              connectionState === 'CONNECTED'
                ? styles.connectionStatusDotConnected
                : connectionState === 'OFFLINE'
                  ? styles.connectionStatusDotOffline
                  : styles.connectionStatusDotConnecting,
            ]}
          />
          <Text style={styles.connectionStatusPillText}>
            {connectionState === 'CONNECTED' ? 'LIVE SYNC' : connectionState === 'OFFLINE' ? 'OFFLINE' : 'CONNECTING'}
          </Text>
        </View>
        <View style={styles.clockContainer}>
          <Ionicons name="time" size={16} color={clockTextColor} />
          <Text style={[styles.clockText, { color: clockTextColor }]}>
            {activeManagerAway ? 'AUTO' : secondsLeft === 0 ? 'PICKING' : `${String(secondsLeft).padStart(2, '0')}s`}
          </Text>
        </View>
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
}) => {
  const isPickDisabled = showPickCheckbox && !isMyTurn;
  const [isInfoHovered, setIsInfoHovered] = useState(false);

  return (
  <View
    style={[
      styles.playerPoolRow,
      isSelected && styles.playerPoolRowSelected,
      isPickDisabled && styles.playerPoolRowTurnDisabled,
    ]}
  >
    <Pressable
      style={({ pressed }) => [
        styles.rowClickContainer,
        isInfoHovered && styles.rowClickContainerHovered,
        pressed && styles.rowClickContainerPressed,
      ]}
      onPress={() => onInspect(item)}
      onLongPress={() => onLongPressRow && onLongPressRow(item)}
      onHoverIn={() => Platform.OS === 'web' && setIsInfoHovered(true)}
      onHoverOut={() => Platform.OS === 'web' && setIsInfoHovered(false)}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={`View stats for ${item.web_name}`}
    >
      {watchlistIndex !== undefined && (
        <Text style={styles.watchlistIndexNumberText}>{watchlistIndex}. </Text>
      )}
      <View style={styles.poolPlayerIdentity}>
        <Text style={styles.poolPlayerNameText} numberOfLines={1}>{item.web_name}</Text>
        <Text style={styles.poolPlayerTeamText} numberOfLines={1}>
          {item.team_name} · #{item.draft_rank === 999 ? 'N/A' : item.draft_rank} · {item.total_points} pts
        </Text>
      </View>
      <PositionBadge position={item.element_type} />
      <Ionicons name="information-circle-outline" size={16} color="#71818E" />
    </Pressable>

    <View style={styles.playerRowActionBar}>
      {onMoveUp && onMoveDown ? (
        <>
          <PlayerRowAction icon="arrow-up" label="UP" onPress={() => onMoveUp(item)} />
          <PlayerRowAction icon="arrow-down" label="DOWN" onPress={() => onMoveDown(item)} />
          <PlayerRowAction
            icon="trash-outline"
            label="REMOVE"
            danger
            onPress={() => onToggleWatchlist(item)}
          />
        </>
      ) : (
        <PlayerRowAction
          icon={isOnWatchlist ? 'star' : 'star-outline'}
          label={isOnWatchlist ? 'WATCHED' : 'WATCH'}
          active={isOnWatchlist}
          onPress={() => onToggleWatchlist(item)}
        />
      )}
      
      {showPickCheckbox && (
        <PlayerRowAction
          icon={isPickDisabled ? 'lock-closed' : isSelected ? 'checkbox' : 'add-circle-outline'}
          label={isPickDisabled ? 'WAIT' : isSelected ? 'SELECTED' : 'SELECT'}
          active={isSelected && !isPickDisabled}
          disabled={isPickDisabled}
          onPress={() => onSelect(item)}
        />
      )}
    </View>
  </View>
  );
});

const PickReviewPanel = React.memo(({
  player,
  deadline,
  currentPositionCount,
  positionLimit,
  syncing,
  isCentered,
  submissionError,
  onCancel,
  onConfirm,
}: {
  player: DraftedPlayer;
  deadline: string;
  currentPositionCount: number;
  positionLimit: number;
  syncing: boolean;
  isCentered: boolean;
  submissionError: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const updateCountdown = () => {
      const deadlineMs = new Date(deadline).getTime();
      const remaining = Number.isFinite(deadlineMs)
        ? Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000))
        : 0;
      setSecondsLeft(remaining);
    };

    updateCountdown();
    const countdownTimer = setInterval(updateCountdown, 1000);
    return () => clearInterval(countdownTimer);
  }, [deadline]);

  const isUrgent = secondsLeft > 0 && secondsLeft <= 10;

  const panel = (
    <View style={[styles.pickReviewPanel, isCentered && styles.pickReviewPanelCentered]}>
      <View style={styles.pickReviewHeader}>
        <View style={styles.pickReviewIdentity}>
          <PositionBadge position={player.element_type} />
          <View style={styles.pickReviewNameBlock}>
            <Text style={styles.pickReviewKicker}>REVIEW YOUR PICK</Text>
            <Text style={styles.pickReviewPlayerName} numberOfLines={1}>{player.web_name}</Text>
            <Text style={styles.pickReviewClub} numberOfLines={1}>{player.team_name}</Text>
          </View>
        </View>
        <View style={[styles.pickReviewTimer, isUrgent && styles.pickReviewTimerUrgent]}>
          <Ionicons name="time-outline" size={13} color={isUrgent ? '#FF6B61' : '#00F27A'} />
          <Text style={[styles.pickReviewTimerText, isUrgent && styles.pickReviewTimerTextUrgent]}>
            {secondsLeft === 0 ? 'PICKING' : `${secondsLeft}s`}
          </Text>
        </View>
      </View>

      <View style={styles.pickReviewFacts}>
        <View style={styles.pickReviewFact}>
          <Text style={styles.pickReviewFactValue}>#{player.draft_rank === 999 ? 'N/A' : player.draft_rank}</Text>
          <Text style={styles.pickReviewFactLabel}>RANK</Text>
        </View>
        <View style={styles.pickReviewFact}>
          <Text style={styles.pickReviewFactValue}>{player.total_points}</Text>
          <Text style={styles.pickReviewFactLabel}>LAST PTS</Text>
        </View>
        <View style={styles.pickReviewFact}>
          <Text style={styles.pickReviewFactValue}>{Math.min(currentPositionCount + 1, positionLimit)}/{positionLimit}</Text>
          <Text style={styles.pickReviewFactLabel}>{player.element_type} SLOTS</Text>
        </View>
      </View>

      {submissionError && (
        <View style={styles.pickReviewRetryNotice}>
          <Ionicons name="cloud-offline-outline" size={14} color="#FFB340" />
          <Text style={styles.pickReviewRetryNoticeText}>{submissionError}</Text>
        </View>
      )}

      <View style={styles.pickReviewActions}>
        <TouchableOpacity
          style={styles.cancelPickReviewButton}
          onPress={onCancel}
          disabled={syncing}
        >
          <Text style={styles.cancelPickReviewButtonText}>CANCEL</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmPickReviewButton, syncing && styles.confirmPickReviewButtonDisabled]}
          onPress={onConfirm}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator color="#00150B" size="small" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={15} color="#00150B" />
              <Text style={styles.confirmPickReviewButtonText}>
                {submissionError ? 'TRY AGAIN' : 'CONFIRM PICK'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  if (isCentered) {
    return (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={onCancel}
        statusBarTranslucent
      >
        <View style={styles.pickReviewModalOverlay}>
          {panel}
        </View>
      </Modal>
    );
  }

  if (status === 'PAUSED') {
    return (
      <View style={[styles.turnHeader, styles.pausedBg]}>
        <View style={styles.pausedTurnCopy}>
          <Text style={styles.turnLabel}>DRAFT PAUSED</Text>
          <Text style={styles.turnMetaSub}>
            The current turn is frozen
            {secondsLeft > 0 ? ` with ${secondsLeft}s remaining` : ''}.
          </Text>
        </View>
        <View style={styles.pausedTurnBadge}>
          <Ionicons name="pause" size={18} color="#FFB340" />
        </View>
      </View>
    );
  }

  return panel;
});

const PickConfirmationOverlay = ({
  confirmation,
  onClose,
}: {
  confirmation: PickConfirmation;
  onClose: () => void;
}) => {
  const reveal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(reveal, {
      toValue: 1,
      tension: 72,
      friction: 7,
      useNativeDriver: true,
    }).start();
  }, [reveal]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.pickConfirmationOverlay}>
        <Animated.View
          style={[
            styles.pickConfirmationCard,
            {
              opacity: reveal,
              transform: [
                {
                  scale: reveal.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.82, 1],
                  }),
                },
                {
                  translateY: reveal.interpolate({
                    inputRange: [0, 1],
                    outputRange: [22, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.pickConfirmationSuccessIcon}>
            <Ionicons name="checkmark" size={32} color="#04100A" />
          </View>

          <Text style={styles.pickConfirmationEyebrow}>PICK CONFIRMED</Text>
          <Text style={styles.pickConfirmationPlayerName}>
            {confirmation.playerName}
          </Text>
          <Text style={styles.pickConfirmationClub}>{confirmation.club}</Text>

          <View style={styles.pickConfirmationMetaRow}>
            <View style={styles.pickConfirmationPositionBadge}>
              <Text style={styles.pickConfirmationPositionText}>
                {confirmation.position}
              </Text>
            </View>

            <View style={styles.pickConfirmationMetaDivider} />

            <View style={styles.pickConfirmationMetaBlock}>
              <Text style={styles.pickConfirmationMetaLabel}>ROUND</Text>
              <Text style={styles.pickConfirmationMetaValue}>
                {confirmation.round}
              </Text>
            </View>

            <View style={styles.pickConfirmationMetaBlock}>
              <Text style={styles.pickConfirmationMetaLabel}>OVERALL</Text>
              <Text style={styles.pickConfirmationMetaValue}>
                #{confirmation.pickNumber}
              </Text>
            </View>
          </View>

          <View style={styles.pickConfirmationManagerRow}>
            <Ionicons name="shield-checkmark" size={15} color="#00F27A" />
            <Text style={styles.pickConfirmationManagerName} numberOfLines={1}>
              Drafted by {confirmation.managerName}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.pickConfirmationDismissButton}
            onPress={onClose}
          >
            <Text style={styles.pickConfirmationDismissText}>CONTINUE DRAFT</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

const PlayerRowAction = React.memo(({
  icon,
  label,
  active = false,
  danger = false,
  disabled = false,
  onPress,
}: {
  icon: any;
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const iconColor = disabled
    ? '#536473'
    : danger
      ? '#FF6B61'
      : active
        ? '#00F27A'
        : '#91A0AC';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.playerRowActionButton,
        active && styles.playerRowActionButtonActive,
        danger && styles.playerRowActionButtonDanger,
        disabled && styles.playerRowActionButtonDisabled,
        isHovered && !disabled && styles.playerRowActionButtonHovered,
        pressed && !disabled && styles.playerRowActionButtonPressed,
      ]}
      onPress={onPress}
      onHoverIn={() => Platform.OS === 'web' && setIsHovered(true)}
      onHoverOut={() => Platform.OS === 'web' && setIsHovered(false)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={16} color={iconColor} />
    </Pressable>
  );
});

export default function LiveDraftRoomScreen() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const pickConfirmedSound = useAudioPlayer(
    require('../../assets/sounds/draft-pick-confirmed.wav')
  );
  const watchlistAlertSound = useAudioPlayer(
    require('../../assets/sounds/draft-watchlist-alert.wav')
  );

const isDesktop = width >= 1050;
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<DraftSession | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [isCommissionerPanelOpen, setIsCommissionerPanelOpen] = useState(false);
  const [commissionerAction, setCommissionerAction] = useState<string | null>(null);
  const [commissionerNotice, setCommissionerNotice] = useState<string | null>(null);
  const [confirmCommissionerAutopick, setConfirmCommissionerAutopick] = useState(false);
  const [commissionerPlayerMode, setCommissionerPlayerMode] = useState<'ASSIGN' | 'CORRECT' | null>(null);
  const [commissionerPlayerSearch, setCommissionerPlayerSearch] = useState('');
  const [isDraftOrderEditorOpen, setIsDraftOrderEditorOpen] = useState(false);
  const [draftOrderDraft, setDraftOrderDraft] = useState<ManagerProfile[]>([]);
  const [turnDurationSeconds, setTurnDurationSeconds] = useState<number>(60);
  const [localSyncing, setLocalSyncing] = useState(false);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('CONNECTING');
  const [reconnectNotice, setReconnectNotice] = useState<string | null>(null);
  const [pickSubmissionError, setPickSubmissionError] = useState<string | null>(null);
  const [isDraftTrackerExpanded, setIsDraftTrackerExpanded] =
    useState(true);
  const [isHapticsEnabled, setIsHapticsEnabled] = useState(true);
  const [isDraftSoundEnabled, setIsDraftSoundEnabled] = useState(false);
  const [highlightedPickerId, setHighlightedPickerId] = useState<string | null>(null);
  const [pickConfirmation, setPickConfirmation] = useState<PickConfirmation | null>(null);
  const draftOrderScrollViewRef = useRef<ScrollView | null>(null);
  const previousPickerIdRef = useRef<string | null>(null);
  const previousTurnKeyRef = useRef<string | null>(null);
  const sessionRef = useRef<DraftSession | null>(null);
  const hasConnectedRef = useRef(false);
  const resyncInFlightRef = useRef(false);
  const submissionInFlightRef = useRef<string | null>(null);
  const seenDraftPickNumbersRef = useRef<Set<number> | null>(null);
  const watchlistIdsRef = useRef<number[]>([]);

  // 📢 Announcement Banner & Auto-Scrolling Ticker Hooks
  const [latestPickAlert, setLatestPickAlert] = useState<{
    managerName: string;
    playerName: string;
    position: string;
    team: string;
    pickNumber: number;
    pickSource: string;
    pickReason: string | null;
  } | null>(null);

  const [recentPicksFeed, setRecentPicksFeed] = useState<TickerPickItem[]>([]);
  const [watchlistDraftedAlert, setWatchlistDraftedAlert] = useState<WatchlistDraftedAlert | null>(null);
  const tickerScrollViewRef = useRef<ScrollView | null>(null);
  const tickerScrollPos = useRef(0);

  const [activeTab, setActiveTab] = useState<MainTab>('POOL');
  const [sortOrder, setSortOrder] = useState<SortMetric>('RANK');

  const [availablePlayers, setAvailablePlayers] = useState<DraftedPlayer[]>([]);
  const [watchlistIds, setWatchlistIds] = useState<number[]>([]);
  const [managerAutopickStates, setManagerAutopickStates] = useState<ManagerAutopickState[]>([]);
  const [markingPresent, setMarkingPresent] = useState(false);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [playerSearch, setPlayerSearch] = useState('');
  const [activeClub, setActiveClub] = useState('ALL');
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

  useEffect(() => {
    AsyncStorage.getItem('draft_haptics_enabled')
      .then(value => {
        if (value !== null) {
          setIsHapticsEnabled(value === 'true');
        }
      })
      .catch(error => {
        console.warn('Unable to load draft haptics preference:', error);
      });
  }, []);

  useEffect(() => {
    setDraftOrderDraft([...managersList].sort((a, b) => (a.draft_order || 999) - (b.draft_order || 999)));
  }, [managersList]);

  useEffect(() => {
    AsyncStorage.getItem('draft_sound_enabled')
      .then(value => {
        if (value !== null) setIsDraftSoundEnabled(value === 'true');
      })
      .catch(error => {
        console.warn('Unable to load draft sound preference:', error);
      });
  }, []);

  const playDraftSound = useCallback(async (player: AudioPlayer) => {
    if (!isDraftSoundEnabled) return;

    try {
      await player.seekTo(0);
      player.play();
    } catch (error) {
      console.warn('Unable to play draft sound:', error);
    }
  }, [isDraftSoundEnabled]);

  useEffect(() => {
    if (!watchlistDraftedAlert) return;

    void playDraftSound(watchlistAlertSound);
    const alertTimer = setTimeout(() => setWatchlistDraftedAlert(null), 5200);
    return () => clearTimeout(alertTimer);
  }, [watchlistDraftedAlert, playDraftSound, watchlistAlertSound]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    watchlistIdsRef.current = watchlistIds;
  }, [watchlistIds]);

  useEffect(() => {
    const nextPickerId = session?.current_picker_id || null;
    const previousPickerId = previousPickerIdRef.current;

    if (nextPickerId && previousPickerId && nextPickerId !== previousPickerId) {
      setHighlightedPickerId(nextPickerId);

      if (
        nextPickerId === myUserId &&
        isHapticsEnabled &&
        Platform.OS !== 'web'
      ) {
        Vibration.vibrate(70);
      }

      const highlightTimer = setTimeout(() => {
        setHighlightedPickerId(current =>
          current === nextPickerId ? null : current
        );
      }, 1400);

      previousPickerIdRef.current = nextPickerId;
      return () => clearTimeout(highlightTimer);
    }

    previousPickerIdRef.current = nextPickerId;
  }, [session?.current_picker_id, myUserId, isHapticsEnabled]);

  useEffect(() => {
    const nextTurnKey = session
      ? `${session.current_round}:${session.current_pick_index}:${session.current_picker_id}`
      : null;
    const previousTurnKey = previousTurnKeyRef.current;

    if (!nextTurnKey) {
      setSelectedPlayer(null);
      previousTurnKeyRef.current = null;
      return;
    }

    if (session?.draft_status === 'PAUSED') {
      setSelectedPlayer(null);
      setPickSubmissionError(null);
      submissionInFlightRef.current = null;
    }

    if (previousTurnKey && previousTurnKey !== nextTurnKey) {
      setSelectedPlayer(null);
      setPickSubmissionError(null);
      submissionInFlightRef.current = null;
    }

    previousTurnKeyRef.current = nextTurnKey;
  }, [
    session?.current_round,
    session?.current_pick_index,
    session?.current_picker_id,
    session?.draft_status,
  ]);

  useEffect(() => {
    if (!selectedPlayer) {
      return;
    }

    const playerIsStillAvailable = availablePlayers.some(
      player => player.id === selectedPlayer.id
    );
    const selectedPositionIsFull = Boolean(
      filledPositions[selectedPlayer.element_type]
    );

    if (!playerIsStillAvailable || selectedPositionIsFull) {
      setSelectedPlayer(null);
    }
  }, [
    selectedPlayer?.id,
    selectedPlayer?.element_type,
    availablePlayers,
    filledPositions,
  ]);

  useEffect(() => {
    if (!pickConfirmation) {
      return;
    }

    const confirmationTimer = setTimeout(
      () => setPickConfirmation(null),
      3200
    );

    return () => clearTimeout(confirmationTimer);
  }, [pickConfirmation]);

  useEffect(() => {
    if (!reconnectNotice) {
      return;
    }

    const noticeTimer = setTimeout(() => setReconnectNotice(null), 3200);
    return () => clearTimeout(noticeTimer);
  }, [reconnectNotice]);

  useEffect(() => {
    if (!commissionerNotice) return;
    const noticeTimer = setTimeout(() => setCommissionerNotice(null), 4200);
    return () => clearTimeout(noticeTimer);
  }, [commissionerNotice]);

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
  if (
    !draftStartTimeStr ||
    session?.draft_status === 'LIVE' ||
    session?.draft_status === 'DRAFTING' ||
    session?.draft_status === 'PAUSED'
  ) {
    return;
  }

  let waitingTimer: ReturnType<typeof setInterval> | null = null;

  const calculateWaitingClock = async () => {
    const targetTime = new Date(draftStartTimeStr).getTime();
    const diff = targetTime - Date.now();

    if (diff <= 0) {
      setWaitingRoomCountdown('00:00');

      if (waitingTimer) {
        clearInterval(waitingTimer);
        waitingTimer = null;
      }

      if (session?.draft_status === 'WAITING_ROOM' && leagueId) {
        console.log(
          '🚀 Kickoff time reached! Launching draft via update_league_draft_status...'
        );

        try {
          const { data, error } = await supabase.rpc(
            'update_league_draft_status',
            {
              p_league_id: leagueId,
              p_status: 'LIVE',
            }
          );

          if (error) {
            console.warn(
              'update_league_draft_status RPC Error:',
              error.message
            );

            const fallback = await supabase.rpc(
              'initialize_draft_session',
              {
                p_league_id: leagueId,
              }
            );

            if (fallback.error) {
              console.warn(
                'RPC fallbacks failed. Performing direct table launch...',
                fallback.error.message
              );

              const {
                data: { user },
              } = await supabase.auth.getUser();

              await supabase
                .from('draft_sessions')
                .update({
                  draft_status: 'LIVE',
                  current_pick_index: 1,
                  current_round: 1,
                  current_picker_id: user?.id,
                  pick_deadline: new Date(
                    Date.now() + (turnDurationSeconds || 60) * 1000
                  ).toISOString(),
                })
                .eq('league_id', leagueId);

              await supabase
                .from('leagues')
                .update({
                  draft_status: 'DRAFTING',
                  status: 'DRAFTING',
                })
                .eq('id', leagueId);
            }
          } else {
            console.log(
              'Draft successfully transitioned to LIVE:',
              data
            );
          }
        } catch (err: any) {
          console.error(
            'Failed to execute live draft launch:',
            err.message || err
          );
        }
      }

      return;
    }

    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);

    setWaitingRoomCountdown(
      `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    );
  };

  calculateWaitingClock();
  waitingTimer = setInterval(calculateWaitingClock, 1000);

  return () => {
    if (waitingTimer) {
      clearInterval(waitingTimer);
    }
  };
}, [
  draftStartTimeStr,
  session?.draft_status,
  leagueId,
  turnDurationSeconds,
]);

  useEffect(() => {
    let activeChannel: any = null;
    let isMounted = true;

    const engineStartup = async () => {
      try {
        console.log('============= 🧪 DRAFT DEBUG STARTUP =============');
        const { data: authData } = await supabase.auth.getUser();
        if (!authData?.user) return;
        const currentUid = authData.user.id;
        setMyUserId(currentUid);

        // 1. Resolve Active League ID from AsyncStorage
        let currentLid = await AsyncStorage.getItem('active_league_id');

        if (!currentLid) {
          const { data: member } = await supabase
            .from('league_members')
            .select('league_id')
            .eq('user_id', currentUid)
            .limit(1)
            .maybeSingle();

          if (member?.league_id) {
            const resolvedLeagueId = String(member.league_id);
            currentLid = resolvedLeagueId;
            await AsyncStorage.setItem('active_league_id', resolvedLeagueId);
          }
        }

        if (!currentLid) return;
        setLeagueId(currentLid);

        const { data: leagueData } = await supabase
          .from('leagues')
          .select('commissioner_id')
          .eq('id', currentLid)
          .maybeSingle();

        setIsCommissioner(leagueData?.commissioner_id === currentUid);

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
  .select('user_id, team_name, draft_order')
  .eq('league_id', currentLid)
  .order('draft_order', { ascending: true });

        if (teamsProfiles) setManagersList(teamsProfiles);

        // Register Realtime Listener strictly for active league
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
              const currentSession = sessionRef.current;

              if (
                currentSession?.updated_at &&
                incomingSession.updated_at &&
                new Date(incomingSession.updated_at).getTime() < new Date(currentSession.updated_at).getTime()
              ) {
                console.warn('Ignored stale draft-session update', {
                  incomingUpdatedAt: incomingSession.updated_at,
                  currentUpdatedAt: currentSession.updated_at,
                });
                return;
              }

              sessionRef.current = incomingSession;
              setSession(incomingSession);
              syncPipelineEngine(incomingSession, currentLid, currentUid, teamsProfiles || []);
            }
          )
          .subscribe(async (status) => {
            if (!isMounted) return;

            if (status === 'SUBSCRIBED') {
              const isReconnect = hasConnectedRef.current;
              hasConnectedRef.current = true;
              setConnectionState('CONNECTED');

              if (isReconnect) {
                try {
                  await resyncDraftRoom(currentLid, currentUid, teamsProfiles || []);
                  if (isMounted) setReconnectNotice('Connection restored · draft resynced');
                } catch (error) {
                  console.error('Draft reconnect resync failed:', error);
                  if (isMounted) setConnectionState('RECONNECTING');
                }
              }
            } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
              setConnectionState(hasConnectedRef.current ? 'RECONNECTING' : 'OFFLINE');
            } else if (status === 'CLOSED') {
              setConnectionState('OFFLINE');
            }
            console.log(`🔌 Supabase WebSocket Connection Status: ${status}`);
          });

        let { data: activeSession } = await supabase.from('draft_sessions').select('*').eq('league_id', currentLid).maybeSingle();
        
        if (activeSession) {
          sessionRef.current = activeSession;
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
          sessionRef.current = fallbackSession;
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
      isMounted = false;
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
      const [membersResponse, picksResponse, watchlistResponse, playersResponse, autopickStateResponse] = await Promise.all([
        supabase.from('league_members').select('user_id').eq('league_id', lId),
        supabase.from('draft_picks').select('player_id, user_id, round_number, overall_pick_number, pick_source, pick_reason').eq('league_id', lId).order('overall_pick_number', { ascending: true }),
        supabase.from('watchlists').select('player_id').eq('league_id', lId).eq('user_id', uId).order('priority_order', { ascending: true }),
        supabase.from('players').select('id, web_name, element_type, team_name, total_points, draft_rank'),
        supabase.from('draft_manager_autopick_state').select('league_id, user_id, consecutive_autopicks, is_away').eq('league_id', lId),
      ]);

      const pipelineError =
        membersResponse.error ||
        picksResponse.error ||
        watchlistResponse.error ||
        playersResponse.error ||
        autopickStateResponse.error;

      if (pipelineError) throw pipelineError;

      const membersList = membersResponse.data || [];
      const committedPicks = picksResponse.data || [];
      const watchlistRows = watchlistResponse.data || [];
      const masterPool = playersResponse.data || [];
      const autopickStates = (autopickStateResponse.data || []) as ManagerAutopickState[];

      setWatchlistIds(watchlistRows.map(r => r.player_id));
      setManagerAutopickStates(autopickStates);

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

      if (committedPicks.length === 0 && seenDraftPickNumbersRef.current === null) {
        seenDraftPickNumbersRef.current = new Set();
      }

      // 📢 POPULATE RECENT PICKS TICKER FEED & ANNOUNCEMENT BANNER
      if (committedPicks.length > 0) {
        const activeProfiles = profilesList.length > 0 ? profilesList : managersList;
        const currentPickNumbers = new Set(
          committedPicks.map((pick, index) => pick.overall_pick_number || index + 1)
        );

        if (seenDraftPickNumbersRef.current === null) {
          seenDraftPickNumbersRef.current = currentPickNumbers;
        } else {
          const previouslySeen = seenDraftPickNumbersRef.current;
          const watchedPlayerIds = new Set([
            ...watchlistIdsRef.current,
            ...watchlistRows.map(row => row.player_id),
          ]);
          const newlyDraftedWatchlistPick = [...committedPicks]
            .reverse()
            .find((pick, reverseIndex) => {
              const fallbackPickNumber = committedPicks.length - reverseIndex;
              const pickNumber = pick.overall_pick_number || fallbackPickNumber;
              return (
                !previouslySeen.has(pickNumber) &&
                pick.user_id !== uId &&
                watchedPlayerIds.has(pick.player_id)
              );
            });

          seenDraftPickNumbersRef.current = currentPickNumbers;

          if (newlyDraftedWatchlistPick) {
            const draftedPlayer = parsedPool.find(
              player => player.id === newlyDraftedWatchlistPick.player_id
            );
            const draftingManager = activeProfiles.find(
              manager => manager.user_id === newlyDraftedWatchlistPick.user_id
            );

            if (draftedPlayer) {
              setWatchlistDraftedAlert({
                playerName: draftedPlayer.web_name,
                managerName: draftingManager?.team_name || 'Another manager',
                pickNumber: newlyDraftedWatchlistPick.overall_pick_number || committedPicks.length,
              });
            }
          }
        }
        
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
            pickSource: lastPick.pick_source || 'MANUAL',
            pickReason: lastPick.pick_reason || null,
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
              pickSource: pick.pick_source || 'MANUAL',
              pickReason: pick.pick_reason || null,
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

      return true;

    } catch (err) {
      console.error('Data pipeline loading exception:', err);
      return false;
    }
  };

  const resyncDraftRoom = async (
    targetLeagueId = leagueId,
    targetUserId = myUserId,
    profiles = managersList
  ) => {
    if (!targetLeagueId || !targetUserId || resyncInFlightRef.current) return;

    resyncInFlightRef.current = true;
    try {
      const { data: authoritativeSession, error } = await supabase
        .from('draft_sessions')
        .select('*')
        .eq('league_id', targetLeagueId)
        .maybeSingle();

      if (error) throw error;
      if (!authoritativeSession) throw new Error('Draft session could not be refreshed.');

      const currentSession = sessionRef.current;
      if (
        currentSession &&
        authoritativeSession.current_pick_index < currentSession.current_pick_index
      ) {
        return;
      }

      sessionRef.current = authoritativeSession;
      setSession(authoritativeSession);
      const didSync = await syncPipelineEngine(
        authoritativeSession,
        targetLeagueId,
        targetUserId,
        profiles
      );
      if (!didSync) throw new Error('Draft data could not be refreshed.');
    } finally {
      resyncInFlightRef.current = false;
    }
  };

  const orderedManagers = useMemo(() => {
  return [...managersList].sort((a, b) => {
    const orderA = a.draft_order ?? 999;
    const orderB = b.draft_order ?? 999;

    return orderA - orderB;
  });
}, [managersList]);

const upcomingPickTimeline = useMemo(() => {
  const managerCount = orderedManagers.length;
  const currentPick = session?.current_pick_index || 1;

  if (managerCount === 0) {
    return [];
  }

  return Array.from({ length: Math.min(managerCount + 3, 8) }, (_, index) => {
    const pickNumber = currentPick + index;
    const round = Math.ceil(pickNumber / managerCount);

    let draftSlot = ((pickNumber - 1) % managerCount) + 1;

    if (round % 2 === 0) {
      draftSlot = managerCount - draftSlot + 1;
    }

    const manager = orderedManagers.find(
      item => item.draft_order === draftSlot
    );

    return {
      pickNumber,
      round,
      draftSlot,
      manager,
      isCurrent: index === 0,
    };
  });
}, [
  orderedManagers,
  session?.current_pick_index,
]);

useEffect(() => {
  if (
    !isDraftTrackerExpanded ||
    !session?.current_picker_id ||
    orderedManagers.length === 0
  ) {
    return;
  }

  const activeManagerIndex = orderedManagers.findIndex(
    manager => manager.user_id === session.current_picker_id
  );

  if (activeManagerIndex < 0) {
    return;
  }

  const managerCardWidth = 146;
  const centeredOffset = Math.max(
    0,
    activeManagerIndex * managerCardWidth - width * 0.28
  );

  const scrollTimer = setTimeout(() => {
    draftOrderScrollViewRef.current?.scrollTo({
      x: centeredOffset,
      animated: true,
    });
  }, 120);

  return () => clearTimeout(scrollTimer);
}, [
  session?.current_picker_id,
  orderedManagers,
  width,
  isDraftTrackerExpanded,
]);

  const clubOptions = useMemo(
    () =>
      Array.from(
        new Set(availablePlayers.map(player => player.team_name).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [availablePlayers]
  );

  const memoizedFilteredPlayers = useMemo(() => {
    let sorted = [...availablePlayers];
    sorted.sort((a, b) => sortOrder === 'RANK' ? (a.draft_rank - b.draft_rank) : (b.total_points - a.total_points));
    sorted = sorted.filter(p => !filledPositions[p.element_type]);
    if (activeFilter !== 'ALL') sorted = sorted.filter(p => p.element_type === activeFilter);
    if (activeClub !== 'ALL') sorted = sorted.filter(p => p.team_name === activeClub);

    const normalizedSearch = playerSearch.trim().toLocaleLowerCase();
    if (normalizedSearch) {
      sorted = sorted.filter(p => p.web_name.toLocaleLowerCase().includes(normalizedSearch));
    }

    return sorted;
  }, [sortOrder, availablePlayers, activeFilter, activeClub, playerSearch, filledPositions]);

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
    setPickSubmissionError(null);
    setSelectedPlayer(selectedPlayer?.id === player.id ? null : player);
  };

  const handleMarkPresent = async () => {
    if (!leagueId || !myUserId || markingPresent) return;

    setMarkingPresent(true);
    try {
      const { data, error } = await supabase.rpc('mark_draft_manager_present', {
        p_league_id: leagueId,
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.error || 'Could not leave away mode.');

      setManagerAutopickStates(current => current.map(state =>
        state.user_id === myUserId
          ? { ...state, consecutive_autopicks: 0, is_away: false }
          : state
      ));
      setReconnectNotice("You're back · future turns will use the full clock");
      await resyncDraftRoom(leagueId, myUserId, managersList);
    } catch (error: any) {
      Alert.alert('Could Not Return', error?.message || 'Please try again.');
    } finally {
      setMarkingPresent(false);
    }
  };

  const handleCommissionerControl = async (
    action: 'PAUSE' | 'RESUME' | 'EXTEND' | 'AUTOPICK',
    seconds?: number
  ) => {
    if (!leagueId || !myUserId || !isCommissioner || commissionerAction) return;

    setCommissionerAction(action);
    setCommissionerNotice(null);

    try {
      const { data, error } = await supabase.rpc('commissioner_control_draft', {
        p_league_id: leagueId,
        p_action: action,
        p_seconds: seconds ?? null,
      });

      if (error) throw error;
      if (!data?.success) {
        const messages: Record<string, string> = {
          COMMISSIONER_REQUIRED: 'Only the league commissioner can use these controls.',
          DRAFT_NOT_ACTIVE: 'The draft is not currently active.',
          DRAFT_NOT_PAUSED: 'The draft is no longer paused.',
          INVALID_EXTENSION: 'The timer extension was not accepted.',
          STALE_PICK_NUMBER: 'The turn changed before the auto-pick was processed.',
        };
        throw new Error(messages[data?.error] || data?.error || 'The commissioner action failed.');
      }

      const activeManagerName = managersList.find(
        manager => manager.user_id === sessionRef.current?.current_picker_id
      )?.team_name || 'the current manager';

      const notices: Record<typeof action, string> = {
        PAUSE: `Draft paused · ${data.seconds_remaining ?? 0}s preserved`,
        RESUME: `Draft resumed · ${data.restored_seconds ?? 0}s restored`,
        EXTEND: `Current turn extended by ${data.added_seconds ?? seconds ?? 0}s`,
        AUTOPICK: `Auto-pick completed for ${activeManagerName}`,
      };

      setCommissionerNotice(notices[action]);
      setConfirmCommissionerAutopick(false);
      await resyncDraftRoom(leagueId, myUserId, managersList);
    } catch (error: any) {
      Alert.alert('Commissioner Action Failed', error?.message || 'Please try again.');
    } finally {
      setCommissionerAction(null);
    }
  };

  const getCommissionerError = (code?: string) => ({
    COMMISSIONER_REQUIRED: 'Only the league commissioner can use this control.',
    DRAFT_NOT_ACTIVE: 'The draft is not currently active.',
    PLAYER_ALREADY_TAKEN: 'That player has already been drafted.',
    POSITION_FULL: 'That manager already has the maximum number of players in this position.',
    NO_PICKS_TO_UNDO: 'There are no picks to undo.',
    NO_PICKS_TO_CORRECT: 'There are no picks to correct.',
    PLAYER_UNCHANGED: 'Choose a different player for the correction.',
    OFFICIAL_ACTIVITY_STARTED: 'This action is locked because official season activity has already started.',
    DRAFT_ORDER_LOCKED: 'The draft order is locked after the first pick.',
    INVALID_DRAFT_ORDER: 'The saved order must include every manager exactly once.',
  }[code || ''] || code || 'The commissioner action failed.');

  const runCommissionerRpc = async (
    action: string,
    rpcName: string,
    args: Record<string, unknown>,
    successMessage: string
  ) => {
    if (!leagueId || !myUserId || !isCommissioner || commissionerAction) return false;
    setCommissionerAction(action);
    setCommissionerNotice(null);
    try {
      const { data, error } = await supabase.rpc(rpcName, args);
      if (error) throw error;
      if (!data?.success) throw new Error(getCommissionerError(data?.error));
      setCommissionerNotice(successMessage);
      setCommissionerPlayerMode(null);
      setCommissionerPlayerSearch('');
      await resyncDraftRoom(leagueId, myUserId, managersList);
      return true;
    } catch (error: any) {
      Alert.alert('Commissioner Action Failed', getCommissionerError(error?.message));
      return false;
    } finally {
      setCommissionerAction(null);
    }
  };

  const handleCommissionerPlayer = async (player: DraftedPlayer) => {
    if (!commissionerPlayerMode || !leagueId) return;
    const mode = commissionerPlayerMode;
    await runCommissionerRpc(
      mode,
      mode === 'ASSIGN' ? 'commissioner_assign_current_pick' : 'commissioner_correct_latest_pick',
      { p_league_id: leagueId, p_player_id: player.id },
      mode === 'ASSIGN'
        ? `${player.web_name} assigned to ${activeManagerName}`
        : `Latest pick corrected to ${player.web_name}`
    );
  };

  const confirmCommissionerAction = (title: string, message: string, onConfirm: () => void) => {
    if (Platform.OS === 'web') {
      if ((globalThis as any).confirm(`${title}\n\n${message}`)) onConfirm();
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: onConfirm },
    ]);
  };

  const handleUndoLatestPick = () => confirmCommissionerAction(
    'Undo the latest pick?',
    'The player will return to the pool and that manager will go back on the clock. This is recorded in the audit history.',
    () => void runCommissionerRpc('UNDO', 'commissioner_undo_latest_pick', { p_league_id: leagueId }, 'Latest pick undone · previous manager restored')
  );

  const handleRestartDraft = () => confirmCommissionerAction(
    'Restart the entire draft?',
    'All draft picks and drafted rosters will be cleared. Watchlists and the manager order will be kept. This cannot be used after official season activity starts.',
    () => void runCommissionerRpc('RESTART', 'commissioner_restart_draft', { p_league_id: leagueId }, 'Draft restarted · waiting room restored')
  );

  const moveDraftManager = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draftOrderDraft.length) return;
    setDraftOrderDraft(current => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const saveDraftOrder = async () => {
    if (!leagueId) return;
    const saved = await runCommissionerRpc(
      'REORDER',
      'commissioner_reorder_draft',
      { p_league_id: leagueId, p_user_ids: draftOrderDraft.map(manager => manager.user_id) },
      'Draft order saved'
    );
    if (!saved) return;
    const nextManagers = draftOrderDraft.map((manager, index) => ({ ...manager, draft_order: index + 1 }));
    setManagersList(nextManagers);
    setIsDraftOrderEditorOpen(false);
  };

  const toggleHaptics = async () => {
    const nextValue = !isHapticsEnabled;
    setIsHapticsEnabled(nextValue);

    try {
      await AsyncStorage.setItem(
        'draft_haptics_enabled',
        String(nextValue)
      );
    } catch (error) {
      console.warn('Unable to save draft haptics preference:', error);
    }
  };

  const toggleDraftSound = async () => {
    const nextValue = !isDraftSoundEnabled;
    setIsDraftSoundEnabled(nextValue);

    try {
      await AsyncStorage.setItem('draft_sound_enabled', String(nextValue));
      if (nextValue) {
        await pickConfirmedSound.seekTo(0);
        pickConfirmedSound.play();
      }
    } catch (error) {
      console.warn('Unable to save draft sound preference:', error);
    }
  };

  const handleTurnDeadlineReached = useCallback(() => {
    setSelectedPlayer(null);
  }, []);

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

  // ⚡ FIXED SINGLE-RPC MANUAL PICK SUBMISSION HANDLER
  const submitManualPick = async () => {
    const player = selectedPlayer;
    const currentSession = sessionRef.current || session;

    if (!player || !currentSession || !leagueId || !myUserId || localSyncing) return;

    const turnKey = getDraftTurnKey(currentSession);
    const sessionIsLive =
      currentSession.draft_status === 'LIVE' ||
      currentSession.draft_status === 'DRAFTING';

    if (!turnKey || !sessionIsLive || currentSession.current_picker_id !== myUserId) {
      setSelectedPlayer(null);
      setPickSubmissionError(null);
      return;
    }

    if (submissionInFlightRef.current === turnKey) return;

    submissionInFlightRef.current = turnKey;
    setLocalSyncing(true);
    setPickSubmissionError(null);

    const managerName =
      managersList.find(manager => manager.user_id === myUserId)?.team_name ||
      'My Team';

    try {
      const { data: freshSession, error: sessionError } = await supabase
        .from('draft_sessions')
        .select('*')
        .eq('league_id', leagueId)
        .maybeSingle();

      if (sessionError) throw sessionError;
      if (!freshSession) throw new Error('Draft session could not be verified.');

      const freshTurnKey = getDraftTurnKey(freshSession);
      const freshSessionIsLive =
        freshSession.draft_status === 'LIVE' ||
        freshSession.draft_status === 'DRAFTING';

      if (
        freshTurnKey !== turnKey ||
        !freshSessionIsLive ||
        freshSession.current_picker_id !== myUserId
      ) {
        sessionRef.current = freshSession;
        setSession(freshSession);
        await syncPipelineEngine(freshSession, leagueId, myUserId, managersList);
        setSelectedPlayer(null);
        Alert.alert('Draft Updated', 'That turn has already moved on. The latest draft state is now shown.');
        return;
      }

      const { data: pickResult, error: pickError } = await supabase.rpc('execute_draft_pick', {
        p_league_id: leagueId,
        p_user_id: myUserId,
        p_player_id: player.id,
      });

      if (pickError) throw pickError;

      if (pickResult && !pickResult.success) {
        await resyncDraftRoom(leagueId, myUserId, managersList);

        if (pickResult.error === 'PLAYER_ALREADY_TAKEN') {
          Alert.alert('Selection Sniped!', 'Another manager drafted this player right before you.');
          setSelectedPlayer(null);
        } else if (pickResult.error === 'NOT_YOUR_TURN') {
          Alert.alert('Not Your Turn', 'The draft moved on before this pick reached the server.');
          setSelectedPlayer(null);
        } else {
          setPickSubmissionError('The pick was not accepted. Check the selection and try again.');
        }
        return;
      }

      setPickConfirmation({
        playerName: player.web_name,
        club: player.team_name,
        position: player.element_type,
        managerName,
        round: currentSession.current_round,
        pickNumber: currentSession.current_pick_index,
      });

      if (isHapticsEnabled && Platform.OS !== 'web') {
        Vibration.vibrate([0, 45, 65, 85]);
      }

      void playDraftSound(pickConfirmedSound);

      setSelectedPlayer(null);
      setPickSubmissionError(null);
    } catch (err: any) {
      console.error('MANUAL PICK FAILED', err);

      try {
        const { data: recordedPick } = await supabase
          .from('draft_picks')
          .select('round_number, overall_pick_number')
          .eq('league_id', leagueId)
          .eq('user_id', myUserId)
          .eq('player_id', player.id)
          .maybeSingle();

        await resyncDraftRoom(leagueId, myUserId, managersList);

        if (recordedPick) {
          setPickConfirmation({
            playerName: player.web_name,
            club: player.team_name,
            position: player.element_type,
            managerName,
            round: recordedPick.round_number || currentSession.current_round,
            pickNumber: recordedPick.overall_pick_number || currentSession.current_pick_index,
          });
          void playDraftSound(pickConfirmedSound);
          setSelectedPlayer(null);
          setPickSubmissionError(null);
          return;
        }
      } catch (recoveryError) {
        console.error('Pick recovery check failed:', recoveryError);
      }

      setPickSubmissionError('Connection interrupted. Your pick was not confirmed — try again safely.');
    } finally {
      if (submissionInFlightRef.current === turnKey) {
        submissionInFlightRef.current = null;
      }
      setLocalSyncing(false);
    }
  };

  const activeManagerAway = managerAutopickStates.some(
    state => state.user_id === session?.current_picker_id && state.is_away
  );
  const myAutopickState = managerAutopickStates.find(
    state => state.user_id === myUserId
  );

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color="#00ff87" /></View>;
  }

  const rosterPlayers = Object.values(myRoster).flat().filter(
    (player): player is DraftedPlayer => player !== null
  );
  const rosterTotal = rosterPlayers.length;
  const isDraftCompleted = session?.draft_status === 'COMPLETED';
  const isLive = session?.draft_status === 'LIVE' || session?.draft_status === 'DRAFTING';
  const isPaused = session?.draft_status === 'PAUSED';
  const isDraftActive = isLive || isPaused;
  const isMyTurn = isLive && session?.draft_status !== 'COMPLETED' && session?.current_picker_id === myUserId;
  const activeManagerName = managersList.find(
    manager => manager.user_id === session?.current_picker_id
  )?.team_name || 'Current manager';
  const watchlistPlayers = availablePlayers.filter(p => watchlistIds.includes(p.id)).sort((a,b) => watchlistIds.indexOf(a.id) - watchlistIds.indexOf(b.id));
  const commissionerPlayerOptions = availablePlayers
    .filter(player => player.web_name.toLowerCase().includes(commissionerPlayerSearch.trim().toLowerCase()))
    .sort((a, b) => a.draft_rank - b.draft_rank)
    .slice(0, 80);
  const commissionerPlayerPicker = (
    <Modal
      visible={commissionerPlayerMode !== null}
      transparent
      animationType="fade"
      onRequestClose={() => !commissionerAction && setCommissionerPlayerMode(null)}
    >
      <View style={styles.commissionerConfirmOverlay}>
        <View style={styles.commissionerPlayerPickerCard}>
          <View style={styles.commissionerPlayerPickerHeader}>
            <View style={styles.commissionerPlayerPickerHeaderCopy}>
              <Text style={styles.commissionerConfirmEyebrow}>COMMISSIONER ACTION</Text>
              <Text style={styles.commissionerPlayerPickerTitle}>
                {commissionerPlayerMode === 'ASSIGN' ? 'Assign current pick' : 'Correct latest pick'}
              </Text>
              <Text style={styles.commissionerPlayerPickerSubtitle} numberOfLines={2}>
                {commissionerPlayerMode === 'ASSIGN'
                  ? `Choose an eligible player for ${activeManagerName}. The draft will advance immediately.`
                  : 'Choose the replacement player. The current turn will not change.'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setCommissionerPlayerMode(null)}
              disabled={Boolean(commissionerAction)}
            >
              <Ionicons name="close" size={18} color="#A5B1BA" />
            </TouchableOpacity>
          </View>

          <View style={styles.commissionerPlayerSearchBox}>
            <Ionicons name="search" size={16} color="#657684" />
            <TextInput
              style={styles.commissionerPlayerSearchInput}
              value={commissionerPlayerSearch}
              onChangeText={setCommissionerPlayerSearch}
              placeholder="Search available players"
              placeholderTextColor="#526473"
              autoFocus={Platform.OS === 'web'}
            />
          </View>

          <FlatList
            data={commissionerPlayerOptions}
            keyExtractor={player => `commissioner-player-${player.id}`}
            style={styles.commissionerPlayerList}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.commissionerPlayerRow}
                onPress={() => void handleCommissionerPlayer(item)}
                disabled={Boolean(commissionerAction)}
              >
                <View style={styles.commissionerPlayerRank}><Text style={styles.commissionerPlayerRankText}>#{item.draft_rank}</Text></View>
                <View style={styles.commissionerPlayerCopy}>
                  <Text style={styles.commissionerPlayerName} numberOfLines={1}>{item.web_name}</Text>
                  <Text style={styles.commissionerPlayerClub} numberOfLines={1}>{item.team_name}</Text>
                </View>
                <PositionBadge position={item.element_type} />
                {commissionerAction === commissionerPlayerMode ? (
                  <ActivityIndicator size="small" color="#00F27A" />
                ) : (
                  <Ionicons name="arrow-forward-circle" size={20} color="#00F27A" />
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={(
              <View style={styles.commissionerPlayerEmpty}>
                <Text style={styles.commissionerPlayerEmptyText}>No available players match this search.</Text>
              </View>
            )}
          />
        </View>
      </View>
    </Modal>
  );

  if (isDraftCompleted) {
    const myManager = managersList.find(manager => manager.user_id === myUserId);
    const positionSummary = [
      { position: 'GKP', label: 'Goalkeepers', maximum: 2, color: '#FFD60A' },
      { position: 'DEF', label: 'Defenders', maximum: 5, color: '#0A84FF' },
      { position: 'MID', label: 'Midfielders', maximum: 5, color: '#30D158' },
      { position: 'FWD', label: 'Forwards', maximum: 3, color: '#BF5AF2' },
    ];

    return (
      <SafeAreaView
        style={styles.completionSafeArea}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <ScrollView
          contentContainerStyle={styles.completionScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.completionCard,
              isDesktop && styles.completionCardDesktop,
            ]}
          >
            <View style={styles.completionGlow} />

            <View style={styles.completionHero}>
              <View style={styles.completionIconOuter}>
                <View style={styles.completionIconInner}>
                  <Ionicons name="trophy" size={42} color="#06100B" />
                </View>
                <View style={styles.completionCheckBadge}>
                  <Ionicons name="checkmark" size={15} color="#06100B" />
                </View>
              </View>

              <Text style={styles.completionEyebrow}>DRAFT DAY</Text>
              <Text style={styles.completionTitle}>Draft complete</Text>
              <Text style={styles.completionSubtitle}>
                Your squad is locked in and ready for the season.
              </Text>

              <View style={styles.completionTeamPill}>
                <Ionicons name="shield-checkmark" size={15} color="#00F27A" />
                <Text style={styles.completionTeamName} numberOfLines={1}>
                  {myManager?.team_name || 'My Team'}
                </Text>
              </View>
            </View>

            <View style={styles.completionRosterPanel}>
              <View style={styles.completionRosterHeader}>
                <View>
                  <Text style={styles.completionPanelEyebrow}>FINAL ROSTER</Text>
                  <Text style={styles.completionPanelTitle}>Squad breakdown</Text>
                </View>

                <View style={styles.completionRosterTotal}>
                  <Text style={styles.completionRosterTotalNumber}>{rosterTotal}</Text>
                  <Text style={styles.completionRosterTotalMaximum}> / 15</Text>
                </View>
              </View>

              <View style={styles.completionProgressTrack}>
                <View
                  style={[
                    styles.completionProgressFill,
                    { width: `${Math.min((rosterTotal / 15) * 100, 100)}%` },
                  ]}
                />
              </View>

              <View style={styles.completionPositionGrid}>
                {positionSummary.map(item => {
                  const count = myRoster[item.position].filter(Boolean).length;

                  return (
                    <View key={item.position} style={styles.completionPositionCard}>
                      <View
                        style={[
                          styles.completionPositionIcon,
                          {
                            backgroundColor: `${item.color}1A`,
                            borderColor: `${item.color}55`,
                          },
                        ]}
                      >
                        <Text style={[styles.completionPositionCode, { color: item.color }]}>
                          {item.position}
                        </Text>
                      </View>

                      <View style={styles.completionPositionCopy}>
                        <Text style={styles.completionPositionLabel}>{item.label}</Text>
                        <Text style={styles.completionPositionCount}>
                          {count} of {item.maximum} selected
                        </Text>
                      </View>

                      <Ionicons
                        name={count >= item.maximum ? 'checkmark-circle' : 'ellipse-outline'}
                        size={19}
                        color={count >= item.maximum ? '#00F27A' : '#526474'}
                      />
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={styles.completionActions}>
              <TouchableOpacity
                style={styles.completionPrimaryButton}
                onPress={() => router.dismissTo('/(tabs)/squad')}
                activeOpacity={0.85}
              >
                <Ionicons name="shirt" size={18} color="#06100B" />
                <Text style={styles.completionPrimaryButtonText}>VIEW MY SQUAD</Text>
                <Ionicons name="arrow-forward" size={17} color="#06100B" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.completionSecondaryButton}
                onPress={() => router.push('/draft-results')}
                activeOpacity={0.85}
              >
                <Ionicons name="grid-outline" size={17} color="#C7D1DA" />
                <Text style={styles.completionSecondaryButtonText}>VIEW FULL DRAFT RESULTS</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.completionSecondaryButton}
                onPress={() => router.dismissTo('/(tabs)/league')}
                activeOpacity={0.85}
              >
                <Ionicons name="trophy-outline" size={17} color="#C7D1DA" />
                <Text style={styles.completionSecondaryButtonText}>GO TO LEAGUE HUB</Text>
              </TouchableOpacity>

              {isCommissioner && (
                <View style={styles.completionCommissionerActions}>
                  <Text style={styles.completionCommissionerLabel}>COMMISSIONER RECOVERY</Text>
                  <TouchableOpacity style={styles.completionSecondaryButton} onPress={() => setCommissionerPlayerMode('CORRECT')} disabled={Boolean(commissionerAction)}>
                    <Ionicons name="create-outline" size={17} color="#C7D1DA" />
                    <Text style={styles.completionSecondaryButtonText}>CORRECT LAST PICK</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.completionSecondaryButton, styles.completionDangerButton]} onPress={handleUndoLatestPick} disabled={Boolean(commissionerAction)}>
                    {commissionerAction === 'UNDO' ? <ActivityIndicator size="small" color="#FF8C84" /> : <Ionicons name="arrow-undo" size={17} color="#FF8C84" />}
                    <Text style={styles.completionDangerButtonText}>UNDO LAST PICK</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.completionSecondaryButton, styles.completionDangerButton]} onPress={handleRestartDraft} disabled={Boolean(commissionerAction)} activeOpacity={0.85}>
                    {commissionerAction === 'RESTART' ? <ActivityIndicator size="small" color="#FF8C84" /> : <Ionicons name="refresh" size={17} color="#FF8C84" />}
                    <Text style={styles.completionDangerButtonText}>RESTART DRAFT</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <View style={styles.completionStatusRow}>
              <View style={styles.completionStatusDot} />
              <Text style={styles.completionStatusText}>
                All picks have been saved successfully
              </Text>
            </View>
          </View>
        </ScrollView>
        {commissionerPlayerPicker}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flex: 1 }}>
        {/* 📢 DYNAMIC HEADER STATE ENGINE */}
        {isDraftActive || session?.draft_status === 'COMPLETED' ? (
          <React.Fragment>
            <IsolatedTurnClock 
              deadline={session?.pick_deadline || null}
              status={session?.draft_status || 'LIVE'} 
              pausedSecondsRemaining={session?.paused_seconds_remaining}
              isMyTurn={isMyTurn}
              picksUntilMyTurn={picksUntilMyTurn} 
              currentPickIndex={session?.current_pick_index || 1}
              currentPickerId={session?.current_picker_id || ''} 
              managersList={managersList} 
              connectionState={connectionState}
              activeManagerAway={activeManagerAway}
              onDeadlineReached={handleTurnDeadlineReached}
            />

            {isCommissioner && isDraftActive && (
              <View style={styles.commissionerControlPanel}>
                <TouchableOpacity
                  style={styles.commissionerControlHeader}
                  onPress={() => setIsCommissionerPanelOpen(current => !current)}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle commissioner draft controls"
                >
                  <View style={styles.commissionerControlHeaderIcon}>
                    <Ionicons name="shield-checkmark" size={16} color="#00F27A" />
                  </View>
                  <View style={styles.commissionerControlHeaderCopy}>
                    <Text style={styles.commissionerControlEyebrow}>COMMISSIONER</Text>
                    <Text style={styles.commissionerControlTitle}>Draft controls</Text>
                  </View>
                  <View style={styles.commissionerControlStateBadge}>
                    <Text style={styles.commissionerControlStateText}>
                      {isPaused ? 'PAUSED' : 'LIVE'}
                    </Text>
                  </View>
                  <Ionicons
                    name={isCommissionerPanelOpen ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color="#82929F"
                  />
                </TouchableOpacity>

                {isCommissionerPanelOpen && (
                  <View style={styles.commissionerControlBody}>
                    <Text style={styles.commissionerControlContext} numberOfLines={2}>
                      {activeManagerName} · Round {session?.current_round || 1} · Pick #{session?.current_pick_index || 1}
                    </Text>

                    <View style={styles.commissionerControlActions}>
                      <TouchableOpacity
                        style={[
                          styles.commissionerControlButton,
                          isPaused ? styles.commissionerResumeButton : styles.commissionerPauseButton,
                        ]}
                        onPress={() => handleCommissionerControl(isPaused ? 'RESUME' : 'PAUSE')}
                        disabled={Boolean(commissionerAction)}
                      >
                        {commissionerAction === 'PAUSE' || commissionerAction === 'RESUME' ? (
                          <ActivityIndicator size="small" color={isPaused ? '#00150B' : '#FFB340'} />
                        ) : (
                          <Ionicons
                            name={isPaused ? 'play' : 'pause'}
                            size={15}
                            color={isPaused ? '#00150B' : '#FFB340'}
                          />
                        )}
                        <Text style={[
                          styles.commissionerControlButtonText,
                          isPaused && styles.commissionerResumeButtonText,
                        ]}>
                          {isPaused ? 'RESUME DRAFT' : 'PAUSE DRAFT'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.commissionerControlButton,
                          (isPaused || Boolean(commissionerAction)) && styles.commissionerControlButtonDisabled,
                        ]}
                        onPress={() => handleCommissionerControl('EXTEND', 30)}
                        disabled={isPaused || Boolean(commissionerAction)}
                      >
                        {commissionerAction === 'EXTEND' ? (
                          <ActivityIndicator size="small" color="#C6D0D9" />
                        ) : (
                          <Ionicons name="timer-outline" size={15} color="#C6D0D9" />
                        )}
                        <Text style={styles.commissionerControlButtonText}>+30 SECONDS</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.commissionerControlButton,
                          styles.commissionerAutopickButton,
                          (isPaused || Boolean(commissionerAction)) && styles.commissionerControlButtonDisabled,
                        ]}
                        onPress={() => setConfirmCommissionerAutopick(true)}
                        disabled={isPaused || Boolean(commissionerAction)}
                      >
                        <Ionicons name="flash" size={15} color="#FF7A70" />
                        <Text style={[styles.commissionerControlButtonText, styles.commissionerAutopickButtonText]}>
                          AUTO-PICK NOW
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.commissionerControlButton,
                          (isPaused || Boolean(commissionerAction)) && styles.commissionerControlButtonDisabled,
                        ]}
                        onPress={() => setCommissionerPlayerMode('ASSIGN')}
                        disabled={isPaused || Boolean(commissionerAction)}
                      >
                        <Ionicons name="person-add-outline" size={15} color="#C6D0D9" />
                        <Text style={styles.commissionerControlButtonText}>ASSIGN PLAYER</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.commissionerControlButton,
                          Boolean(commissionerAction) && styles.commissionerControlButtonDisabled,
                        ]}
                        onPress={() => setCommissionerPlayerMode('CORRECT')}
                        disabled={Boolean(commissionerAction) || recentPicksFeed.length === 0}
                      >
                        <Ionicons name="create-outline" size={15} color="#C6D0D9" />
                        <Text style={styles.commissionerControlButtonText}>CORRECT LAST PICK</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.commissionerControlButton,
                          styles.commissionerDangerButton,
                          (Boolean(commissionerAction) || recentPicksFeed.length === 0) && styles.commissionerControlButtonDisabled,
                        ]}
                        onPress={handleUndoLatestPick}
                        disabled={Boolean(commissionerAction) || recentPicksFeed.length === 0}
                      >
                        {commissionerAction === 'UNDO' ? (
                          <ActivityIndicator size="small" color="#FF8C84" />
                        ) : (
                          <Ionicons name="arrow-undo" size={15} color="#FF8C84" />
                        )}
                        <Text style={styles.commissionerDangerButtonText}>UNDO LAST PICK</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.commissionerControlButton,
                          styles.commissionerDangerButton,
                          Boolean(commissionerAction) && styles.commissionerControlButtonDisabled,
                        ]}
                        onPress={handleRestartDraft}
                        disabled={Boolean(commissionerAction)}
                      >
                        {commissionerAction === 'RESTART' ? (
                          <ActivityIndicator size="small" color="#FF8C84" />
                        ) : (
                          <Ionicons name="refresh" size={15} color="#FF8C84" />
                        )}
                        <Text style={styles.commissionerDangerButtonText}>RESTART DRAFT</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            )}

            {commissionerNotice && (
              <View style={styles.commissionerNoticeBanner}>
                <Ionicons name="checkmark-circle" size={14} color="#00F27A" />
                <Text style={styles.commissionerNoticeText}>{commissionerNotice}</Text>
              </View>
            )}

            {(connectionState === 'RECONNECTING' || connectionState === 'OFFLINE') && (
              <View style={styles.reconnectBanner}>
                <Ionicons
                  name={connectionState === 'OFFLINE' ? 'cloud-offline-outline' : 'sync-outline'}
                  size={15}
                  color="#FFB340"
                />
                <View style={styles.reconnectBannerCopy}>
                  <Text style={styles.reconnectBannerTitle}>
                    {connectionState === 'OFFLINE' ? 'CONNECTION LOST' : 'RECONNECTING'}
                  </Text>
                  <Text style={styles.reconnectBannerText}>
                    Picks remain server-protected. The room will resync automatically.
                  </Text>
                </View>
              </View>
            )}

            {reconnectNotice && (
              <View style={styles.resyncSuccessBanner}>
                <Ionicons name="checkmark-circle" size={14} color="#00F27A" />
                <Text style={styles.resyncSuccessBannerText}>{reconnectNotice}</Text>
              </View>
            )}

            {myAutopickState?.is_away && (
              <View style={styles.awayModeBanner}>
                <Ionicons name="moon-outline" size={17} color="#FFB340" />
                <View style={styles.awayModeBannerCopy}>
                  <Text style={styles.awayModeBannerTitle}>YOU'RE IN AWAY MODE</Text>
                  <Text style={styles.awayModeBannerText}>
                    Future turns will autopick instantly after {myAutopickState.consecutive_autopicks} consecutive misses.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.markPresentButton}
                  onPress={handleMarkPresent}
                  disabled={markingPresent}
                >
                  {markingPresent ? (
                    <ActivityIndicator size="small" color="#00150B" />
                  ) : (
                    <Text style={styles.markPresentButtonText}>I'M BACK</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Single Latest Pick Announcement Banner */}
            {isLive && latestPickAlert && (
              <View style={styles.latestPickBanner}>
                <Ionicons name="flash" size={14} color="#00ff87" />
                {latestPickAlert.pickSource !== 'MANUAL' && (
                  <View style={styles.autopickReasonBadge}>
                    <Text style={styles.autopickReasonBadgeText}>
                      AUTO · {latestPickAlert.pickSource === 'AUTO_WATCHLIST' ? 'WATCHLIST' : 'BEST AVAILABLE'} · {getAutopickReasonLabel(latestPickAlert.pickReason)}
                    </Text>
                  </View>
                )}
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

            {isLive && watchlistDraftedAlert && (
              <View style={styles.watchlistDraftedBanner}>
                <View style={styles.watchlistDraftedIcon}>
                  <Ionicons name="star" size={15} color="#FFB340" />
                </View>
                <View style={styles.watchlistDraftedCopy}>
                  <Text style={styles.watchlistDraftedTitle}>WATCHLIST PLAYER DRAFTED</Text>
                  <Text style={styles.watchlistDraftedText} numberOfLines={2}>
                    {watchlistDraftedAlert.managerName} selected {watchlistDraftedAlert.playerName} at pick #{watchlistDraftedAlert.pickNumber}.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.watchlistDraftedDismiss}
                  onPress={() => setWatchlistDraftedAlert(null)}
                  accessibilityLabel="Dismiss watchlist alert"
                >
                  <Ionicons name="close" size={15} color="#8D7957" />
                </TouchableOpacity>
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

        {isCommissioner && !isDraftActive && session?.draft_status !== 'COMPLETED' && (
          <View style={styles.preDraftCommissionerPanel}>
            <TouchableOpacity
              style={styles.preDraftCommissionerHeader}
              onPress={() => setIsDraftOrderEditorOpen(current => !current)}
            >
              <View style={styles.commissionerControlHeaderIcon}>
                <Ionicons name="swap-vertical" size={16} color="#00F27A" />
              </View>
              <View style={styles.commissionerControlHeaderCopy}>
                <Text style={styles.commissionerControlEyebrow}>COMMISSIONER</Text>
                <Text style={styles.commissionerControlTitle}>Set manager draft order</Text>
              </View>
              <Ionicons name={isDraftOrderEditorOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#82929F" />
            </TouchableOpacity>
            {isDraftOrderEditorOpen && (
              <View style={styles.draftOrderEditorBody}>
                <Text style={styles.commissionerControlContext}>Set the first-round order. Even rounds automatically reverse.</Text>
                {draftOrderDraft.map((manager, index) => (
                  <View key={`order-editor-${manager.user_id}`} style={styles.draftOrderEditorRow}>
                    <View style={styles.draftOrderEditorNumber}><Text style={styles.draftOrderEditorNumberText}>{index + 1}</Text></View>
                    <Text style={styles.draftOrderEditorName} numberOfLines={1}>{manager.team_name}</Text>
                    <TouchableOpacity style={styles.draftOrderMoveButton} onPress={() => moveDraftManager(index, -1)} disabled={index === 0}>
                      <Ionicons name="chevron-up" size={16} color={index === 0 ? '#3F505D' : '#A8B4BC'} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.draftOrderMoveButton} onPress={() => moveDraftManager(index, 1)} disabled={index === draftOrderDraft.length - 1}>
                      <Ionicons name="chevron-down" size={16} color={index === draftOrderDraft.length - 1 ? '#3F505D' : '#A8B4BC'} />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity style={styles.saveDraftOrderButton} onPress={() => void saveDraftOrder()} disabled={Boolean(commissionerAction)}>
                  {commissionerAction === 'REORDER' ? <ActivityIndicator size="small" color="#00150B" /> : <Ionicons name="save-outline" size={15} color="#00150B" />}
                  <Text style={styles.saveDraftOrderButtonText}>SAVE DRAFT ORDER</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <>
          {orderedManagers.length > 0 &&
            session?.draft_status !== 'COMPLETED' && (
            <View style={styles.draftOrderPanel}>
              <TouchableOpacity
                style={styles.draftOrderHeader}
                onPress={() =>
                  setIsDraftTrackerExpanded(current => !current)
                }
                activeOpacity={0.8}
              >
                <View style={styles.draftTrackerHeaderLeft}>
                  <View>
                    <Text style={styles.draftOrderEyebrow}>
                      DRAFT TRACKER
                    </Text>

                    <Text style={styles.draftOrderRound}>
                      Round {session?.current_round || 1}
                      {' · '}
                      Pick {session?.current_pick_index || 1}
                    </Text>
                  </View>

                  {!isDraftTrackerExpanded && (
                    <Text
                      style={styles.collapsedTrackerManager}
                      numberOfLines={1}
                    >
                      {orderedManagers.find(
                        manager =>
                          manager.user_id === session?.current_picker_id
                      )?.team_name || 'Manager'}{' '}
                      is on the clock
                    </Text>
                  )}
                </View>

                <View style={styles.draftTrackerHeaderActions}>
                  <View style={styles.snakeDirectionBadge}>
                    <Ionicons
                      name={
                        (session?.current_round || 1) % 2 === 0
                          ? 'arrow-back'
                          : 'arrow-forward'
                      }
                      size={13}
                      color="#00F27A"
                    />

                    <Text style={styles.snakeDirectionText}>
                      {(session?.current_round || 1) % 2 === 0
                        ? `${orderedManagers.length} → 1`
                        : `1 → ${orderedManagers.length}`}
                    </Text>
                  </View>

                  <View style={styles.collapseTrackerButton}>
                    <Ionicons
                      name={
                        isDraftTrackerExpanded
                          ? 'chevron-up'
                          : 'chevron-down'
                      }
                      size={15}
                      color="#8B9AA8"
                    />
                  </View>
                </View>
              </TouchableOpacity>

              <View style={styles.draftFeedbackPreferences}>
                {Platform.OS !== 'web' && (
                  <TouchableOpacity
                    style={styles.hapticsPreferenceButton}
                    onPress={toggleHaptics}
                    activeOpacity={0.8}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: isHapticsEnabled }}
                    accessibilityLabel="Turn vibration alerts"
                  >
                    <Ionicons
                      name={isHapticsEnabled ? 'phone-portrait' : 'phone-portrait-outline'}
                      size={13}
                      color={isHapticsEnabled ? '#00F27A' : '#687887'}
                    />
                    <Text
                      style={[
                        styles.hapticsPreferenceText,
                        isHapticsEnabled && styles.hapticsPreferenceTextActive,
                      ]}
                    >
                      VIBRATION {isHapticsEnabled ? 'ON' : 'OFF'}
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.hapticsPreferenceButton}
                  onPress={toggleDraftSound}
                  activeOpacity={0.8}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: isDraftSoundEnabled }}
                  accessibilityLabel="Turn draft sounds on or off"
                >
                  <Ionicons
                    name={isDraftSoundEnabled ? 'volume-high' : 'volume-mute-outline'}
                    size={13}
                    color={isDraftSoundEnabled ? '#00F27A' : '#687887'}
                  />
                  <Text
                    style={[
                      styles.hapticsPreferenceText,
                      isDraftSoundEnabled && styles.hapticsPreferenceTextActive,
                    ]}
                  >
                    SOUND {isDraftSoundEnabled ? 'ON' : 'OFF'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.hapticsPreferenceButton}
                  onPress={() => router.push('/draft-results')}
                  activeOpacity={0.8}
                  accessibilityLabel="Open full draft board"
                >
                  <Ionicons name="grid-outline" size={13} color="#00F27A" />
                  <Text style={[styles.hapticsPreferenceText, styles.hapticsPreferenceTextActive]}>
                    FULL BOARD
                  </Text>
                </TouchableOpacity>
              </View>

              {isDraftTrackerExpanded && (
                <>
                  <ScrollView
                    ref={draftOrderScrollViewRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.draftOrderList}
                  >
                    {orderedManagers.map((manager) => {
                      const isCurrentPicker =
                        manager.user_id === session?.current_picker_id;

                      const isPickerChangeHighlighted =
                        manager.user_id === highlightedPickerId;

                      const isMe = manager.user_id === myUserId;
                      const isManagerAway = managerAutopickStates.some(
                        state => state.user_id === manager.user_id && state.is_away
                      );

                      return (
                        <View
                          key={manager.user_id}
                          style={[
                            styles.draftOrderManagerCard,
                            isCurrentPicker &&
                              styles.draftOrderManagerCardActive,
                            isPickerChangeHighlighted &&
                              styles.draftOrderManagerCardChanged,
                          ]}
                        >
                          <View
                            style={[
                              styles.draftOrderNumber,
                              isCurrentPicker &&
                                styles.draftOrderNumberActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.draftOrderNumberText,
                                isCurrentPicker &&
                                  styles.draftOrderNumberTextActive,
                              ]}
                            >
                              {manager.draft_order ?? '–'}
                            </Text>
                          </View>

                          <View style={styles.draftOrderManagerInfo}>
                            <Text
                              style={[
                                styles.draftOrderManagerName,
                                isCurrentPicker &&
                                  styles.draftOrderManagerNameActive,
                              ]}
                              numberOfLines={1}
                            >
                              {manager.team_name}
                            </Text>

                            <Text style={styles.draftOrderManagerMeta}>
                              {isManagerAway
                                ? 'AWAY · AUTO PICKS'
                                : isCurrentPicker
                                  ? 'ON THE CLOCK'
                                : isMe
                                  ? 'YOUR TEAM'
                                  : `SLOT ${manager.draft_order ?? '–'}`}
                            </Text>
                          </View>

                          {isCurrentPicker && (
                            <View style={styles.livePickDot} />
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>

                  <View style={styles.pickTimelineDivider} />

                  <View style={styles.pickTimelineHeader}>
                    <Text style={styles.pickTimelineTitle}>
                      UPCOMING PICKS
                    </Text>

                    <Text style={styles.pickTimelineHint}>
                      Snake sequence
                    </Text>
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.pickTimelineList}
                  >
                    {upcomingPickTimeline.map((pick) => {
                      const isMe =
                        pick.manager?.user_id === myUserId;

                      return (
                        <View
                          key={`timeline-pick-${pick.pickNumber}`}
                          style={[
                            styles.pickTimelineCard,
                            pick.isCurrent &&
                              styles.pickTimelineCardCurrent,
                          ]}
                        >
                          <View style={styles.pickTimelineTopRow}>
                            <Text
                              style={[
                                styles.pickTimelineNumber,
                                pick.isCurrent &&
                                  styles.pickTimelineNumberCurrent,
                              ]}
                            >
                              PICK {pick.pickNumber}
                            </Text>

                            <Text style={styles.pickTimelineRound}>
                              R{pick.round}
                            </Text>
                          </View>

                          <Text
                            style={[
                              styles.pickTimelineManager,
                              pick.isCurrent &&
                                styles.pickTimelineManagerCurrent,
                            ]}
                            numberOfLines={1}
                          >
                            {pick.manager?.team_name || 'Unknown manager'}
                          </Text>

                          <Text style={styles.pickTimelineMeta}>
                            {pick.isCurrent
                              ? 'ON THE CLOCK'
                              : isMe
                                ? 'YOUR PICK'
                                : `SLOT ${pick.draftSlot}`}
                          </Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                </>
              )}
            </View>
            )}

<View
  style={[
    styles.draftWorkspace,
    isDesktop && styles.draftWorkspaceDesktop,
  ]}
>
  <View style={styles.primaryWorkspace}>

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
              ListEmptyComponent={<Text style={styles.emptyNoticeText}>No eligible players match the current filters.</Text>}
              ListHeaderComponent={
                <View style={styles.poolFiltersContainer}>
                  <View style={styles.playerSearchBox}>
                    <Ionicons name="search" size={16} color="#607180" />
                    <TextInput
                      style={styles.playerSearchInput}
                      value={playerSearch}
                      onChangeText={setPlayerSearch}
                      placeholder="Search players by name"
                      placeholderTextColor="#607180"
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                    />
                    {playerSearch.length > 0 && (
                      <TouchableOpacity
                        style={styles.clearSearchButton}
                        onPress={() => setPlayerSearch('')}
                        accessibilityLabel="Clear player search"
                      >
                        <Ionicons name="close-circle" size={17} color="#607180" />
                      </TouchableOpacity>
                    )}
                  </View>

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

                  <View style={styles.clubFilterRow}>
                    <Text style={styles.clubFilterLabel}>CLUB</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.clubFilterList}
                    >
                      {['ALL', ...clubOptions].map(club => (
                        <TouchableOpacity
                          key={club}
                          style={[styles.clubFilterChip, activeClub === club && styles.clubFilterChipActive]}
                          onPress={() => setActiveClub(club)}
                        >
                          <Text style={[styles.clubFilterChipText, activeClub === club && styles.clubFilterChipTextActive]}>
                            {club}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
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
        </View>

        {isDesktop && (
  <View style={styles.desktopSquadSidebar}>
    <ScrollView
      style={styles.desktopSidebarScroll}
      contentContainerStyle={styles.desktopSidebarContent}
      showsVerticalScrollIndicator={false}
    >
    <View style={styles.sidebarHeader}>
      <View>
        <Text style={styles.sidebarEyebrow}>
          LIVE ROSTER
        </Text>

        <Text style={styles.sidebarTitle}>
          My Squad
        </Text>
      </View>

      <View style={styles.sidebarTotalBadge}>
        <Text style={styles.sidebarTotalNumber}>
          {Object.values(myRoster)
            .flat()
            .filter(Boolean).length}
        </Text>

        <Text style={styles.sidebarTotalLabel}>
          / 15
        </Text>
      </View>
    </View>

    <View style={styles.sidebarProgressTrack}>
      <View
        style={[
          styles.sidebarProgressFill,
          {
            width: `${
              (Object.values(myRoster)
                .flat()
                .filter(Boolean).length /
                15) *
              100
            }%`,
          },
        ]}
      />
    </View>

    <View style={styles.sidebarPositionGrid}>
      {[
        {
          position: 'GKP',
          label: 'Goalkeepers',
          count: myRoster.GKP.filter(Boolean).length,
          maximum: 2,
          color: '#FFD60A',
        },
        {
          position: 'DEF',
          label: 'Defenders',
          count: myRoster.DEF.filter(Boolean).length,
          maximum: 5,
          color: '#0A84FF',
        },
        {
          position: 'MID',
          label: 'Midfielders',
          count: myRoster.MID.filter(Boolean).length,
          maximum: 5,
          color: '#30D158',
        },
        {
          position: 'FWD',
          label: 'Forwards',
          count: myRoster.FWD.filter(Boolean).length,
          maximum: 3,
          color: '#BF5AF2',
        },
      ].map((item) => {
        const isFull = item.count >= item.maximum;

        return (
          <View
            key={item.position}
            style={[
              styles.sidebarPositionCard,
              isFull && styles.sidebarPositionCardFull,
            ]}
          >
            <View
              style={[
                styles.sidebarPositionIcon,
                {
                  backgroundColor: `${item.color}22`,
                  borderColor: `${item.color}66`,
                },
              ]}
            >
              <Text
                style={[
                  styles.sidebarPositionCode,
                  { color: item.color },
                ]}
              >
                {item.position}
              </Text>
            </View>

            <View style={styles.sidebarPositionInfo}>
              <Text style={styles.sidebarPositionLabel}>
                {item.label}
              </Text>

              <Text style={styles.sidebarPositionCount}>
                {item.count} of {item.maximum}
              </Text>
            </View>

            {isFull && (
              <Ionicons
                name="checkmark-circle"
                size={17}
                color="#00F27A"
              />
            )}
          </View>
        );
      })}
    </View>

    <View style={styles.sidebarDivider} />

    <View style={styles.sidebarTurnCard}>
      <View style={styles.sidebarTurnIcon}>
        <Ionicons
          name={isMyTurn ? 'flash' : 'hourglass-outline'}
          size={18}
          color={isMyTurn ? '#00F27A' : '#8B9AA8'}
        />
      </View>

      <View style={styles.sidebarTurnInfo}>
        <Text
          style={[
            styles.sidebarTurnTitle,
            isMyTurn && styles.sidebarTurnTitleActive,
          ]}
        >
          {session?.draft_status === 'COMPLETED'
            ? 'Draft complete'
            : isMyTurn
              ? 'You are on the clock'
              : `${picksUntilMyTurn} picks until your turn`}
        </Text>

        <Text style={styles.sidebarTurnMeta}>
          Pick {session?.current_pick_index || 1}
          {' · '}
          Round {session?.current_round || 1}
        </Text>
      </View>
    </View>

<TouchableOpacity
  style={[
    styles.sidebarSquadButton,
    activeTab === 'SQUAD' &&
      styles.sidebarSquadButtonPlayerList,
  ]}
  onPress={() =>
    setActiveTab(activeTab === 'SQUAD' ? 'POOL' : 'SQUAD')
  }
>
  <Ionicons
    name={
      activeTab === 'SQUAD'
        ? 'list-outline'
        : 'shirt-outline'
    }
    size={16}
    color="#00F27A"
  />

  <Text style={styles.sidebarSquadButtonText}>
    {activeTab === 'SQUAD'
      ? 'VIEW PLAYER LIST'
      : 'VIEW FULL SQUAD'}
  </Text>
</TouchableOpacity>
    </ScrollView>
  </View>
)}
          </View>
        </>

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
                  {item.pickSource !== 'MANUAL' && (
                    <Text style={styles.tickerAutopickLabel}>AUTO</Text>
                  )}
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

      {isMyTurn && selectedPlayer && (activeTab === 'POOL' || activeTab === 'WATCHLIST') && (
        <PickReviewPanel
          player={selectedPlayer}
          deadline={session?.pick_deadline || ''}
          currentPositionCount={(myRoster[selectedPlayer.element_type] || []).filter(Boolean).length}
          positionLimit={(myRoster[selectedPlayer.element_type] || []).length}
          syncing={localSyncing}
          isCentered={width >= 768}
          submissionError={pickSubmissionError}
          onCancel={() => {
            setSelectedPlayer(null);
            setPickSubmissionError(null);
          }}
          onConfirm={submitManualPick}
        />
      )}

      {pickConfirmation && (
        <PickConfirmationOverlay
          confirmation={pickConfirmation}
          onClose={() => setPickConfirmation(null)}
        />
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

      <Modal
        visible={confirmCommissionerAutopick}
        transparent
        animationType="fade"
        onRequestClose={() => !commissionerAction && setConfirmCommissionerAutopick(false)}
      >
        <View style={styles.commissionerConfirmOverlay}>
          <View style={styles.commissionerConfirmCard}>
            <View style={styles.commissionerConfirmIcon}>
              <Ionicons name="flash" size={22} color="#FF7A70" />
            </View>
            <Text style={styles.commissionerConfirmEyebrow}>COMMISSIONER ACTION</Text>
            <Text style={styles.commissionerConfirmTitle}>Auto-pick now?</Text>
            <Text style={styles.commissionerConfirmText}>
              This will immediately select the best eligible player for {activeManagerName}, using their watchlist first and the ranked player pool second.
            </Text>
            <View style={styles.commissionerConfirmContext}>
              <Text style={styles.commissionerConfirmContextLabel}>CURRENT TURN</Text>
              <Text style={styles.commissionerConfirmContextValue} numberOfLines={1}>
                {activeManagerName} · Pick #{session?.current_pick_index || 1}
              </Text>
            </View>
            <View style={styles.commissionerConfirmActions}>
              <TouchableOpacity
                style={styles.commissionerConfirmCancel}
                onPress={() => setConfirmCommissionerAutopick(false)}
                disabled={Boolean(commissionerAction)}
              >
                <Text style={styles.commissionerConfirmCancelText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.commissionerConfirmSubmit}
                onPress={() => handleCommissionerControl('AUTOPICK')}
                disabled={Boolean(commissionerAction)}
              >
                {commissionerAction === 'AUTOPICK' ? (
                  <ActivityIndicator size="small" color="#2A0705" />
                ) : (
                  <Ionicons name="flash" size={15} color="#2A0705" />
                )}
                <Text style={styles.commissionerConfirmSubmitText}>AUTO-PICK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {commissionerPlayerPicker}

      <PlayerCardModal
        visible={inspectingPlayer !== null}
        playerId={inspectingPlayer?.id ?? null}
        leagueId={leagueId}
        statsMode="LAST_SEASON"
        onClose={() => setInspectingPlayer(null)}
      />

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
completionSafeArea: {
  flex: 1,
  backgroundColor: '#050A0F',
},

completionScrollContent: {
  flexGrow: 1,
  justifyContent: 'center',
  alignItems: 'center',
  paddingVertical: 28,
  paddingHorizontal: 16,
},

completionCard: {
  width: '100%',
  maxWidth: 680,
  position: 'relative',
  overflow: 'hidden',
  backgroundColor: '#08111A',
  borderWidth: 1,
  borderColor: '#1E3340',
  borderRadius: 24,
  padding: 18,
  shadowColor: '#000',
  shadowOpacity: 0.42,
  shadowRadius: 28,
  shadowOffset: { width: 0, height: 14 },
  elevation: 16,
},

completionCardDesktop: {
  padding: 28,
},

completionGlow: {
  position: 'absolute',
  top: -150,
  alignSelf: 'center',
  width: 360,
  height: 260,
  borderRadius: 180,
  backgroundColor: 'rgba(0,242,122,0.10)',
},

completionHero: {
  alignItems: 'center',
  paddingTop: 8,
  paddingBottom: 24,
},

completionIconOuter: {
  width: 94,
  height: 94,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0,242,122,0.10)',
  borderWidth: 1,
  borderColor: 'rgba(0,242,122,0.25)',
  borderRadius: 47,
  marginBottom: 20,
},

completionIconInner: {
  width: 70,
  height: 70,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#00F27A',
  borderRadius: 35,
  shadowColor: '#00F27A',
  shadowOpacity: 0.35,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 0 },
  elevation: 8,
},

completionCheckBadge: {
  position: 'absolute',
  right: 5,
  bottom: 5,
  width: 27,
  height: 27,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#F7FAFC',
  borderWidth: 3,
  borderColor: '#08111A',
  borderRadius: 14,
},

completionEyebrow: {
  color: '#00F27A',
  fontSize: 9,
  fontWeight: '900',
  letterSpacing: 2.2,
},

completionTitle: {
  color: '#F7FAFC',
  fontSize: 34,
  fontWeight: '900',
  letterSpacing: -0.9,
  marginTop: 7,
  textAlign: 'center',
},

completionSubtitle: {
  maxWidth: 390,
  color: '#8B9AA8',
  fontSize: 13,
  fontWeight: '600',
  lineHeight: 20,
  marginTop: 8,
  textAlign: 'center',
},

completionTeamPill: {
  maxWidth: '90%',
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: '#0D1E18',
  borderWidth: 1,
  borderColor: 'rgba(0,242,122,0.25)',
  borderRadius: 999,
  paddingVertical: 8,
  paddingHorizontal: 13,
  gap: 7,
  marginTop: 17,
},

completionTeamName: {
  flexShrink: 1,
  color: '#DDFBEA',
  fontSize: 11,
  fontWeight: '900',
},

completionRosterPanel: {
  backgroundColor: '#0B151E',
  borderWidth: 1,
  borderColor: '#1B2A36',
  borderRadius: 16,
  padding: 15,
},

completionRosterHeader: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
},

completionPanelEyebrow: {
  color: '#607180',
  fontSize: 8,
  fontWeight: '900',
  letterSpacing: 1,
},

completionPanelTitle: {
  color: '#F7FAFC',
  fontSize: 16,
  fontWeight: '900',
  marginTop: 3,
},

completionRosterTotal: {
  flexDirection: 'row',
  alignItems: 'baseline',
},

completionRosterTotalNumber: {
  color: '#00F27A',
  fontSize: 24,
  fontWeight: '900',
},

completionRosterTotalMaximum: {
  color: '#607180',
  fontSize: 12,
  fontWeight: '800',
},

completionProgressTrack: {
  height: 5,
  overflow: 'hidden',
  backgroundColor: '#14232E',
  borderRadius: 999,
  marginTop: 13,
  marginBottom: 14,
},

completionProgressFill: {
  height: '100%',
  backgroundColor: '#00F27A',
  borderRadius: 999,
},

completionPositionGrid: {
  gap: 8,
},

completionPositionCard: {
  minHeight: 56,
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: '#08111A',
  borderWidth: 1,
  borderColor: '#182833',
  borderRadius: 11,
  paddingHorizontal: 10,
},

completionPositionIcon: {
  width: 42,
  height: 34,
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1,
  borderRadius: 8,
},

completionPositionCode: {
  fontSize: 9,
  fontWeight: '900',
},

completionPositionCopy: {
  flex: 1,
  marginLeft: 10,
},

completionPositionLabel: {
  color: '#E8EDF2',
  fontSize: 11,
  fontWeight: '800',
},

completionPositionCount: {
  color: '#607180',
  fontSize: 9,
  fontWeight: '700',
  marginTop: 2,
},

completionActions: {
  gap: 9,
  marginTop: 16,
},

completionPrimaryButton: {
  minHeight: 50,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#00F27A',
  borderRadius: 12,
  paddingHorizontal: 16,
  gap: 9,
},

completionPrimaryButtonText: {
  flex: 1,
  color: '#06100B',
  fontSize: 11,
  fontWeight: '900',
  letterSpacing: 0.5,
  textAlign: 'center',
},

completionSecondaryButton: {
  minHeight: 46,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#0B151E',
  borderWidth: 1,
  borderColor: '#253744',
  borderRadius: 12,
  paddingHorizontal: 16,
  gap: 8,
},

completionSecondaryButtonText: {
  color: '#C7D1DA',
  fontSize: 10,
  fontWeight: '900',
  letterSpacing: 0.45,
},

completionStatusRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  marginTop: 15,
},

completionStatusDot: {
  width: 6,
  height: 6,
  backgroundColor: '#00F27A',
  borderRadius: 3,
},

completionStatusText: {
  color: '#607180',
  fontSize: 9,
  fontWeight: '700',
},

container: {
  flex: 1,
  backgroundColor: '#050A0F',
},

centered: {
  flex: 1,
  justifyContent: 'center',
  alignItems: 'center',
  backgroundColor: '#050A0F',
},

turnHeader: {
  minHeight: 82,
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginHorizontal: 12,
  marginTop: 10,
  marginBottom: 8,
  paddingVertical: 14,
  paddingHorizontal: 16,
  borderWidth: 1,
  borderRadius: 14,
  overflow: 'hidden',
},

myTurnBg: {
  backgroundColor: '#0C251A',
  borderColor: '#00F27A',
  shadowColor: '#00F27A',
  shadowOpacity: 0.2,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 0 },
  elevation: 6,
},

rivalTurnBg: {
  backgroundColor: '#0C141D',
  borderColor: '#243441',
},

warningAmberBg: {
  backgroundColor: '#2A1D08',
  borderColor: '#FF9F0A',
},

criticalRedBg: {
  backgroundColor: '#2B1111',
  borderColor: '#FF453A',
},

completedBg: {
  backgroundColor: '#101922',
  borderColor: '#365063',
  justifyContent: 'center',
},

turnLabel: {
  color: '#F7FAFC',
  fontSize: 15,
  fontWeight: '900',
  letterSpacing: 0.6,
},

turnMetaSub: {
  color: '#8B9AA8',
  fontSize: 11,
  fontWeight: '700',
  marginTop: 5,
},

turnStatusRail: {
  alignItems: 'flex-end',
  gap: 5,
},

connectionStatusPill: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: 6,
},

connectionStatusDot: {
  width: 6,
  height: 6,
  borderRadius: 3,
  marginRight: 5,
},

connectionStatusDotConnected: { backgroundColor: '#00F27A' },
connectionStatusDotConnecting: { backgroundColor: '#FFB340' },
connectionStatusDotOffline: { backgroundColor: '#FF6B61' },
connectionStatusPillText: { color: '#71818E', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },

clockContainer: {
  minWidth: 76,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.38)',
  paddingVertical: 10,
  paddingHorizontal: 12,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
},

clockText: {
  fontSize: 19,
  fontWeight: '900',
  marginLeft: 7,
  fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
},

latestPickBanner: {
  flexDirection: 'row',
  alignItems: 'center',
  marginHorizontal: 12,
  marginBottom: 8,
  backgroundColor: '#0B1712',
  paddingVertical: 9,
  paddingHorizontal: 12,
  borderWidth: 1,
  borderColor: 'rgba(0,242,122,0.20)',
  borderRadius: 10,
  gap: 8,
},

latestPickText: {
  color: '#8B9AA8',
  fontSize: 11,
  fontWeight: '700',
  flex: 1,
},
autopickReasonBadge: {
  paddingVertical: 3,
  paddingHorizontal: 6,
  backgroundColor: '#251B0D',
  borderWidth: 1,
  borderColor: '#624719',
  borderRadius: 5,
},
autopickReasonBadgeText: { color: '#FFB340', fontSize: 7, fontWeight: '900', letterSpacing: 0.25 },
watchlistDraftedBanner: {
  flexDirection: 'row',
  alignItems: 'center',
  marginHorizontal: 12,
  marginBottom: 8,
  paddingVertical: 9,
  paddingHorizontal: 10,
  backgroundColor: '#251B0D',
  borderWidth: 1,
  borderColor: '#72511A',
  borderRadius: 10,
},
watchlistDraftedIcon: {
  width: 30,
  height: 30,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#35240D',
  borderRadius: 8,
},
watchlistDraftedCopy: { flex: 1, minWidth: 0, marginLeft: 9 },
watchlistDraftedTitle: { color: '#FFB340', fontSize: 9, fontWeight: '900', letterSpacing: 0.45 },
watchlistDraftedText: { color: '#D1BD98', fontSize: 10, fontWeight: '700', marginTop: 2 },
watchlistDraftedDismiss: { padding: 7, marginLeft: 4 },

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
  tickerAutopickLabel: { color: '#FFB340', fontSize: 7, fontWeight: '900', letterSpacing: 0.4 },

tabNavbarGroup: {
  flexDirection: 'row',
  marginHorizontal: 12,
  marginBottom: 8,
  padding: 4,
  backgroundColor: '#08111A',
  borderWidth: 1,
  borderColor: '#1B2A36',
  borderRadius: 12,
},

navTabBtn: {
  flex: 1,
  minHeight: 38,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
},

navTabBtnActive: {
  backgroundColor: '#13231C',
  borderWidth: 1,
  borderColor: 'rgba(0,242,122,0.35)',
},

navTabText: {
  color: '#607180',
  fontSize: 10,
  fontWeight: '900',
  letterSpacing: 0.25,
},

navTabTextActive: {
  color: '#00F27A',
},
  poolFiltersContainer: { paddingVertical: 10, gap: 9 },
  playerSearchBox: { minHeight: 40, flexDirection: 'row', alignItems: 'center', marginHorizontal: 14, paddingHorizontal: 12, backgroundColor: '#08111A', borderWidth: 1, borderColor: '#1B2A36', borderRadius: 9 },
  playerSearchInput: { flex: 1, color: '#F7FAFC', fontSize: 12, fontWeight: '700', paddingVertical: 9, paddingHorizontal: 9 },
  clearSearchButton: { padding: 4 },
  toolbarRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14 },
  miniPositionRow: { flexDirection: 'row', backgroundColor: '#111', padding: 2, borderRadius: 4, borderWidth: 1, borderColor: '#222' },
  miniPosBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 2 },
  miniPosBadgeActive: { backgroundColor: '#222' },
  miniPosText: { color: '#555', fontSize: 10, fontWeight: '800' },
  miniPosTextActive: { color: '#00ff87' },
  disabledPositionTab: { backgroundColor: '#0A0A0A', opacity: 0.15 },
  sortToggleBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 4, borderWidth: 1, borderColor: '#222' },
  sortToggleText: { color: '#888', fontSize: 10, fontWeight: '800', marginLeft: 6 },
  clubFilterRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14 },
  clubFilterLabel: { color: '#607180', fontSize: 9, fontWeight: '900', letterSpacing: 0.6, marginRight: 8 },
  clubFilterList: { paddingRight: 14, gap: 6 },
  clubFilterChip: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#08111A', borderWidth: 1, borderColor: '#1B2A36', borderRadius: 999 },
  clubFilterChipActive: { backgroundColor: '#13231C', borderColor: 'rgba(0,242,122,0.45)' },
  clubFilterChipText: { color: '#607180', fontSize: 9, fontWeight: '800' },
  clubFilterChipTextActive: { color: '#00F27A' },
playerPoolRow: {
  flexDirection: 'row',
  alignItems: 'center',
  marginHorizontal: 12,
  marginBottom: 5,
  backgroundColor: '#0B141D',
  borderWidth: 1,
  borderColor: '#192733',
  borderRadius: 11,
  overflow: 'hidden',
},

playerPoolRowSelected: {
  backgroundColor: '#10251B',
  borderColor: '#00F27A',
},
 rowClickContainer: {
  flex: 1,
  minWidth: 0,
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 8,
  paddingLeft: 10,
  paddingRight: 4,
},

reconnectBanner: {
  flexDirection: 'row',
  alignItems: 'center',
  marginHorizontal: 12,
  marginBottom: 8,
  paddingVertical: 9,
  paddingHorizontal: 11,
  backgroundColor: '#251B0D',
  borderWidth: 1,
  borderColor: '#624719',
  borderRadius: 9,
},
reconnectBannerCopy: { flex: 1, minWidth: 0, marginLeft: 8 },
reconnectBannerTitle: { color: '#FFB340', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
reconnectBannerText: { color: '#B7A27F', fontSize: 9, fontWeight: '700', marginTop: 2 },
resyncSuccessBanner: {
  flexDirection: 'row',
  alignItems: 'center',
  alignSelf: 'center',
  marginBottom: 8,
  paddingVertical: 6,
  paddingHorizontal: 10,
  backgroundColor: '#0B1D14',
  borderWidth: 1,
  borderColor: '#1F5D3F',
  borderRadius: 999,
},
resyncSuccessBannerText: { color: '#8DE8B9', fontSize: 9, fontWeight: '800', marginLeft: 5 },
awayModeBanner: {
  flexDirection: 'row',
  alignItems: 'center',
  marginHorizontal: 12,
  marginBottom: 8,
  paddingVertical: 9,
  paddingHorizontal: 11,
  backgroundColor: '#251B0D',
  borderWidth: 1,
  borderColor: '#624719',
  borderRadius: 9,
},
awayModeBannerCopy: { flex: 1, minWidth: 0, marginHorizontal: 8 },
awayModeBannerTitle: { color: '#FFB340', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
awayModeBannerText: { color: '#B7A27F', fontSize: 9, fontWeight: '700', marginTop: 2 },
markPresentButton: {
  minWidth: 74,
  minHeight: 32,
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: 10,
  backgroundColor: '#FFB340',
  borderRadius: 7,
},
markPresentButtonText: { color: '#241500', fontSize: 9, fontWeight: '900' },
  rowClickContainerHovered: { backgroundColor: '#101E28' },
  rowClickContainerPressed: { backgroundColor: '#13231C' },
  playerRowActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 4,
    paddingRight: 8,
  },
  playerRowActionButton: {
    width: 30,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#22313D',
    backgroundColor: '#0D1821',
  },
  playerRowActionButtonActive: { backgroundColor: '#10251B', borderColor: '#00F27A' },
  playerRowActionButtonDanger: { backgroundColor: '#24110F', borderColor: '#51211D' },
  playerRowActionButtonDisabled: { backgroundColor: '#0A1219', borderColor: '#172530', opacity: 0.72 },
  playerRowActionButtonHovered: { backgroundColor: '#172631', borderColor: '#3B5363' },
  playerRowActionButtonPressed: { opacity: 0.72 },
  posBadgeBox: { width: 42, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 4, marginLeft: 6, marginRight: 4 },
  posBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.2 },
  watchlistIndexNumberText: { color: '#888', fontSize: 13, fontWeight: '800', marginRight: 4, minWidth: 20 },
  shifterButtonsContainer: { flexDirection: 'row', marginRight: 4 },
  shifterArrowPad: { padding: 6, backgroundColor: '#1C1C1E', borderRadius: 4, marginLeft: 4 },
  poolPlayerNameText: { color: '#DDD', fontSize: 13, fontWeight: '800' },
  poolPlayerTeamText: { color: '#555', fontSize: 11, fontWeight: '600', marginTop: 1 },
  poolPlayerIdentity: { flex: 1, minWidth: 0 },
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
  pickReviewPanel: {
    backgroundColor: '#0C171F',
    borderTopWidth: 2,
    borderTopColor: '#00F27A',
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  pickReviewModalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  pickReviewPanelCentered: {
    width: '100%',
    maxWidth: 440,
    borderWidth: 1,
    borderTopWidth: 2,
    borderColor: '#253744',
    borderTopColor: '#00F27A',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  pickReviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickReviewIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  pickReviewNameBlock: { flex: 1, minWidth: 0, marginLeft: 2 },
  pickReviewKicker: { color: '#00F27A', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  pickReviewPlayerName: { color: '#F7FAFC', fontSize: 15, fontWeight: '900', marginTop: 1 },
  pickReviewClub: { color: '#71818E', fontSize: 10, fontWeight: '700', marginTop: 1 },
  pickReviewTimer: {
    minWidth: 60,
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#07150F',
    borderWidth: 1,
    borderColor: '#1E5B3D',
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  pickReviewTimerUrgent: { backgroundColor: '#25100F', borderColor: '#7A2B25' },
  pickReviewTimerText: { color: '#00F27A', fontSize: 12, fontWeight: '900' },
  pickReviewTimerTextUrgent: { color: '#FF6B61' },
  pickReviewFacts: { flexDirection: 'row', gap: 6, marginTop: 9 },
  pickReviewFact: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
    backgroundColor: '#08111A',
    borderWidth: 1,
    borderColor: '#1B2A36',
    borderRadius: 7,
  },
  pickReviewFactValue: { color: '#F7FAFC', fontSize: 12, fontWeight: '900' },
  pickReviewFactLabel: { color: '#607180', fontSize: 7, fontWeight: '900', marginTop: 1, letterSpacing: 0.3 },
  pickReviewRetryNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 7,
    paddingHorizontal: 9,
    backgroundColor: '#251B0D',
    borderWidth: 1,
    borderColor: '#624719',
    borderRadius: 7,
  },
  pickReviewRetryNoticeText: { flex: 1, color: '#D7BB88', fontSize: 9, fontWeight: '700', marginLeft: 6 },
  pickReviewActions: { flexDirection: 'row', gap: 7, marginTop: 9 },
  cancelPickReviewButton: {
    minWidth: 88,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101A23',
    borderWidth: 1,
    borderColor: '#293B49',
    borderRadius: 8,
  },
  cancelPickReviewButtonText: { color: '#A9B4BD', fontSize: 10, fontWeight: '900' },
  confirmPickReviewButton: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#00F27A',
    borderRadius: 8,
  },
  confirmPickReviewButtonDisabled: { opacity: 0.62 },
  confirmPickReviewButtonText: { color: '#00150B', fontSize: 10, fontWeight: '900', letterSpacing: 0.3 },
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
draftOrderPanel: {
  backgroundColor: '#08111A',
  marginHorizontal: 12,
  marginBottom: 9,
  borderWidth: 1,
  borderColor: '#1B2A36',
  borderRadius: 14,
  paddingTop: 11,
  paddingBottom: 11,
  overflow: 'hidden',
},

draftOrderHeader: {
  minHeight: 44,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: 14,
  marginBottom: 0,
},

draftTrackerHeaderLeft: {
  flex: 1,
  minWidth: 0,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 18,
},

collapsedTrackerManager: {
  flex: 1,
  color: '#00F27A',
  fontSize: 11,
  fontWeight: '800',
},

draftTrackerHeaderActions: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
},

collapseTrackerButton: {
  width: 30,
  height: 30,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#0D1924',
  borderWidth: 1,
  borderColor: '#233645',
  borderRadius: 8,
},

draftOrderEyebrow: {
  color: '#687887',
  fontSize: 8,
  fontWeight: '900',
  letterSpacing: 0.8,
},

draftOrderRound: {
  color: '#F7FAFC',
  fontSize: 14,
  fontWeight: '900',
  marginTop: 2,
},

snakeDirectionBadge: {
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: '#06101A',
  borderWidth: 1,
  borderColor: '#223443',
  borderRadius: 999,
  paddingVertical: 5,
  paddingHorizontal: 9,
  gap: 5,
},

snakeDirectionText: {
  color: '#A7B4C2',
  fontSize: 9,
  fontWeight: '900',
},

draftOrderList: {
  paddingHorizontal: 14,
  gap: 8,
},

draftOrderManagerCard: {
  width: 138,
  minHeight: 44,
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: '#0D1924',
  borderWidth: 1,
  borderColor: '#223443',
  borderRadius: 9,
  paddingHorizontal: 8,
},

draftOrderManagerCardActive: {
  backgroundColor: 'rgba(0, 242, 122, 0.10)',
  borderColor: 'rgba(0, 242, 122, 0.45)',
},

draftOrderNumber: {
  width: 29,
  height: 29,
  borderRadius: 7,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#06101A',
  borderWidth: 1,
  borderColor: '#365063',
},

draftOrderNumberActive: {
  backgroundColor: '#00F27A',
  borderColor: '#00A956',
},

draftOrderNumberText: {
  color: '#A7B4C2',
  fontSize: 10,
  fontWeight: '900',
},

draftOrderNumberTextActive: {
  color: '#030A11',
},

draftOrderManagerInfo: {
  flex: 1,
  minWidth: 0,
  marginLeft: 8,
},

draftOrderManagerName: {
  color: '#F7FAFC',
  fontSize: 11,
  fontWeight: '800',
},

draftOrderManagerNameActive: {
  color: '#00F27A',
},

draftOrderManagerMeta: {
  color: '#687887',
  fontSize: 7,
  fontWeight: '900',
  letterSpacing: 0.4,
  marginTop: 2,
},

livePickDot: {
  width: 7,
  height: 7,
  borderRadius: 4,
  backgroundColor: '#00F27A',
  marginLeft: 6,
},

pickTimelineDivider: {
  height: 1,
  backgroundColor: '#223443',
  marginTop: 10,
  marginHorizontal: 14,
},

pickTimelineHeader: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: 14,
  marginTop: 9,
  marginBottom: 7,
},

pickTimelineTitle: {
  color: '#A7B4C2',
  fontSize: 8,
  fontWeight: '900',
  letterSpacing: 0.8,
},

pickTimelineHint: {
  color: '#687887',
  fontSize: 8,
  fontWeight: '700',
},

pickTimelineList: {
  paddingHorizontal: 14,
  gap: 7,
},

pickTimelineCard: {
  width: 116,
  minHeight: 52,
  backgroundColor: '#0D1924',
  borderWidth: 1,
  borderColor: '#223443',
  borderRadius: 8,
  paddingVertical: 7,
  paddingHorizontal: 8,
},

pickTimelineCardCurrent: {
  backgroundColor: 'rgba(0, 242, 122, 0.10)',
  borderColor: '#00F27A',
},

pickTimelineTopRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
},

pickTimelineNumber: {
  color: '#687887',
  fontSize: 7,
  fontWeight: '900',
  letterSpacing: 0.4,
},

pickTimelineNumberCurrent: {
  color: '#00F27A',
},

pickTimelineRound: {
  color: '#687887',
  fontSize: 7,
  fontWeight: '900',
},

pickTimelineManager: {
  color: '#F7FAFC',
  fontSize: 10,
  fontWeight: '800',
  marginTop: 6,
},

pickTimelineManagerCurrent: {
  color: '#00F27A',
},

pickTimelineMeta: {
  color: '#687887',
  fontSize: 7,
  fontWeight: '900',
  letterSpacing: 0.35,
  marginTop: 3,
},

draftWorkspace: {
  flex: 1,
  minHeight: 0,
},

draftWorkspaceDesktop: {
  flexDirection: 'row',
  alignItems: 'stretch',
  gap: 12,
  paddingHorizontal: 12,
  paddingBottom: 8,
},

primaryWorkspace: {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
},

desktopSquadSidebar: {
  width: 340,
  minHeight: 0,
  backgroundColor: '#08111A',
  borderWidth: 1,
  borderColor: '#1B2A36',
  borderRadius: 14,
  padding: 14,
},

sidebarHeader: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
},

sidebarEyebrow: {
  color: '#607180',
  fontSize: 8,
  fontWeight: '900',
  letterSpacing: 0.9,
},

sidebarTitle: {
  color: '#F7FAFC',
  fontSize: 20,
  fontWeight: '900',
  marginTop: 3,
},

sidebarTotalBadge: {
  flexDirection: 'row',
  alignItems: 'baseline',
  backgroundColor: '#0D1924',
  borderWidth: 1,
  borderColor: '#233645',
  borderRadius: 10,
  paddingVertical: 6,
  paddingHorizontal: 10,
},

sidebarTotalNumber: {
  color: '#00F27A',
  fontSize: 18,
  fontWeight: '900',
},

sidebarTotalLabel: {
  color: '#607180',
  fontSize: 10,
  fontWeight: '800',
  marginLeft: 2,
},

sidebarProgressTrack: {
  height: 5,
  backgroundColor: '#13202B',
  borderRadius: 999,
  overflow: 'hidden',
  marginTop: 13,
  marginBottom: 14,
},

sidebarProgressFill: {
  height: '100%',
  backgroundColor: '#00F27A',
  borderRadius: 999,
},

sidebarPositionGrid: {
  gap: 7,
},

sidebarPositionCard: {
  minHeight: 54,
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: '#0B151E',
  borderWidth: 1,
  borderColor: '#192936',
  borderRadius: 10,
  paddingHorizontal: 9,
},

sidebarPositionCardFull: {
  backgroundColor: '#0D1C18',
  borderColor: 'rgba(0,242,122,0.26)',
},

sidebarPositionIcon: {
  width: 38,
  height: 32,
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1,
  borderRadius: 8,
},

sidebarPositionCode: {
  fontSize: 9,
  fontWeight: '900',
},

sidebarPositionInfo: {
  flex: 1,
  marginLeft: 10,
},

sidebarPositionLabel: {
  color: '#E8EDF2',
  fontSize: 11,
  fontWeight: '800',
},

sidebarPositionCount: {
  color: '#607180',
  fontSize: 9,
  fontWeight: '700',
  marginTop: 2,
},

sidebarDivider: {
  height: 1,
  backgroundColor: '#1B2A36',
  marginVertical: 14,
},

sidebarTurnCard: {
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: '#0B151E',
  borderWidth: 1,
  borderColor: '#192936',
  borderRadius: 10,
  padding: 10,
},

sidebarTurnIcon: {
  width: 36,
  height: 36,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#071019',
  borderRadius: 9,
},

sidebarTurnInfo: {
  flex: 1,
  marginLeft: 10,
},

sidebarTurnTitle: {
  color: '#D6DEE5',
  fontSize: 11,
  fontWeight: '900',
},

sidebarTurnTitleActive: {
  color: '#00F27A',
},

sidebarTurnMeta: {
  color: '#607180',
  fontSize: 9,
  fontWeight: '700',
  marginTop: 3,
},

sidebarSquadButton: {
  minHeight: 42,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#10231A',
  borderWidth: 1,
  borderColor: 'rgba(0,242,122,0.35)',
  borderRadius: 10,
  marginTop: 10,
  gap: 7,
},

sidebarSquadButtonText: {
  color: '#00F27A',
  fontSize: 9,
  fontWeight: '900',
  letterSpacing: 0.5,
},

desktopSidebarScroll: {
  flex: 1,
},

desktopSidebarContent: {
  paddingBottom: 12,
},

sidebarSquadButtonPlayerList: {
  backgroundColor: '#0B1822',
  borderColor: '#294252',
},

myTurnPulseOverlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(0,242,122,0.18)',
  borderWidth: 2,
  borderColor: '#00F27A',
  borderRadius: 14,
},

yourTurnPill: {
  alignSelf: 'flex-start',
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: 'rgba(0,242,122,0.14)',
  borderWidth: 1,
  borderColor: 'rgba(0,242,122,0.38)',
  borderRadius: 999,
  paddingVertical: 3,
  paddingHorizontal: 7,
  marginBottom: 6,
  gap: 5,
},

yourTurnLiveDot: {
  width: 6,
  height: 6,
  backgroundColor: '#00F27A',
  borderRadius: 3,
},

yourTurnPillText: {
  color: '#00F27A',
  fontSize: 8,
  fontWeight: '900',
  letterSpacing: 0.6,
},

playerPoolRowTurnDisabled: {
  backgroundColor: '#091119',
  borderColor: '#13212C',
  opacity: 0.72,
},

pickSelectionControl: {
  width: 34,
  height: 34,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
},

pickSelectionControlDisabled: {
  backgroundColor: '#101A23',
  borderWidth: 1,
  borderColor: '#21313D',
},

hapticsPreferenceButton: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 5,
  paddingHorizontal: 8,
  backgroundColor: '#0D1924',
  borderWidth: 1,
  borderColor: '#223443',
  borderRadius: 999,
  gap: 5,
},

draftFeedbackPreferences: {
  flexDirection: 'row',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 2,
  marginRight: 14,
  marginBottom: 8,
},

hapticsPreferenceText: {
  color: '#687887',
  fontSize: 7,
  fontWeight: '900',
  letterSpacing: 0.45,
},

hapticsPreferenceTextActive: {
  color: '#00F27A',
},

draftOrderManagerCardChanged: {
  backgroundColor: 'rgba(0,242,122,0.18)',
  borderColor: '#74FFB8',
  shadowColor: '#00F27A',
  shadowOpacity: 0.48,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 0 },
  elevation: 7,
},

pickConfirmationOverlay: {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(2,7,11,0.88)',
  padding: 20,
},

pickConfirmationCard: {
  width: '100%',
  maxWidth: 390,
  alignItems: 'center',
  backgroundColor: '#09141C',
  borderWidth: 1,
  borderColor: 'rgba(0,242,122,0.48)',
  borderRadius: 20,
  paddingVertical: 24,
  paddingHorizontal: 20,
  shadowColor: '#00F27A',
  shadowOpacity: 0.2,
  shadowRadius: 26,
  shadowOffset: { width: 0, height: 0 },
  elevation: 18,
},

pickConfirmationSuccessIcon: {
  width: 62,
  height: 62,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#00F27A',
  borderRadius: 31,
  marginBottom: 16,
},

pickConfirmationEyebrow: {
  color: '#00F27A',
  fontSize: 9,
  fontWeight: '900',
  letterSpacing: 1.8,
},

pickConfirmationPlayerName: {
  color: '#F7FAFC',
  fontSize: 26,
  fontWeight: '900',
  textAlign: 'center',
  marginTop: 6,
},

pickConfirmationClub: {
  color: '#8B9AA8',
  fontSize: 12,
  fontWeight: '700',
  marginTop: 4,
},

pickConfirmationMetaRow: {
  width: '100%',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#071019',
  borderWidth: 1,
  borderColor: '#1B2A36',
  borderRadius: 12,
  paddingVertical: 12,
  paddingHorizontal: 12,
  marginTop: 18,
  gap: 13,
},

pickConfirmationPositionBadge: {
  minWidth: 52,
  alignItems: 'center',
  backgroundColor: 'rgba(0,242,122,0.13)',
  borderWidth: 1,
  borderColor: 'rgba(0,242,122,0.32)',
  borderRadius: 8,
  paddingVertical: 8,
  paddingHorizontal: 9,
},

pickConfirmationPositionText: {
  color: '#00F27A',
  fontSize: 10,
  fontWeight: '900',
},

pickConfirmationMetaDivider: {
  width: 1,
  height: 34,
  backgroundColor: '#223443',
},

pickConfirmationMetaBlock: {
  minWidth: 54,
  alignItems: 'center',
},

pickConfirmationMetaLabel: {
  color: '#607180',
  fontSize: 7,
  fontWeight: '900',
  letterSpacing: 0.7,
},

pickConfirmationMetaValue: {
  color: '#F7FAFC',
  fontSize: 15,
  fontWeight: '900',
  marginTop: 3,
},

pickConfirmationManagerRow: {
  maxWidth: '100%',
  flexDirection: 'row',
  alignItems: 'center',
  marginTop: 15,
  gap: 7,
},

pickConfirmationManagerName: {
  flexShrink: 1,
  color: '#C6D0D9',
  fontSize: 10,
  fontWeight: '800',
},

pickConfirmationDismissButton: {
  width: '100%',
  minHeight: 44,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#10261B',
  borderWidth: 1,
  borderColor: 'rgba(0,242,122,0.34)',
  borderRadius: 10,
  marginTop: 19,
},

pickConfirmationDismissText: {
  color: '#00F27A',
  fontSize: 9,
  fontWeight: '900',
  letterSpacing: 0.65,
},

pausedBg: {
  backgroundColor: '#211A0E',
  borderColor: '#8A6424',
},
pausedTurnCopy: { flex: 1, minWidth: 0, paddingRight: 12 },
pausedTurnBadge: {
  width: 40,
  height: 40,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#35270F',
  borderWidth: 1,
  borderColor: '#8A6424',
  borderRadius: 20,
},
commissionerControlPanel: {
  marginHorizontal: 12,
  marginBottom: 8,
  backgroundColor: '#0A141C',
  borderWidth: 1,
  borderColor: '#234337',
  borderRadius: 11,
  overflow: 'hidden',
},
commissionerControlHeader: {
  minHeight: 52,
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: 11,
},
commissionerControlHeaderIcon: {
  width: 32,
  height: 32,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#10251B',
  borderWidth: 1,
  borderColor: '#245E42',
  borderRadius: 8,
},
commissionerControlHeaderCopy: { flex: 1, minWidth: 0, marginHorizontal: 9 },
commissionerControlEyebrow: { color: '#00F27A', fontSize: 7, fontWeight: '900', letterSpacing: 0.8 },
commissionerControlTitle: { color: '#E9EFF3', fontSize: 11, fontWeight: '900', marginTop: 2 },
commissionerControlStateBadge: {
  paddingVertical: 4,
  paddingHorizontal: 7,
  marginRight: 8,
  backgroundColor: '#101E27',
  borderRadius: 999,
},
commissionerControlStateText: { color: '#92A3AF', fontSize: 7, fontWeight: '900', letterSpacing: 0.45 },
commissionerControlBody: {
  padding: 10,
  paddingTop: 9,
  borderTopWidth: 1,
  borderTopColor: '#1A2A34',
},
commissionerControlContext: { color: '#82929F', fontSize: 9, fontWeight: '800', marginBottom: 8 },
commissionerControlActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
commissionerControlButton: {
  minWidth: 118,
  minHeight: 38,
  flexGrow: 1,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  paddingHorizontal: 10,
  backgroundColor: '#101D26',
  borderWidth: 1,
  borderColor: '#293D4B',
  borderRadius: 8,
},
commissionerPauseButton: { backgroundColor: '#241C0E', borderColor: '#6F5221' },
commissionerResumeButton: { backgroundColor: '#00F27A', borderColor: '#00F27A' },
commissionerAutopickButton: { backgroundColor: '#241313', borderColor: '#62302D' },
commissionerControlButtonDisabled: { opacity: 0.42 },
commissionerControlButtonText: { color: '#C6D0D9', fontSize: 8, fontWeight: '900', letterSpacing: 0.25 },
commissionerResumeButtonText: { color: '#00150B' },
commissionerAutopickButtonText: { color: '#FF9E97' },
commissionerNoticeBanner: {
  flexDirection: 'row',
  alignItems: 'center',
  alignSelf: 'center',
  marginBottom: 8,
  paddingVertical: 7,
  paddingHorizontal: 11,
  backgroundColor: '#0B1D14',
  borderWidth: 1,
  borderColor: '#1F5D3F',
  borderRadius: 999,
},
commissionerNoticeText: { color: '#8DE8B9', fontSize: 9, fontWeight: '800', marginLeft: 5 },
commissionerConfirmOverlay: {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  padding: 18,
  backgroundColor: 'rgba(0, 0, 0, 0.76)',
},
commissionerConfirmCard: {
  width: '100%',
  maxWidth: 430,
  padding: 20,
  backgroundColor: '#0B151E',
  borderWidth: 1,
  borderColor: '#49302D',
  borderRadius: 16,
},
commissionerConfirmIcon: {
  width: 46,
  height: 46,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#281313',
  borderWidth: 1,
  borderColor: '#62302D',
  borderRadius: 23,
  marginBottom: 13,
},
commissionerConfirmEyebrow: { color: '#FF7A70', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
commissionerConfirmTitle: { color: '#F4F7F9', fontSize: 21, fontWeight: '900', marginTop: 5 },
commissionerConfirmText: { color: '#93A2AE', fontSize: 11, fontWeight: '700', lineHeight: 17, marginTop: 9 },
commissionerConfirmContext: {
  marginTop: 15,
  padding: 11,
  backgroundColor: '#081018',
  borderWidth: 1,
  borderColor: '#1D2D38',
  borderRadius: 9,
},
commissionerConfirmContextLabel: { color: '#607180', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
commissionerConfirmContextValue: { color: '#E7EDF1', fontSize: 11, fontWeight: '900', marginTop: 4 },
commissionerConfirmActions: { flexDirection: 'row', gap: 8, marginTop: 17 },
commissionerConfirmCancel: {
  minHeight: 42,
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#101B24',
  borderWidth: 1,
  borderColor: '#293A47',
  borderRadius: 9,
},
commissionerConfirmCancelText: { color: '#9AA8B3', fontSize: 9, fontWeight: '900' },
commissionerConfirmSubmit: {
  minHeight: 42,
  flex: 1.3,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  backgroundColor: '#FF7A70',
  borderRadius: 9,
},
commissionerConfirmSubmitText: { color: '#2A0705', fontSize: 9, fontWeight: '900' },
completionDangerButton: { borderColor: '#63312D', backgroundColor: '#211313' },
completionDangerButtonText: { color: '#FF8C84', fontSize: 10, fontWeight: '900', letterSpacing: 0.45 },
completionCommissionerActions: { gap: 8, marginTop: 7, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#25313A' },
completionCommissionerLabel: { color: '#FF8C84', fontSize: 7, fontWeight: '900', letterSpacing: 0.8, marginBottom: 1 },
commissionerDangerButton: { backgroundColor: '#211313', borderColor: '#63312D' },
commissionerDangerButtonText: { color: '#FF8C84', fontSize: 8, fontWeight: '900', letterSpacing: 0.25 },
preDraftCommissionerPanel: {
  marginHorizontal: 10,
  marginTop: 8,
  backgroundColor: '#0A151D',
  borderWidth: 1,
  borderColor: '#234034',
  borderRadius: 10,
  overflow: 'hidden',
},
preDraftCommissionerHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
draftOrderEditorBody: { padding: 10, paddingTop: 2, borderTopWidth: 1, borderTopColor: '#172A24' },
draftOrderEditorRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', marginTop: 5, paddingHorizontal: 8, backgroundColor: '#0D1B24', borderRadius: 8 },
draftOrderEditorNumber: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0D2A1C', borderRadius: 6 },
draftOrderEditorNumberText: { color: '#00F27A', fontSize: 9, fontWeight: '900' },
draftOrderEditorName: { flex: 1, minWidth: 0, marginHorizontal: 9, color: '#E4EBEF', fontSize: 10, fontWeight: '900' },
draftOrderMoveButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
saveDraftOrderButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 10, backgroundColor: '#00F27A', borderRadius: 9 },
saveDraftOrderButtonText: { color: '#00150B', fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
commissionerPlayerPickerCard: { width: '100%', maxWidth: 540, maxHeight: '82%', padding: 14, backgroundColor: '#0B151E', borderWidth: 1, borderColor: '#294034', borderRadius: 15 },
commissionerPlayerPickerHeader: { flexDirection: 'row', alignItems: 'flex-start' },
commissionerPlayerPickerHeaderCopy: { flex: 1, minWidth: 0, paddingRight: 10 },
commissionerPlayerPickerTitle: { color: '#F2F6F8', fontSize: 18, fontWeight: '900', marginTop: 4 },
commissionerPlayerPickerSubtitle: { color: '#82929F', fontSize: 10, fontWeight: '700', lineHeight: 15, marginTop: 5 },
modalCloseButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111E28', borderRadius: 8 },
commissionerPlayerSearchBox: { height: 42, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 13, paddingHorizontal: 10, backgroundColor: '#081018', borderWidth: 1, borderColor: '#213440', borderRadius: 9 },
commissionerPlayerSearchInput: { flex: 1, color: '#E9EFF3', fontSize: 11, fontWeight: '700', outlineStyle: 'none' } as any,
commissionerPlayerList: { flexGrow: 0, marginTop: 8 },
commissionerPlayerRow: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#182833' },
commissionerPlayerRank: { width: 40 },
commissionerPlayerRankText: { color: '#607180', fontSize: 8, fontWeight: '900' },
commissionerPlayerCopy: { flex: 1, minWidth: 0 },
commissionerPlayerName: { color: '#EDF2F5', fontSize: 11, fontWeight: '900' },
commissionerPlayerClub: { color: '#657684', fontSize: 8, fontWeight: '700', marginTop: 2 },
commissionerPlayerEmpty: { alignItems: 'center', paddingVertical: 28 },
commissionerPlayerEmptyText: { color: '#657684', fontSize: 9, fontWeight: '700' },
});
