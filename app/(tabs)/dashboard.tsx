import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DraftCountdownCard from '@/components/DraftCountdownCard';
import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import {
  HomeLeagueMembership,
  useHomeDashboard,
} from '@/features/home/hooks/useHomeDashboard';
import {
  DEFAULT_HOME_SHORTCUTS,
  HomeShortcutId,
  useHomeShortcuts,
} from '@/features/home/hooks/useHomeShortcuts';
import { LeagueActivityItem } from '@/features/market/services/leagueActivity';

const formatCountdown = (target: string | null, now: number) => {
  if (!target) return 'Schedule pending';
  const remaining = new Date(target).getTime() - now;
  if (remaining <= 0) return 'Deadline passed';
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return `${hours}h ${minutes}m`;
};

const statusLabel = (status?: string | null) =>
  String(status || 'UPCOMING').replaceAll('_', ' ');

const activityMovement = (activity: LeagueActivityItem) => {
  const incoming = activity.playersIn.map(player => player.web_name).filter(Boolean).join(', ');
  const outgoing = activity.playersOut.map(player => player.web_name).filter(Boolean).join(', ');
  if (incoming && outgoing) return `${incoming} in · ${outgoing} out`;
  if (incoming) return `${incoming} in`;
  if (outgoing) return `${outgoing} out`;
  return activity.subtitle;
};

const relativeActivityTime = (timestamp: string, now: number) => {
  const elapsed = Math.max(0, now - new Date(timestamp).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString([], { day: 'numeric', month: 'short' });
};

const HOME_SHORTCUTS: Record<HomeShortcutId, {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  route: string;
}> = {
  trade_offers: { label: 'Trade offers', icon: 'mail-unread-outline', route: '/(tabs)/market/waivers-trades?tab=OFFERS' },
  live_matches: { label: 'Live matches', icon: 'radio-outline', route: '/(tabs)/league/matches' },
  waivers: { label: 'Waivers', icon: 'swap-vertical-outline', route: '/(tabs)/market/waivers-trades?tab=WAIVERS' },
  transaction_history: { label: 'History', icon: 'receipt-outline', route: '/(tabs)/market/waiver-history' },
  watchlist: { label: 'Watchlist', icon: 'star-outline', route: '/(tabs)/players/watchlist' },
  scout_players: { label: 'Scout players', icon: 'search-outline', route: '/(tabs)/players/scout' },
  league_table: { label: 'League table', icon: 'trophy-outline', route: '/(tabs)/league' },
  my_squad: { label: 'My squad', icon: 'shirt-outline', route: '/(tabs)/squad' },
};

interface SummaryCardProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  meta: string;
  tone?: 'default' | 'warning' | 'info';
  onPress: () => void;
}

function SummaryCard({ icon, label, value, meta, tone = 'default', onPress }: SummaryCardProps) {
  const { colors: appColors } = useAppTheme();
  const styles = useMemo(() => createStyles(appColors), [appColors]);
  const accent = tone === 'warning'
    ? appColors.warning
    : tone === 'info'
      ? appColors.info
      : appColors.accent;

  return (
    <TouchableOpacity style={styles.summaryCard} onPress={onPress} activeOpacity={0.78}>
      <View style={[styles.summaryIcon, { borderColor: `${accent}66` }]}>
        <Ionicons name={icon} size={17} color={accent} />
      </View>
      <View style={styles.summaryCopy}>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={styles.summaryValue} numberOfLines={1}>{value}</Text>
        <Text style={styles.summaryMeta} numberOfLines={1}>{meta}</Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={appColors.textDisabled} />
    </TouchableOpacity>
  );
}

export default function HomeDashboardScreen() {
  const safeArea = useSafeAreaInsets();
  const { colors: appColors } = useAppTheme();
  const styles = useMemo(() => createStyles(appColors), [appColors]);
  const activityMeta = useMemo(() => ({
    WAIVER: { icon: 'swap-vertical' as const, color: '#7967D8', label: 'WAIVER' },
    FREE_AGENT: { icon: 'flash' as const, color: appColors.info, label: 'FREE AGENT' },
    TRADE: { icon: 'people' as const, color: appColors.accent, label: 'TRADE' },
  }), [appColors]);
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= 900;
  const { currentUserId, activeLeagueId, selectActiveLeague } = useAppSession();
  const [leaguePickerOpen, setLeaguePickerOpen] = useState(false);
  const [shortcutPickerOpen, setShortcutPickerOpen] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'TABLE' | 'ACTIVITY'>('TABLE');
  const [draftShortcutIds, setDraftShortcutIds] = useState<HomeShortcutId[]>(DEFAULT_HOME_SHORTCUTS);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const { shortcutIds, saveShortcuts, saving: shortcutsSaving } = useHomeShortcuts(currentUserId);
  const {
    memberships,
    activeLeague,
    isCommissioner,
    draftCompleted,
    gameweek,
    standings,
    fixture,
    lineup,
    waiver,
    pendingTrades,
    recentActivity,
    announcement,
    chronicle,
    loading,
    refreshing,
    errorMessage,
    refresh,
  } = useHomeDashboard(currentUserId, activeLeagueId);

  useFocusEffect(useCallback(() => {
    void refresh(false);
  }, [refresh]));

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const myStanding = useMemo(
    () => standings.find(row => row.userId === currentUserId) || null,
    [currentUserId, standings]
  );
  const topStandings = standings.slice(0, 3);
  const mobilePanelLimit = height >= 800 ? 5 : height >= 690 ? 4 : 3;
  const mobileStandings = standings.slice(0, mobilePanelLimit);
  const mobileActivity = recentActivity.slice(0, mobilePanelLimit);
  const deadlinePassed = Boolean(
    gameweek && new Date(gameweek.deadline).getTime() <= clockNow && !gameweek.isFinished
  );
  const isDraftLive = String(activeLeague?.draftStatus || '').toUpperCase() === 'LIVE';
  const fixtureIsLive = Boolean(fixture && gameweek && deadlinePassed && !fixture.isFinished);

  useEffect(() => {
    if (!fixtureIsLive) return;

    const liveRefreshTimer = setInterval(() => {
      void refresh('silent');
    }, 30_000);

    return () => clearInterval(liveRefreshTimer);
  }, [fixtureIsLive, refresh]);

  const opponentName = fixture
    ? fixture.homeUserId === currentUserId
      ? fixture.awayTeamName
      : fixture.homeTeamName
    : null;

  const selectLeague = async (membership: HomeLeagueMembership) => {
    setLeaguePickerOpen(false);
    if (membership.leagueId !== activeLeagueId) {
      await selectActiveLeague(membership.leagueId);
    }
  };

  const openShortcutPicker = () => {
    setDraftShortcutIds(shortcutIds);
    setShortcutPickerOpen(true);
  };

  const toggleDraftShortcut = (shortcutId: HomeShortcutId) => {
    if (draftShortcutIds.includes(shortcutId)) {
      setDraftShortcutIds(current => current.filter(item => item !== shortcutId));
      return;
    }
    if (draftShortcutIds.length >= 4) {
      Alert.alert('Four shortcuts selected', 'Remove one shortcut before adding another.');
      return;
    }
    setDraftShortcutIds(current => [...current, shortcutId]);
  };

  const moveDraftShortcut = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draftShortcutIds.length) return;
    setDraftShortcutIds(current => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const persistShortcuts = async () => {
    if (draftShortcutIds.length !== 4) {
      Alert.alert('Choose four shortcuts', 'Select exactly four shortcuts before saving.');
      return;
    }
    if (await saveShortcuts(draftShortcutIds)) setShortcutPickerOpen(false);
    else Alert.alert('Shortcuts not saved', 'Please try again.');
  };

  const shortcutBadge = (shortcutId: HomeShortcutId) => {
    if (shortcutId === 'trade_offers' && pendingTrades > 0) return String(pendingTrades);
    if (shortcutId === 'waivers' && waiver.pendingClaims > 0) return String(waiver.pendingClaims);
    if (shortcutId === 'live_matches' && fixtureIsLive) return 'LIVE';
    return null;
  };

  if (loading && !activeLeague) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={appColors.accent} />
        <Text style={styles.loadingText}>Preparing your league hub…</Text>
      </View>
    );
  }

  const fixtureCard = (
    <TouchableOpacity
      style={[styles.fixtureCard, isDesktop && styles.fixtureCardDesktop]}
      onPress={() => router.push('/(tabs)/league/matches')}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeadingRow}>
        <View>
          <Text style={styles.eyebrow}>
            {fixtureIsLive ? 'LIVE MATCHUP' : fixture?.isFinished ? 'LATEST RESULT' : 'NEXT MATCHUP'}
          </Text>
          <Text style={styles.cardHeading}>Gameweek {gameweek?.gameweek || 1}</Text>
        </View>
        <View style={[styles.statePill, fixtureIsLive && styles.livePill]}>
          {fixtureIsLive && <View style={styles.liveDot} />}
          <Text style={[styles.statePillText, fixtureIsLive && styles.livePillText]}>
            {fixtureIsLive ? 'LIVE' : fixture?.isFinished ? 'FT' : 'UPCOMING'}
          </Text>
        </View>
      </View>

      {fixture ? (
        <View style={styles.scoreboard}>
          <View style={styles.teamBlock}>
            <Text style={styles.teamRole}>{fixture.homeUserId === currentUserId ? 'YOU' : 'HOME'}</Text>
            <Text style={styles.teamName} numberOfLines={2}>{fixture.homeTeamName}</Text>
          </View>
          <View style={styles.scoreBlock}>
            {fixtureIsLive || fixture.isFinished ? (
              <Text style={styles.scoreText}>{fixture.homeScore}–{fixture.awayScore}</Text>
            ) : (
              <Text style={styles.versusText}>VS</Text>
            )}
            <Text style={styles.scoreMeta}>{opponentName ? `Opponent: ${opponentName}` : 'League fixture'}</Text>
          </View>
          <View style={[styles.teamBlock, styles.awayTeamBlock]}>
            <Text style={styles.teamRole}>{fixture.isLeagueAverage ? 'AVG' : fixture.awayUserId === currentUserId ? 'YOU' : 'AWAY'}</Text>
            <Text style={[styles.teamName, styles.awayTeamName]} numberOfLines={2}>{fixture.awayTeamName}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.emptyFixture}>
          <Ionicons name="calendar-outline" size={25} color={appColors.textDisabled} />
          <View style={styles.emptyFixtureCopy}>
            <Text style={styles.emptyFixtureTitle}>Fixture awaiting generation</Text>
            <Text style={styles.emptyFixtureMeta}>Your commissioner can generate the league schedule.</Text>
          </View>
        </View>
      )}

      <View style={styles.cardLinkRow}>
        <Text style={styles.cardLinkText}>VIEW MATCH CENTRE</Text>
        <Ionicons name="arrow-forward" size={14} color={appColors.accent} />
      </View>
    </TouchableOpacity>
  );

  const deadlineCard = (
    <View style={[styles.deadlineCard, isDesktop && styles.deadlineCardDesktop]}>
      <View style={styles.cardHeadingRow}>
        <View style={styles.deadlineIcon}>
          <Ionicons name={deadlinePassed ? 'lock-closed' : 'time-outline'} size={19} color={deadlinePassed ? appColors.warning : appColors.accent} />
        </View>
        <Text style={styles.deadlineStatus}>{statusLabel(gameweek?.status)}</Text>
      </View>
      <Text style={styles.deadlineGameweek}>GW{gameweek?.gameweek || '—'} DEADLINE</Text>
      <Text style={[styles.deadlineCountdown, deadlinePassed && styles.deadlineCountdownLocked]}>
        {formatCountdown(gameweek?.deadline || null, clockNow)}
      </Text>
      <Text style={styles.deadlineDate}>
        {gameweek?.deadline ? new Date(gameweek.deadline).toLocaleString() : 'Official schedule not available'}
      </Text>
      <TouchableOpacity style={styles.inlineAction} onPress={() => router.push('/(tabs)/squad')}>
        <Text style={styles.inlineActionText}>{deadlinePassed ? 'VIEW LOCKED LINEUP' : 'EDIT LINEUP'}</Text>
        <Ionicons name="arrow-forward" size={13} color={appColors.accentForeground} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh(true)}
            tintColor={appColors.accent}
          />
        }
        contentContainerStyle={[styles.scrollContent, !isDesktop && styles.scrollContentMobile]}
      >
        <View style={[styles.page, isDesktop ? styles.pageDesktop : styles.pageMobile]}>
          <View style={[styles.leagueBar, !isDesktop && styles.leagueBarMobile]}>
            <View style={styles.leagueIdentity}>
              <Text style={styles.eyebrow}>ACTIVE LEAGUE</Text>
<TouchableOpacity
  style={styles.leagueSelector}
  onPress={() => setLeaguePickerOpen(true)}
  activeOpacity={0.75}
>
  <Text style={styles.leagueName} numberOfLines={1}>{activeLeague?.name || 'League Hub'}</Text>
  <Ionicons name="chevron-down" size={16} color={appColors.accent} />
</TouchableOpacity>
              <Text style={styles.leagueMeta}>
                {myStanding ? `#${myStanding.rank} · ${myStanding.points} league pts` : 'Season overview'}
              </Text>
            </View>
            {isCommissioner && (
              <View style={styles.leagueActions}>
                <TouchableOpacity
                  style={styles.settingsButton}
                  onPress={() => router.push({ pathname: '/(admin)/league-announcements', params: { leagueId: activeLeagueId || '' } } as any)}
                >
                  <Ionicons name="megaphone-outline" size={17} color={appColors.accent} />
                  {isDesktop && <Text style={styles.settingsText}>ANNOUNCEMENTS</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.settingsButton}
                  onPress={() => router.push({ pathname: '/(admin)/league-settings', params: { leagueId: activeLeagueId || '' } })}
                >
                  <Ionicons name="settings-outline" size={17} color={appColors.accent} />
                  {isDesktop && <Text style={styles.settingsText}>LEAGUE SETTINGS</Text>}
                </TouchableOpacity>
              </View>
            )}
          </View>

          {errorMessage && (
            <TouchableOpacity style={styles.errorBanner} onPress={() => void refresh(false)}>
              <Ionicons name="cloud-offline-outline" size={18} color={appColors.danger} />
              <Text style={styles.errorText}>{errorMessage} Tap to retry.</Text>
            </TouchableOpacity>
          )}

          {announcement ? (
            <TouchableOpacity
              style={[styles.announcementStrip, announcement.priority === 'URGENT' && styles.announcementStripUrgent]}
              onPress={() => setAnnouncementOpen(true)}
              activeOpacity={0.78}
            >
              <Ionicons name={announcement.priority === 'URGENT' ? 'warning' : 'megaphone'} size={16} color={announcement.priority === 'URGENT' ? appColors.danger : appColors.accent} />
              <View style={styles.announcementStripCopy}>
                <Text style={[styles.announcementStripTitle, announcement.priority === 'URGENT' && styles.announcementStripTitleUrgent]} numberOfLines={1}>{announcement.title}</Text>
                <Text style={styles.announcementStripBody} numberOfLines={1}>{announcement.body}</Text>
              </View>
              {announcement.isPinned ? <Ionicons name="pin" size={13} color={appColors.textMuted} /> : null}
              <Ionicons name="chevron-forward" size={14} color={appColors.textDisabled} />
            </TouchableOpacity>
          ) : null}

          {draftCompleted && chronicle ? (
            <TouchableOpacity
              style={styles.chronicleStrip}
              onPress={() => router.push({ pathname: '/league-chronicle', params: { leagueId: activeLeagueId || '', gameweek: chronicle.gameweek } })}
              activeOpacity={0.78}
            >
              <View style={styles.chronicleIcon}><Ionicons name="newspaper-outline" size={17} color={appColors.warning} /></View>
              <View style={styles.chronicleCopy}>
                <Text style={styles.chronicleLabel}>GW{chronicle.gameweek} CHRONICLE</Text>
                <Text style={styles.chronicleTitle} numberOfLines={1}>{chronicle.title}</Text>
              </View>
              <Text style={styles.chronicleRead}>READ</Text>
              <Ionicons name="chevron-forward" size={14} color={appColors.textDisabled} />
            </TouchableOpacity>
          ) : null}

          {!draftCompleted ? (
            <View style={styles.draftSection}>
              {isDraftLive ? (
                <TouchableOpacity
                  style={styles.draftLiveCard}
                  onPress={() => router.push({ pathname: '/draft-room', params: { leagueId: activeLeagueId || '' } })}
                >
                  <View style={styles.draftLiveBadge}>
                    <View style={styles.liveDot} />
                    <Text style={styles.draftLiveBadgeText}>DRAFT LIVE</Text>
                  </View>
                  <Text style={styles.draftLiveTitle}>Your draft room is open</Text>
                  <Text style={styles.draftLiveMeta}>Join the league and continue building your squad.</Text>
                  <View style={styles.cardLinkRow}>
                    <Text style={styles.cardLinkText}>ENTER DRAFT ROOM</Text>
                    <Ionicons name="arrow-forward" size={14} color={appColors.accent} />
                  </View>
                </TouchableOpacity>
              ) : (
                <DraftCountdownCard leagueId={activeLeagueId} />
              )}
            </View>
          ) : (
            <>
              {isDesktop ? (
                <>
              <View style={[styles.heroGrid, isDesktop && styles.heroGridDesktop]}>
                {fixtureCard}
                {deadlineCard}
              </View>

              <View style={styles.sectionHeadingRow}>
                <View>
                  <Text style={styles.sectionEyebrow}>YOUR STATUS</Text>
                  <Text style={styles.sectionHeading}>Ready for Gameweek {gameweek?.gameweek || 1}</Text>
                </View>
              </View>

              <View style={[styles.summaryGrid, isDesktop && styles.summaryGridDesktop]}>
                <SummaryCard
                  icon={deadlinePassed ? 'lock-closed-outline' : 'shirt-outline'}
                  label="LINEUP"
                  value={lineup.formation === '—' ? `${lineup.starterCount}/11 selected` : `${lineup.formation} formation`}
                  meta={lineup.snapshotStatus
                    ? `Deadline lineup ${lineup.snapshotStatus.toLowerCase()}`
                    : `${lineup.starterCount}/11 starters · ${lineup.rosterCount}/15 squad`}
                  tone={lineup.starterCount !== 11 || lineup.rosterCount !== 15 ? 'warning' : 'default'}
                  onPress={() => router.push('/(tabs)/squad')}
                />
                <SummaryCard
                  icon="swap-horizontal-outline"
                  label="WAIVERS"
                  value={waiver.priority ? `Priority #${waiver.priority}` : 'Priority pending'}
                  meta={`${waiver.pendingClaims} pending · ${statusLabel(waiver.marketStatus)}`}
                  tone="info"
                  onPress={() => router.push('/(tabs)/market/waivers-trades')}
                />
                <SummaryCard
                  icon="mail-unread-outline"
                  label="TRADES"
                  value={pendingTrades > 0 ? `${pendingTrades} offer${pendingTrades === 1 ? '' : 's'} waiting` : 'No offers waiting'}
                  meta="Open negotiations and counteroffers"
                  tone={pendingTrades > 0 ? 'warning' : 'default'}
                  onPress={() => router.push('/(tabs)/market/waivers-trades')}
                />
              </View>

              <View style={[styles.lowerGrid, isDesktop && styles.lowerGridDesktop]}>
                <View style={[styles.standingsCard, isDesktop && styles.standingsCardDesktop]}>
                  <View style={styles.cardHeadingRow}>
                    <View>
                      <Text style={styles.eyebrow}>LEAGUE TABLE</Text>
                      <Text style={styles.cardHeading}>Top standings</Text>
                    </View>
                    <TouchableOpacity onPress={() => router.push('/(tabs)/league')}>
                      <Text style={styles.textLink}>FULL TABLE</Text>
                    </TouchableOpacity>
                  </View>
                  {topStandings.length === 0 ? (
                    <Text style={styles.emptyText}>Standings will appear once fixtures begin.</Text>
                  ) : topStandings.map(row => (
                    <View key={row.userId} style={[styles.standingRow, row.userId === currentUserId && styles.myStandingRow]}>
                      <Text style={styles.standingRank}>{row.rank}</Text>
                      <View style={styles.standingTeam}>
                        <Text style={styles.standingName} numberOfLines={1}>{row.teamName}</Text>
                        <Text style={styles.standingRecord}>{row.won}W · {row.drawn}D · {row.lost}L · {row.pointsFor} PF</Text>
                      </View>
                      <Text style={styles.standingPoints}>{row.points}</Text>
                    </View>
                  ))}
                </View>

                <View style={[styles.quickCard, isDesktop && styles.quickCardDesktop]}>
                  <View style={styles.cardHeadingRow}>
                    <View>
                      <Text style={styles.eyebrow}>QUICK ACTIONS</Text>
                      <Text style={styles.cardHeading}>Move straight to the task</Text>
                    </View>
                    <TouchableOpacity onPress={openShortcutPicker}><Text style={styles.textLink}>CUSTOMISE</Text></TouchableOpacity>
                  </View>
                  <View style={styles.quickGrid}>
                    {shortcutIds.map(shortcutId => {
                      const shortcut = HOME_SHORTCUTS[shortcutId];
                      const badge = shortcutBadge(shortcutId);
                      return (
                        <TouchableOpacity key={shortcutId} style={styles.quickAction} onPress={() => router.push(shortcut.route as any)}>
                          <View style={styles.desktopShortcutIcon}>
                            <Ionicons name={shortcut.icon} size={18} color={appColors.accent} />
                            {badge ? <View style={styles.shortcutBadge}><Text style={styles.shortcutBadgeText}>{badge}</Text></View> : null}
                          </View>
                          <Text style={styles.quickActionText}>{shortcut.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </View>

              <View style={styles.activityCard}>
                <View style={styles.cardHeadingRow}>
                  <View>
                    <Text style={styles.eyebrow}>LEAGUE ACTIVITY</Text>
                    <Text style={styles.cardHeading}>Latest moves</Text>
                  </View>
                  <TouchableOpacity onPress={() => router.push('/(tabs)/market/waiver-history')}>
                    <Text style={styles.textLink}>FULL HISTORY</Text>
                  </TouchableOpacity>
                </View>

                {recentActivity.length === 0 ? (
                  <View style={styles.activityEmpty}>
                    <Ionicons name="pulse-outline" size={20} color={appColors.textDisabled} />
                    <Text style={styles.emptyText}>Waivers, signings and completed trades will appear here.</Text>
                  </View>
                ) : recentActivity.map(activity => {
                  const meta = activityMeta[activity.category];
                  return (
                    <TouchableOpacity
                      key={activity.id}
                      style={styles.activityRow}
                      activeOpacity={0.76}
                      onPress={() => router.push('/(tabs)/market/waiver-history')}
                    >
                      <View style={[styles.activityIcon, { borderColor: `${meta.color}55`, backgroundColor: `${meta.color}14` }]}>
                        <Ionicons name={meta.icon} size={15} color={meta.color} />
                      </View>
                      <View style={styles.activityCopy}>
                        <View style={styles.activityTitleRow}>
                          <Text style={[styles.activityCategory, { color: meta.color }]}>{meta.label}</Text>
                          {activity.gameweek ? <Text style={styles.activityGameweek}>GW{activity.gameweek}</Text> : null}
                        </View>
                        <Text style={styles.activityTitle} numberOfLines={1}>{activity.title}</Text>
                        <Text style={styles.activityMovement} numberOfLines={1}>{activityMovement(activity)}</Text>
                      </View>
                      <Text style={styles.activityTime}>{relativeActivityTime(activity.timestamp, clockNow)}</Text>
                      <Ionicons name="chevron-forward" size={14} color={appColors.textDisabled} />
                    </TouchableOpacity>
                  );
                })}
              </View>
                </>
              ) : (
                <View style={styles.mobileDashboard}>
                  <View style={styles.mobileMatchCard}>
                    <TouchableOpacity onPress={() => router.push('/(tabs)/league/matches')} activeOpacity={0.8} style={styles.mobileMatchPressArea}>
                    <View style={styles.mobileMatchHeading}>
                      <View>
                        <Text style={styles.eyebrow}>{fixtureIsLive ? 'LIVE MATCHUP' : fixture?.isFinished ? 'LATEST RESULT' : 'NEXT MATCHUP'}</Text>
                        <Text style={styles.mobileGameweek}>Gameweek {gameweek?.gameweek || 1}</Text>
                      </View>
                      <View style={[styles.statePill, fixtureIsLive && styles.livePill]}>
                        {fixtureIsLive && <View style={styles.liveDot} />}
                        <Text style={[styles.statePillText, fixtureIsLive && styles.livePillText]}>
                          {fixtureIsLive ? 'LIVE' : fixture?.isFinished ? 'FT' : 'UPCOMING'}
                        </Text>
                      </View>
                    </View>

                    {fixture ? (
                      <View style={styles.mobileScoreboard}>
                        <View style={styles.mobileTeamBlock}>
                          <Text style={styles.teamRole}>{fixture.homeUserId === currentUserId ? 'YOU' : 'HOME'}</Text>
                          <Text style={styles.mobileTeamName} numberOfLines={1}>{fixture.homeTeamName}</Text>
                        </View>
                        <View style={styles.mobileScoreBlock}>
                          <Text
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.82}
                            style={fixtureIsLive || fixture.isFinished ? styles.mobileScoreText : styles.mobileVersusText}
                          >
                            {fixtureIsLive || fixture.isFinished ? `${fixture.homeScore}–${fixture.awayScore}` : 'VS'}
                          </Text>
                        </View>
                        <View style={[styles.mobileTeamBlock, styles.awayTeamBlock]}>
                          <Text style={styles.teamRole}>{fixture.isLeagueAverage ? 'AVG' : fixture.awayUserId === currentUserId ? 'YOU' : 'AWAY'}</Text>
                          <Text style={[styles.mobileTeamName, styles.awayTeamName]} numberOfLines={1}>{fixture.awayTeamName}</Text>
                        </View>
                      </View>
                    ) : (
                      <Text style={styles.mobileFixtureEmpty}>Fixture awaiting generation</Text>
                    )}
                    </TouchableOpacity>

                    <View style={styles.mobileDeadlineRow}>
                      <Ionicons name={deadlinePassed ? 'lock-closed' : 'time-outline'} size={16} color={deadlinePassed ? appColors.warning : appColors.accent} />
                      <View style={styles.mobileDeadlineCopy}>
                        <Text style={styles.mobileDeadlineLabel}>LINEUP DEADLINE</Text>
                        <Text style={[styles.mobileDeadlineValue, deadlinePassed && styles.deadlineCountdownLocked]}>{formatCountdown(gameweek?.deadline || null, clockNow)}</Text>
                      </View>
                      <TouchableOpacity style={styles.mobileEditButton} onPress={() => router.push('/(tabs)/squad')}>
                        <Text style={styles.mobileEditButtonText}>{deadlinePassed ? 'VIEW XI' : 'EDIT XI'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.mobileStatusStrip}>
                    <TouchableOpacity style={styles.mobileStatusItem} onPress={() => router.push('/(tabs)/squad')}>
                      <Ionicons name="shirt-outline" size={16} color={appColors.accent} />
                      <View><Text style={styles.mobileStatusLabel}>LINEUP</Text><Text style={styles.mobileStatusValue}>{lineup.formation === '—' ? `${lineup.starterCount}/11` : lineup.formation}</Text></View>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.mobileStatusItem} onPress={() => router.push('/(tabs)/market/waivers-trades?tab=WAIVERS' as any)}>
                      <Ionicons name="swap-vertical-outline" size={16} color={appColors.info} />
                      <View><Text style={styles.mobileStatusLabel}>WAIVERS</Text><Text style={styles.mobileStatusValue}>{waiver.priority ? `#${waiver.priority}` : '—'}</Text></View>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.mobileStatusItem, styles.mobileStatusItemLast]} onPress={() => router.push('/(tabs)/market/waivers-trades?tab=OFFERS' as any)}>
                      <Ionicons name="mail-unread-outline" size={16} color={pendingTrades > 0 ? appColors.warning : appColors.accent} />
                      <View><Text style={styles.mobileStatusLabel}>TRADES</Text><Text style={styles.mobileStatusValue}>{pendingTrades > 0 ? `${pendingTrades} new` : 'Clear'}</Text></View>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.mobileSwitchCard}>
                    <View style={styles.mobileSegments}>
                      <TouchableOpacity style={[styles.mobileSegment, mobilePanel === 'TABLE' && styles.mobileSegmentActive]} onPress={() => setMobilePanel('TABLE')}>
                        <Text style={[styles.mobileSegmentText, mobilePanel === 'TABLE' && styles.mobileSegmentTextActive]}>TABLE</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.mobileSegment, mobilePanel === 'ACTIVITY' && styles.mobileSegmentActive]} onPress={() => setMobilePanel('ACTIVITY')}>
                        <Text style={[styles.mobileSegmentText, mobilePanel === 'ACTIVITY' && styles.mobileSegmentTextActive]}>ACTIVITY</Text>
                      </TouchableOpacity>
                    </View>

                    {mobilePanel === 'TABLE' ? (
                      <View style={styles.mobilePanelBody}>
                        {mobileStandings.length === 0 ? <Text style={styles.mobilePanelEmpty}>Standings will appear once fixtures begin.</Text> : mobileStandings.map(row => (
                          <TouchableOpacity key={row.userId} style={[styles.mobileStandingRow, row.userId === currentUserId && styles.myStandingRow]} onPress={() => router.push('/(tabs)/league')}>
                            <Text style={styles.standingRank}>{row.rank}</Text>
                            <Text style={styles.mobileStandingName} numberOfLines={1}>{row.teamName}</Text>
                            <Text style={styles.standingPoints}>{row.points}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : (
                      <View style={styles.mobilePanelBody}>
                        {mobileActivity.length === 0 ? <Text style={styles.mobilePanelEmpty}>League activity will appear here.</Text> : mobileActivity.map(activity => {
                          const meta = activityMeta[activity.category];
                          return (
                            <TouchableOpacity key={activity.id} style={styles.mobileActivityRow} onPress={() => router.push('/(tabs)/market/waiver-history')}>
                              <Ionicons name={meta.icon} size={15} color={meta.color} />
                              <View style={styles.activityCopy}>
                                <Text style={styles.mobileActivityTitle} numberOfLines={1}>{activity.title}</Text>
                                <Text style={styles.activityMovement} numberOfLines={1}>{activityMovement(activity)}</Text>
                              </View>
                              <Text style={styles.activityTime}>{relativeActivityTime(activity.timestamp, clockNow)}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>

                  <View style={styles.mobileQuickSection}>
                    <View style={styles.mobileQuickHeading}>
                      <Text style={styles.sectionEyebrow}>QUICK ROUTES</Text>
                      <TouchableOpacity onPress={openShortcutPicker}><Text style={styles.textLink}>CUSTOMISE</Text></TouchableOpacity>
                    </View>
                    <View style={styles.mobileQuickGrid}>
                      {shortcutIds.map(shortcutId => {
                        const shortcut = HOME_SHORTCUTS[shortcutId];
                        const badge = shortcutBadge(shortcutId);
                        return (
                          <TouchableOpacity key={shortcutId} style={styles.mobileQuickAction} onPress={() => router.push(shortcut.route as any)}>
                            <View style={styles.mobileQuickIcon}>
                              <Ionicons name={shortcut.icon} size={18} color={appColors.accent} />
                              {badge ? <View style={styles.shortcutBadge}><Text style={styles.shortcutBadgeText}>{badge}</Text></View> : null}
                            </View>
                            <Text style={styles.mobileQuickText} numberOfLines={2}>{shortcut.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      <Modal visible={leaguePickerOpen} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setLeaguePickerOpen(false)}>
        <View style={[styles.modalOverlay, { paddingTop: Math.max(safeArea.top, appSpacing.md), paddingBottom: Math.max(safeArea.bottom, appSpacing.md) }]}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>LEAGUE CONTEXT</Text>
            <Text style={styles.modalTitle}>Switch active league</Text>
            <FlatList
              data={memberships}
              keyExtractor={item => item.leagueId}
              style={styles.leagueList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.leagueOption, item.leagueId === activeLeagueId && styles.leagueOptionActive]}
                  onPress={() => void selectLeague(item)}
                >
                  <View style={styles.leagueOptionCopy}>
                    <Text style={styles.leagueOptionName}>{item.league.name}</Text>
                    <Text style={styles.leagueOptionMeta}>{item.teamName} · {item.role}</Text>
                  </View>
                  {item.leagueId === activeLeagueId && <Ionicons name="checkmark-circle" size={19} color={appColors.accent} />}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              style={styles.createAnotherLeagueButton}
              onPress={() => {
                setLeaguePickerOpen(false);
                router.push('/(auth)/create-league');
              }}
            >
              <Ionicons name="trophy-outline" size={18} color={appColors.accentForeground} />
              <Text style={styles.createAnotherLeagueText}>Create another league</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.joinAnotherLeagueButton}
              onPress={() => {
                setLeaguePickerOpen(false);
                router.push('/(auth)/join-league');
              }}
            >
              <Ionicons name="add-circle-outline" size={18} color={appColors.accent} />
              <Text style={styles.joinAnotherLeagueText}>Join another league</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalClose} onPress={() => setLeaguePickerOpen(false)}>
              <Text style={styles.modalCloseText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={announcementOpen && Boolean(announcement)} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setAnnouncementOpen(false)}>
        <View style={[styles.modalOverlay, { paddingTop: Math.max(safeArea.top, appSpacing.md), paddingBottom: Math.max(safeArea.bottom, appSpacing.md) }]}>
          <View style={[styles.announcementModalCard, announcement?.priority === 'URGENT' && styles.announcementModalCardUrgent]}>
            <View style={styles.announcementModalHeading}>
              <View style={[styles.announcementModalIcon, announcement?.priority === 'URGENT' && styles.announcementModalIconUrgent]}>
                <Ionicons name={announcement?.priority === 'URGENT' ? 'warning' : 'megaphone'} size={20} color={announcement?.priority === 'URGENT' ? appColors.danger : appColors.accent} />
              </View>
              <View style={styles.announcementModalCopy}>
                <Text style={[styles.modalEyebrow, announcement?.priority === 'URGENT' && styles.announcementModalUrgentText]}>{announcement?.priority === 'URGENT' ? 'URGENT LEAGUE NOTICE' : 'LEAGUE ANNOUNCEMENT'}</Text>
                <Text style={styles.announcementModalTitle}>{announcement?.title}</Text>
              </View>
            </View>
            <Text style={styles.announcementModalBody}>{announcement?.body}</Text>
            <Text style={styles.announcementModalMeta}>{announcement?.publishedAt ? `Published ${new Date(announcement.publishedAt).toLocaleString()}` : ''}</Text>
            <View style={styles.announcementModalActions}>
              {isCommissioner ? (
                <TouchableOpacity
                  style={styles.announcementManageButton}
                  onPress={() => {
                    setAnnouncementOpen(false);
                    router.push({ pathname: '/(admin)/league-announcements', params: { leagueId: activeLeagueId || '' } } as any);
                  }}
                >
                  <Text style={styles.announcementManageText}>MANAGE</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.announcementCloseButton} onPress={() => setAnnouncementOpen(false)}>
                <Text style={styles.announcementCloseText}>CLOSE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={shortcutPickerOpen} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setShortcutPickerOpen(false)}>
        <View style={[styles.modalOverlay, { paddingTop: Math.max(safeArea.top, appSpacing.md), paddingBottom: Math.max(safeArea.bottom, appSpacing.md) }]}>
          <View style={styles.shortcutModalCard}>
            <Text style={styles.modalEyebrow}>PERSONAL HOME</Text>
            <Text style={styles.modalTitle}>Choose four quick routes</Text>
            <Text style={styles.shortcutModalIntro}>Your choices follow your account across devices. Use the arrows to set their order.</Text>

            <View style={styles.selectedShortcuts}>
              {draftShortcutIds.map((shortcutId, index) => {
                const shortcut = HOME_SHORTCUTS[shortcutId];
                return (
                  <View key={shortcutId} style={styles.selectedShortcutRow}>
                    <Text style={styles.selectedShortcutNumber}>{index + 1}</Text>
                    <Ionicons name={shortcut.icon} size={16} color={appColors.accent} />
                    <Text style={styles.selectedShortcutLabel}>{shortcut.label}</Text>
                    <TouchableOpacity disabled={index === 0} style={styles.reorderButton} onPress={() => moveDraftShortcut(index, -1)}>
                      <Ionicons name="chevron-up" size={16} color={index === 0 ? appColors.textDisabled : appColors.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity disabled={index === draftShortcutIds.length - 1} style={styles.reorderButton} onPress={() => moveDraftShortcut(index, 1)}>
                      <Ionicons name="chevron-down" size={16} color={index === draftShortcutIds.length - 1 ? appColors.textDisabled : appColors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            <Text style={styles.shortcutChoiceLabel}>AVAILABLE ROUTES · {draftShortcutIds.length}/4 SELECTED</Text>
            <ScrollView style={styles.shortcutChoiceList} contentContainerStyle={styles.shortcutChoiceGrid}>
              {(Object.keys(HOME_SHORTCUTS) as HomeShortcutId[]).map(shortcutId => {
                const shortcut = HOME_SHORTCUTS[shortcutId];
                const selected = draftShortcutIds.includes(shortcutId);
                return (
                  <TouchableOpacity
                    key={shortcutId}
                    style={[styles.shortcutChoice, selected && styles.shortcutChoiceSelected]}
                    onPress={() => toggleDraftShortcut(shortcutId)}
                  >
                    <Ionicons name={shortcut.icon} size={17} color={selected ? appColors.accent : appColors.textMuted} />
                    <Text style={[styles.shortcutChoiceText, selected && styles.shortcutChoiceTextSelected]}>{shortcut.label}</Text>
                    <Ionicons name={selected ? 'checkmark-circle' : 'add-circle-outline'} size={17} color={selected ? appColors.accent : appColors.textDisabled} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.shortcutModalActions}>
              <TouchableOpacity style={styles.shortcutResetButton} onPress={() => setDraftShortcutIds(DEFAULT_HOME_SHORTCUTS)}>
                <Text style={styles.shortcutResetText}>RESET</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shortcutCancelButton} onPress={() => setShortcutPickerOpen(false)}>
                <Text style={styles.shortcutCancelText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.shortcutSaveButton, (draftShortcutIds.length !== 4 || shortcutsSaving) && styles.shortcutSaveButtonDisabled]}
                disabled={draftShortcutIds.length !== 4 || shortcutsSaving}
                onPress={() => void persistShortcuts()}
              >
                {shortcutsSaving ? <ActivityIndicator size="small" color={appColors.accentForeground} /> : <Text style={styles.shortcutSaveText}>SAVE</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (appColors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: appColors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: appSpacing.md, backgroundColor: appColors.background },
  loadingText: { ...appTypography.body, color: appColors.textMuted },
  scrollContent: { padding: appSpacing.md, paddingBottom: 36 },
  scrollContentMobile: { flexGrow: 1, padding: appSpacing.sm, paddingBottom: appSpacing.sm },
  page: { width: '100%', gap: appSpacing.md },
  pageMobile: { flex: 1, gap: appSpacing.sm },
  pageDesktop: { maxWidth: 1180, alignSelf: 'center', gap: appSpacing.lg },
  leagueBar: { minHeight: 68, flexDirection: 'row', alignItems: 'center', paddingHorizontal: appSpacing.lg, paddingVertical: appSpacing.md, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  leagueBarMobile: { minHeight: 54, paddingHorizontal: appSpacing.md, paddingVertical: appSpacing.sm, borderRadius: appRadius.medium },
  leagueIdentity: { flex: 1, minWidth: 0 },
  eyebrow: { ...appTypography.label, color: appColors.accent, fontSize: 9 },
  leagueSelector: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  leagueName: { ...appTypography.screenTitle, flexShrink: 1, color: appColors.textPrimary },
  leagueMeta: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 3 },
  settingsButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, backgroundColor: appColors.accentSoft, borderWidth: 1, borderColor: appColors.accentBorder, borderRadius: appRadius.medium },
  settingsText: { ...appTypography.label, color: appColors.accent },
  leagueActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorBanner: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: appSpacing.md, backgroundColor: appColors.dangerSoft, borderWidth: 1, borderColor: appColors.dangerBorder, borderRadius: appRadius.medium },
  errorText: { ...appTypography.body, flex: 1, color: appColors.danger },
  announcementStrip: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: appSpacing.md, backgroundColor: appColors.accentSoft, borderWidth: 1, borderColor: appColors.accentBorder, borderRadius: appRadius.medium },
  announcementStripUrgent: { backgroundColor: appColors.dangerSoft, borderColor: appColors.dangerBorder },
  announcementStripCopy: { flex: 1, minWidth: 0 },
  announcementStripTitle: { color: appColors.accent, fontSize: 10, fontWeight: '900' },
  announcementStripTitleUrgent: { color: appColors.danger },
  announcementStripBody: { ...appTypography.metadata, color: appColors.textSecondary, marginTop: 1 },
  chronicleStrip: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: appSpacing.md, backgroundColor: appColors.warningSoft, borderWidth: 1, borderColor: `${appColors.warning}55`, borderRadius: appRadius.medium },
  chronicleIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.surface, borderRadius: appRadius.small },
  chronicleCopy: { flex: 1, minWidth: 0 },
  chronicleLabel: { ...appTypography.label, color: appColors.warning, fontSize: 7 },
  chronicleTitle: { color: appColors.textPrimary, fontSize: 10, fontWeight: '900', marginTop: 2 },
  chronicleRead: { ...appTypography.label, color: appColors.warning, fontSize: 8 },
  draftSection: { overflow: 'hidden', borderRadius: appRadius.large },
  draftLiveCard: { padding: appSpacing.xl, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.accentBorder, borderRadius: appRadius.large },
  draftLiveBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginBottom: 9 },
  draftLiveBadgeText: { ...appTypography.label, color: appColors.accent },
  draftLiveTitle: { ...appTypography.screenTitle, color: appColors.textPrimary },
  draftLiveMeta: { ...appTypography.body, color: appColors.textMuted, marginTop: 5 },
  heroGrid: { gap: appSpacing.md },
  heroGridDesktop: { flexDirection: 'row', alignItems: 'stretch' },
  fixtureCard: { minHeight: 205, padding: appSpacing.lg, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  fixtureCardDesktop: { flex: 1.65 },
  deadlineCard: { minHeight: 190, padding: appSpacing.lg, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  deadlineCardDesktop: { flex: 1 },
  cardHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: appSpacing.md },
  cardHeading: { ...appTypography.sectionTitle, color: appColors.textPrimary, fontSize: 15, letterSpacing: 0 },
  statePill: { minHeight: 25, justifyContent: 'center', paddingHorizontal: 9, backgroundColor: appColors.surfaceMuted, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.pill },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: appColors.dangerSoft, borderColor: appColors.dangerBorder },
  statePillText: { ...appTypography.label, color: appColors.textMuted, fontSize: 8 },
  livePillText: { color: appColors.danger },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: appColors.danger },
  scoreboard: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: appSpacing.lg },
  teamBlock: { flex: 1, minWidth: 0 },
  awayTeamBlock: { alignItems: 'flex-end' },
  teamRole: { ...appTypography.label, color: appColors.textMuted, fontSize: 8, marginBottom: 4 },
  teamName: { color: appColors.textPrimary, fontSize: 14, fontWeight: '900' },
  awayTeamName: { textAlign: 'right' },
  scoreBlock: { width: 118, alignItems: 'center', paddingHorizontal: 5 },
  scoreText: { color: appColors.textPrimary, fontSize: 31, fontWeight: '900', letterSpacing: -1 },
  versusText: { color: appColors.accent, fontSize: 18, fontWeight: '900' },
  scoreMeta: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 3, textAlign: 'center' },
  emptyFixture: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: appSpacing.md, paddingVertical: appSpacing.xl },
  emptyFixtureCopy: { flex: 1 },
  emptyFixtureTitle: { ...appTypography.sectionTitle, color: appColors.textPrimary },
  emptyFixtureMeta: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 3 },
  cardLinkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: appColors.borderSubtle },
  cardLinkText: { ...appTypography.label, color: appColors.accent, fontSize: 9 },
  deadlineIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  deadlineStatus: { ...appTypography.label, color: appColors.textMuted, fontSize: 8 },
  deadlineGameweek: { ...appTypography.label, color: appColors.textSecondary, marginTop: appSpacing.lg },
  deadlineCountdown: { color: appColors.accent, fontSize: 25, fontWeight: '900', marginTop: 3 },
  deadlineCountdownLocked: { color: appColors.warning },
  deadlineDate: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 3 },
  inlineAction: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 'auto', paddingHorizontal: 12, backgroundColor: appColors.accentFill, borderRadius: appRadius.small },
  inlineActionText: { ...appTypography.label, color: appColors.accentForeground },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 2 },
  sectionEyebrow: { ...appTypography.label, color: appColors.textMuted, fontSize: 8 },
  sectionHeading: { ...appTypography.sectionTitle, color: appColors.textPrimary, fontSize: 15, letterSpacing: 0, marginTop: 2 },
  summaryGrid: { gap: appSpacing.sm },
  summaryGridDesktop: { flexDirection: 'row' },
  summaryCard: { minHeight: 75, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: appSpacing.md, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  summaryIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.backgroundDeep, borderWidth: 1, borderRadius: appRadius.medium },
  summaryCopy: { flex: 1, minWidth: 0 },
  summaryLabel: { ...appTypography.label, color: appColors.textMuted, fontSize: 8 },
  summaryValue: { color: appColors.textPrimary, fontSize: 13, fontWeight: '900', marginTop: 2 },
  summaryMeta: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 2 },
  lowerGrid: { gap: appSpacing.md },
  lowerGridDesktop: { flexDirection: 'row', alignItems: 'stretch' },
  standingsCard: { padding: appSpacing.lg, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  standingsCardDesktop: { flex: 1.3 },
  quickCard: { padding: appSpacing.lg, gap: appSpacing.md, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  quickCardDesktop: { flex: 1 },
  textLink: { ...appTypography.label, color: appColors.accent, fontSize: 9 },
  standingRow: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: appColors.borderSubtle },
  myStandingRow: { backgroundColor: appColors.accentSoft, borderRadius: appRadius.small },
  standingRank: { width: 18, color: appColors.textMuted, fontSize: 12, fontWeight: '900' },
  standingTeam: { flex: 1, minWidth: 0 },
  standingName: { color: appColors.textPrimary, fontSize: 12, fontWeight: '800' },
  standingRecord: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 2 },
  standingPoints: { color: appColors.accent, fontSize: 15, fontWeight: '900' },
  emptyText: { ...appTypography.body, color: appColors.textMuted, paddingVertical: appSpacing.xl, textAlign: 'center' },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: appSpacing.sm },
  quickAction: { width: '48%', minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, backgroundColor: appColors.backgroundDeep, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  quickActionText: { ...appTypography.metadata, flex: 1, color: appColors.textSecondary },
  activityCard: { padding: appSpacing.lg, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  activityRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: appColors.borderSubtle },
  activityIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: appRadius.medium },
  activityCopy: { flex: 1, minWidth: 0 },
  activityTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  activityCategory: { ...appTypography.label, fontSize: 8 },
  activityGameweek: { ...appTypography.metadata, color: appColors.textMuted, fontSize: 9 },
  activityTitle: { color: appColors.textPrimary, fontSize: 12, fontWeight: '800', marginTop: 1 },
  activityMovement: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 2 },
  activityTime: { ...appTypography.metadata, color: appColors.textMuted, textAlign: 'right' },
  activityEmpty: { minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderTopWidth: 1, borderTopColor: appColors.borderSubtle },
  mobileDashboard: { flex: 1, gap: appSpacing.sm },
  mobileMatchCard: { overflow: 'hidden', backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  mobileMatchPressArea: { backgroundColor: appColors.surface },
  mobileMatchHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: appSpacing.md, paddingTop: appSpacing.md },
  mobileGameweek: { ...appTypography.sectionTitle, color: appColors.textPrimary, fontSize: 13, letterSpacing: 0, marginTop: 2 },
  mobileScoreboard: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: appSpacing.md, paddingVertical: appSpacing.sm },
  mobileTeamBlock: { flex: 1, minWidth: 0 },
  mobileTeamName: { color: appColors.textPrimary, fontSize: 12, fontWeight: '900' },
  mobileScoreBlock: { width: 78, minWidth: 78, alignItems: 'center' },
  mobileScoreText: { width: '100%', color: appColors.textPrimary, fontSize: 20, lineHeight: 24, fontWeight: '900', textAlign: 'center' },
  mobileVersusText: { color: appColors.accent, fontSize: 15, fontWeight: '900' },
  mobileFixtureEmpty: { ...appTypography.metadata, color: appColors.textMuted, padding: appSpacing.lg, textAlign: 'center' },
  mobileDeadlineRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: appSpacing.md, paddingVertical: 7, backgroundColor: appColors.backgroundDeep, borderTopWidth: 1, borderTopColor: appColors.borderSubtle },
  mobileDeadlineCopy: { flex: 1 },
  mobileDeadlineLabel: { ...appTypography.label, color: appColors.textMuted, fontSize: 7 },
  mobileDeadlineValue: { color: appColors.accent, fontSize: 12, fontWeight: '900', marginTop: 1 },
  mobileEditButton: { minHeight: 28, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, backgroundColor: appColors.accentFill, borderRadius: appRadius.small },
  mobileEditButtonText: { ...appTypography.label, color: appColors.accentForeground, fontSize: 8 },
  mobileStatusStrip: { flexDirection: 'row', overflow: 'hidden', backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  mobileStatusItem: { minHeight: 51, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 8, borderRightWidth: 1, borderRightColor: appColors.borderSubtle },
  mobileStatusItemLast: { borderRightWidth: 0 },
  mobileStatusLabel: { ...appTypography.label, color: appColors.textMuted, fontSize: 7 },
  mobileStatusValue: { color: appColors.textPrimary, fontSize: 10, fontWeight: '900', marginTop: 1 },
  mobileSwitchCard: { flex: 1, minHeight: 142, overflow: 'hidden', backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  mobileSegments: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: appColors.borderSubtle },
  mobileSegment: { minHeight: 32, flex: 1, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  mobileSegmentActive: { borderBottomColor: appColors.accent },
  mobileSegmentText: { ...appTypography.label, color: appColors.textMuted, fontSize: 8 },
  mobileSegmentTextActive: { color: appColors.accent },
  mobilePanelBody: { flex: 1, paddingHorizontal: appSpacing.sm },
  mobilePanelEmpty: { ...appTypography.metadata, color: appColors.textMuted, paddingVertical: appSpacing.lg, textAlign: 'center' },
  mobileStandingRow: { minHeight: 36, maxHeight: 52, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 7, borderBottomWidth: 1, borderBottomColor: appColors.borderSubtle },
  mobileStandingName: { flex: 1, color: appColors.textPrimary, fontSize: 11, fontWeight: '800' },
  mobileActivityRow: { minHeight: 43, maxHeight: 58, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 7, borderBottomWidth: 1, borderBottomColor: appColors.borderSubtle },
  mobileActivityTitle: { color: appColors.textPrimary, fontSize: 10, fontWeight: '800' },
  mobileQuickSection: { gap: 5 },
  mobileQuickHeading: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mobileQuickGrid: { flexDirection: 'row', gap: 6 },
  mobileQuickAction: { minHeight: 50, flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 3, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.small },
  mobileQuickIcon: { position: 'relative' },
  mobileQuickText: { ...appTypography.metadata, color: appColors.textSecondary, fontSize: 8, textAlign: 'center' },
  desktopShortcutIcon: { position: 'relative' },
  shortcutBadge: { position: 'absolute', top: -8, right: -12, minWidth: 18, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, backgroundColor: appColors.danger, borderRadius: appRadius.pill },
  shortcutBadgeText: { color: '#FFFFFF', fontSize: 7, fontWeight: '900' },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: appSpacing.lg, backgroundColor: 'rgba(0,0,0,0.82)' },
  modalCard: { width: '100%', maxWidth: 480, maxHeight: '75%', padding: appSpacing.lg, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.borderStrong, borderRadius: appRadius.large },
  modalEyebrow: { ...appTypography.label, color: appColors.accent },
  modalTitle: { ...appTypography.screenTitle, color: appColors.textPrimary, marginTop: 3, marginBottom: appSpacing.md },
  leagueList: { flexGrow: 0 },
  leagueOption: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: appSpacing.sm, paddingHorizontal: appSpacing.md, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  leagueOptionActive: { backgroundColor: appColors.accentSoft, borderColor: appColors.accentBorder },
  leagueOptionCopy: { flex: 1 },
  leagueOptionName: { color: appColors.textPrimary, fontSize: 13, fontWeight: '900' },
  leagueOptionMeta: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 2 },
  modalClose: { minHeight: 40, alignItems: 'center', justifyContent: 'center', marginTop: appSpacing.sm, backgroundColor: appColors.surfaceMuted, borderRadius: appRadius.small },
  modalCloseText: { ...appTypography.label, color: appColors.textSecondary },
  createAnotherLeagueButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: appSpacing.sm, backgroundColor: appColors.accentFill, borderWidth: 1, borderColor: appColors.accent, borderRadius: appRadius.small },
  createAnotherLeagueText: { ...appTypography.label, color: appColors.accentForeground },
  joinAnotherLeagueButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: appSpacing.sm, backgroundColor: appColors.accentSoft, borderWidth: 1, borderColor: appColors.accentBorder, borderRadius: appRadius.small },
  joinAnotherLeagueText: { ...appTypography.label, color: appColors.accent },
  shortcutModalCard: { width: '100%', maxWidth: 520, maxHeight: '88%', padding: appSpacing.lg, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.borderStrong, borderRadius: appRadius.large },
  shortcutModalIntro: { ...appTypography.metadata, color: appColors.textMuted, marginTop: -8, marginBottom: appSpacing.md },
  selectedShortcuts: { overflow: 'hidden', borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  selectedShortcutRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: appSpacing.sm, backgroundColor: appColors.surface, borderBottomWidth: 1, borderBottomColor: appColors.borderSubtle },
  selectedShortcutNumber: { width: 16, color: appColors.textMuted, fontSize: 10, fontWeight: '900' },
  selectedShortcutLabel: { flex: 1, color: appColors.textPrimary, fontSize: 11, fontWeight: '800' },
  reorderButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  shortcutChoiceLabel: { ...appTypography.label, color: appColors.textMuted, fontSize: 8, marginTop: appSpacing.md, marginBottom: 6 },
  shortcutChoiceList: { flexGrow: 0, maxHeight: 205 },
  shortcutChoiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  shortcutChoice: { width: '48.5%', minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 9, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.small },
  shortcutChoiceSelected: { backgroundColor: appColors.accentSoft, borderColor: appColors.accentBorder },
  shortcutChoiceText: { ...appTypography.metadata, flex: 1, color: appColors.textMuted },
  shortcutChoiceTextSelected: { color: appColors.textPrimary },
  shortcutModalActions: { flexDirection: 'row', gap: 8, marginTop: appSpacing.md },
  shortcutResetButton: { minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11, backgroundColor: appColors.surface, borderRadius: appRadius.small },
  shortcutResetText: { ...appTypography.label, color: appColors.textMuted },
  shortcutCancelButton: { minHeight: 38, flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.surfaceMuted, borderRadius: appRadius.small },
  shortcutCancelText: { ...appTypography.label, color: appColors.textSecondary },
  shortcutSaveButton: { minHeight: 38, flex: 1.4, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.accentFill, borderRadius: appRadius.small },
  shortcutSaveButtonDisabled: { opacity: 0.45 },
  shortcutSaveText: { ...appTypography.label, color: appColors.accentForeground },
  announcementModalCard: { width: '100%', maxWidth: 520, padding: appSpacing.lg, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.accentBorder, borderRadius: appRadius.large },
  announcementModalCardUrgent: { borderColor: appColors.dangerBorder },
  announcementModalHeading: { flexDirection: 'row', alignItems: 'center', gap: appSpacing.md },
  announcementModalIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.accentSoft, borderRadius: appRadius.medium },
  announcementModalIconUrgent: { backgroundColor: appColors.dangerSoft },
  announcementModalCopy: { flex: 1, minWidth: 0 },
  announcementModalUrgentText: { color: appColors.danger },
  announcementModalTitle: { color: appColors.textPrimary, fontSize: 17, fontWeight: '900', marginTop: 2 },
  announcementModalBody: { ...appTypography.body, color: appColors.textSecondary, marginTop: appSpacing.lg },
  announcementModalMeta: { ...appTypography.metadata, color: appColors.textMuted, marginTop: appSpacing.lg },
  announcementModalActions: { flexDirection: 'row', gap: appSpacing.sm, marginTop: appSpacing.lg },
  announcementManageButton: { minHeight: 40, flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.surface, borderRadius: appRadius.small },
  announcementManageText: { ...appTypography.label, color: appColors.accent },
  announcementCloseButton: { minHeight: 40, flex: 1.4, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.accentFill, borderRadius: appRadius.small },
  announcementCloseText: { ...appTypography.label, color: appColors.accentForeground },
});
