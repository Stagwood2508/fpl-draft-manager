export interface HelpItem {
  title: string;
  body: string;
  tip?: string;
}

export interface HelpSection {
  id: string;
  title: string;
  summary: string;
  icon: string;
  keywords: string[];
  items: HelpItem[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'Create or join leagues, switch leagues and understand the main navigation.',
    icon: 'rocket-outline',
    keywords: ['account', 'create', 'join', 'invite', 'switch', 'navigation'],
    items: [
      { title: 'Create an account', body: 'Register with your email address, choose your manager identity and sign in. If you forget your password, use Reset Password on the login screen and follow the newest email link.' },
      { title: 'Create a league', body: 'Choose Create League during onboarding, or create another league from your account controls. Enter the league and team names, league size and roster format. The creator becomes commissioner.' },
      { title: 'Join a league', body: 'Open a shared invitation link or enter the commissioner’s invite code, then choose a team name. Team names must be unique within that league, but the same name can exist in a different league.' },
      { title: 'Switch active league', body: 'Tap the active league name on the Home screen and choose another membership. Squad, players, market, standings and messages then change to that league.' },
      { title: 'Main navigation', body: 'Home is your weekly overview. Squad manages your XI. Players is the scouting pool. Market contains transfer listings, waivers, trades and history. League contains standings, matches, cups and statistics.' },
    ],
  },
  {
    id: 'draft',
    title: 'The draft',
    summary: 'Prepare a watchlist, ready up, make picks and follow the draft board.',
    icon: 'flash-outline',
    keywords: ['waiting room', 'watchlist', 'pick', 'autopick', 'timer', 'snake', 'order'],
    items: [
      { title: 'Waiting room', body: 'The waiting room becomes available shortly before the scheduled draft. Managers can ready up, inspect the player pool and arrange their watchlist without making a pick.' },
      { title: 'Draft order', body: 'The commissioner can set or randomise the order before drafting begins. The draft then follows a snake order: the direction reverses after every round.' },
      { title: 'Making a pick', body: 'When it is your turn, select an eligible available player, review the confirmation and submit. The timer and turn banner show who is currently choosing.' },
      { title: 'Roster eligibility', body: 'The room removes or disables choices that cannot leave your squad within its roster limits. Strict leagues use fixed position totals. Flexible leagues permit different position combinations within the configured minimums and maximums.' },
      { title: 'Watchlist and autopicks', body: 'Add players to your watchlist and arrange them in priority order. If time expires, the system selects the highest eligible watchlisted player, then falls back to the best eligible available player.' },
      { title: 'Draft progress and completion', body: 'Recent picks and the full manager-by-round board show draft progress. When every roster is complete, use the completion actions to view your squad, full results or League Hub.' },
    ],
  },
  {
    id: 'squad',
    title: 'Squad and lineup',
    summary: 'Select a legal starting XI, order substitutes and understand lineup locking.',
    icon: 'shirt-outline',
    keywords: ['formation', 'bench', 'substitute', 'autosub', 'deadline', 'lineup', 'points'],
    items: [
      { title: 'Pitch and points views', body: 'The Squad screen shows your starting XI and four substitutes. Switch between upcoming fixtures and Gameweek points. Tap a player for availability, scoring information and transfer-list controls.' },
      { title: 'Change the starting XI', body: 'Choose Edit Lineup, select one starter and one substitute, then save. The resulting XI must contain one goalkeeper and remain within the valid defender, midfielder and forward formation limits.' },
      { title: 'Substitute priority', body: 'The reserve goalkeeper has a fixed role. Arrange the three outfield substitutes from first to third priority; that order is used when an automatic substitution is required.' },
      { title: 'Lineup deadline', body: 'Your saved lineup is locked at the Gameweek deadline. Later transfers can change your current roster, but they do not rewrite the 15-player squad already captured for an earlier Gameweek.' },
      { title: 'Automatic substitutions', body: 'When a starter’s club fixture has finished and the player recorded no minutes, eligible substitutes are considered in priority order. The replacement must have played or remain able to play, and must preserve a valid formation. Final results are confirmed at Gameweek completion.' },
    ],
  },
  {
    id: 'players',
    title: 'Players and scouting',
    summary: 'Find available players, compare statistics and use availability information.',
    icon: 'search-outline',
    keywords: ['scout', 'filter', 'sort', 'statistics', 'injury', 'availability', 'history'],
    items: [
      { title: 'Scout Pool', body: 'Search all players or use the quick position and Available filters. Sort and Filter provides club, availability and performance options, including multi-select club and availability filters.' },
      { title: 'Sorting', body: 'During the season, Total Points is the default sort. Other choices expose scoring actions and performance measures. Draft Rank remains available when you want a pre-season-style ranking.' },
      { title: 'Ownership badges', body: 'An add button means the player is available. An owner badge identifies the manager who owns the player and can be used as a route into a trade proposal.' },
      { title: 'Availability markers', body: 'The marker before a player’s name distinguishes available, doubtful and unavailable players, including their reported chance of playing. Open the player card to read the reason supplied by the player data feed.' },
      { title: 'Player card and scoring history', body: 'Open a player card for current and previous-season information, fixtures and Gameweek scoring history. The history separates the components behind the player’s points rather than showing only a total.' },
    ],
  },
  {
    id: 'waivers-free-agents',
    title: 'Waivers and free agents',
    summary: 'Submit ordered claims, understand processing and make immediate free-agent moves.',
    icon: 'swap-vertical-outline',
    keywords: ['claim', 'priority', 'drop', 'free agent', 'waiver deadline', 'cancel'],
    items: [
      { title: 'Submit a waiver claim', body: 'Choose an available player, then choose the squad player you would release if the claim succeeds. Flexible-roster leagues can exchange different outfield positions when the resulting roster remains valid.' },
      { title: 'Multiple alternatives', body: 'You may submit more than one claim for the same incoming player when each claim releases a different player. This lets you create fallback roster combinations.' },
      { title: 'Order and cancel claims', body: 'Your pending claims are processed from first priority downward. Reorder them on the Waivers screen and cancel any pending claim before the waiver deadline.' },
      { title: 'How processing works', body: 'Managers are considered in the league’s waiver order. Each manager receives at most one successful claim during a pass, then processing starts another pass for remaining claims. A failed preference moves to that manager’s next eligible claim.' },
      { title: 'Weekly priority', body: 'The first waiver order follows the league’s configured initial rule. Later Gameweeks use the league table from bottom to top; a successful claim does not permanently move a manager to the back of a rolling list.' },
      { title: 'Free agents and dropped players', body: 'After waivers close, eligible available players can be signed immediately as free agents. A league can configure waiver-dropped players to become free agents immediately or remain protected until the next waiver window.' },
    ],
  },
  {
    id: 'trades',
    title: 'Trades and transfer list',
    summary: 'Advertise players, construct offers and understand trade expiry rules.',
    icon: 'repeat-outline',
    keywords: ['offer', 'counter', 'accept', 'reject', 'void', 'transfer list', 'deadline'],
    items: [
      { title: 'Transfer list', body: 'List a player from the Market screen or directly from that player’s squad card. Add an optional note to tell other managers what type of return you are considering.' },
      { title: 'Create an offer', body: 'Open a listed player or an owned player in the Scout Pool, choose the manager, then select the players each side gives. The proposal must satisfy the league’s strict or flexible roster rules for both squads.' },
      { title: 'Respond to an offer', body: 'The receiving manager can accept, reject or counter an active offer. Pending proposals are visible only to the participating managers; completed trade records can be viewed by the league.' },
      { title: 'Deadlines and invalidated offers', body: 'A league can close trades at the waiver deadline or keep them open until the Gameweek deadline. Outstanding offers are valid only for their intended Gameweek. If a player in the proposal leaves either roster through another transaction, the offer is voided rather than substituting the replacement player.' },
    ],
  },
  {
    id: 'live-gameweek',
    title: 'Live Gameweek',
    summary: 'Follow fixtures, provisional scores, player breakdowns and final confirmation.',
    icon: 'radio-outline',
    keywords: ['live', 'match', 'score', 'bonus', 'defcon', 'fixture', 'standings'],
    items: [
      { title: 'Live matches', body: 'Open Live Matches from Home or League Hub to see every league fixture for the selected Gameweek. Tap a matchup to inspect both managers’ complete 15-player Gameweek squads.' },
      { title: 'Player point breakdown', body: 'Tap a player in a live matchup to see the scoring components currently recorded: minutes, goals, assists, clean sheets, saves, discipline, bonus and custom DEFCON where applicable.' },
      { title: 'Provisional scoring', body: 'Live scores can change as the Premier League feed updates bonus, corrections and fixture status. Automatic substitutions may appear provisionally after club fixtures finish.' },
      { title: 'Custom DEFCON', body: 'The app calculates defensive-contribution points using that league’s three configured position tiers. The official FPL defensive-contribution award is removed so it is not counted a second time.' },
      { title: 'Gameweek completion', body: 'A Gameweek remains live until all underlying Premier League fixtures are finished and final processing completes. The app then confirms autosubs, scores, results and official league standings.' },
    ],
  },
  {
    id: 'league',
    title: 'League Hub, cups and stats',
    summary: 'Use standings, match history, custom cups, scoring rules and season records.',
    icon: 'trophy-outline',
    keywords: ['standings', 'matches', 'cup', 'stats', 'chronicle', 'rules'],
    items: [
      { title: 'Standings', body: 'Official standings show played, wins, draws, losses, fantasy points scored and league points. During an active Gameweek, the Live view includes provisional scores and positions.' },
      { title: 'Matches', body: 'Move between results, live fixtures and future fixtures, then select a Gameweek. Tap a fixture to open its lineup and detailed score view.' },
      { title: 'Cups', body: 'League commissioners can create knockout cups, choose participants and starting Gameweek, and configure tie-break rules. Managers can follow the bracket and inspect cup matchup lineups.' },
      { title: 'Statistics', body: 'League Stats provides manager season profiles, Gameweek trends, head-to-head records and player contributions using the results already stored by the app.' },
      { title: 'Chronicle and scoring rules', body: 'The Chronicle summarises completed Gameweeks. Scoring Rules displays the selected league’s actual custom point values and all three DEFCON tiers.' },
    ],
  },
  {
    id: 'lounge',
    title: 'League Lounge',
    summary: 'Chat privately with league members and share league content responsibly.',
    icon: 'chatbubbles-outline',
    keywords: ['message', 'chat', 'podcast', 'link', 'report', 'block', 'moderation'],
    items: [
      { title: 'League chat', body: 'Open the Lounge from the chat shortcut on Home. Messages belong to the selected league and are visible only to its current members.' },
      { title: 'Links and league content', body: 'Use the link action to share relevant league content such as a weekly podcast. Treat linked content as part of the conversation and follow the Community Guidelines.' },
      { title: 'Safety controls', body: 'Message options allow reporting and blocking. Commissioners can remove or pin messages. Removed messages remain marked so moderation is transparent.' },
      { title: 'Notifications', body: 'Message alerts depend on the notification preferences and permissions enabled for that device. Open Notifications & Push from Settings to review them.' },
    ],
  },
  {
    id: 'commissioner',
    title: 'Commissioner controls',
    summary: 'Configure league rules, run the draft and manage season operations.',
    icon: 'settings-outline',
    keywords: ['commissioner', 'settings', 'rules', 'reset', 'rehearsal', 'announcement'],
    items: [
      { title: 'League configuration', body: 'Before the draft, the commissioner can configure the schedule, draft clock, roster type, waiver rules, trade cutoff, dropped-player treatment, scoring and DEFCON tiers.' },
      { title: 'Settings lock', body: 'Core rules lock when an official draft begins, protecting every manager from mid-season rule changes. Recovery controls exist for accidental or test drafts, but resets should be used with care.' },
      { title: 'Draft controls', body: 'Commissioner controls include setting or randomising draft order and operational recovery tools such as pausing, resuming, extending or resolving a current turn where supported.' },
      { title: 'Announcements', body: 'League announcements appear within the app and can generate notifications for managers who have enabled them.' },
      { title: 'Gameweek rehearsal', body: 'The controlled rehearsal tool is intended for test data. It exercises deadlines, scoring, autosubs and transaction processing with rollback and reconciliation reporting; it is not a substitute for normal live processing.' },
    ],
  },
  {
    id: 'notifications-account',
    title: 'Notifications and account',
    summary: 'Manage push alerts, appearance, identity, feedback and account deletion.',
    icon: 'person-circle-outline',
    keywords: ['push', 'settings', 'profile', 'team name', 'password', 'privacy', 'delete'],
    items: [
      { title: 'Notifications', body: 'The bell opens your in-app notification history. Settings → Notifications & Push controls categories and device push registration. Android also requires notification permission in the device settings.' },
      { title: 'Profile and team names', body: 'My Profile controls your manager nickname, password and team names. Each team name can be changed up to three times for its league season and must remain unique within that league.' },
      { title: 'Light and dark mode', body: 'Use the appearance switch in Settings. Your preference is stored on the device.' },
      { title: 'Feedback and errors', body: 'Use Tester Feedback to describe a problem or suggestion. If the app records an unexpected failure, include what you were doing and the approximate time so the report can be matched.' },
      { title: 'Privacy and deletion', body: 'Privacy & Account explains stored information and links to account deletion. Deletion permanently removes the account and directly associated personal app data, so review the warning before confirming.' },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    summary: 'Quick checks for stale data, missing push alerts and interrupted actions.',
    icon: 'help-buoy-outline',
    keywords: ['error', 'refresh', 'reconnect', 'missing', 'stuck', 'support'],
    items: [
      { title: 'Information looks out of date', body: 'Pull down to refresh where available, confirm the correct active league and reopen the screen. Live scoring can remain provisional while the upstream fixture feed is still changing.' },
      { title: 'A draft or transaction was interrupted', body: 'Wait for the connection indicator to recover, then refresh before trying again. Server validation prevents the same confirmed pick or transaction being applied twice.' },
      { title: 'Push notification did not arrive', body: 'Check Notifications & Push in the app, Android notification permission, battery restrictions and whether the installed build is registered. The same event may still appear in the in-app bell.' },
      { title: 'A player or action is unavailable', body: 'Check the current Gameweek phase, deadline, roster limits and player availability. Open the player card or transaction screen for the most specific eligibility message.' },
      { title: 'Still need help?', body: 'Send a Tester Feedback report with the screen, league, time and exact action. Do not include your password or private authentication links.' },
    ],
  },
];

