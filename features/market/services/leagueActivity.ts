import { supabase } from '@/utils/supabase';

export type LeagueActivityCategory = 'WAIVER' | 'FREE_AGENT' | 'TRADE';

export interface LeagueActivityPlayer {
  id?: number;
  web_name?: string | null;
  element_type?: string | null;
  team_short_name?: string | null;
  team_name?: string | null;
}

export interface LeagueActivityItem {
  id: string;
  category: LeagueActivityCategory;
  status: string;
  timestamp: string;
  gameweek?: number | null;
  title: string;
  subtitle: string;
  managerIds: string[];
  playersIn: LeagueActivityPlayer[];
  playersOut: LeagueActivityPlayer[];
  failureReason?: string | null;
}

interface MemberSummary {
  user_id: string;
  team_name: string | null;
}

const firstRelation = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const normalizeStatus = (status?: string | null) => (status || 'RECORDED').toUpperCase();

export const isCompletedActivityStatus = (status: string) =>
  ['SUCCESSFUL', 'ACCEPTED', 'COMPLETED', 'PROCESSED'].includes(status);

export async function getLeagueActivity(leagueId: string, perSourceLimit?: number): Promise<LeagueActivityItem[]> {
  let waiverQuery = supabase
    .from('waiver_claims')
    .select(`
      id, user_id, gameweek, status, failure_reason, processed_at, priority_order,
      player_to_add:players!waiver_claims_player_to_add_fkey (
        id, web_name, element_type, team_short_name, team_name
      ),
      player_to_drop:players!waiver_claims_player_to_drop_fkey (
        id, web_name, element_type, team_short_name, team_name
      )
    `)
    .eq('league_id', leagueId)
    .neq('status', 'pending')
    .order('processed_at', { ascending: false });

  let transactionQuery = supabase
    .from('transactions')
    .select(`
      id, type, status, created_at, sender_id, receiver_id, parent_transaction_id,
      player_in:players!transactions_player_in_id_fkey (
        id, web_name, element_type, team_short_name, team_name
      ),
      player_out:players!transactions_player_out_id_fkey (
        id, web_name, element_type, team_short_name, team_name
      )
    `)
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false });

  let freeAgentQuery = supabase
    .from('free_agent_transactions')
    .select(`
      id, user_id, gameweek, completed_at,
      player_in:players!free_agent_transactions_player_in_id_fkey (
        id, web_name, element_type, team_short_name, team_name
      ),
      player_out:players!free_agent_transactions_player_out_id_fkey (
        id, web_name, element_type, team_short_name, team_name
      )
    `)
    .eq('league_id', leagueId)
    .order('completed_at', { ascending: false });

  if (perSourceLimit) {
    waiverQuery = waiverQuery.limit(perSourceLimit);
    transactionQuery = transactionQuery.limit(perSourceLimit);
    freeAgentQuery = freeAgentQuery.limit(perSourceLimit);
  }

  const [membersResponse, waiverResponse, transactionResponse, freeAgentResponse] = await Promise.all([
    supabase.from('league_members').select('user_id, team_name').eq('league_id', leagueId),
    waiverQuery,
    transactionQuery,
    freeAgentQuery,
  ]);

  if (membersResponse.error) throw membersResponse.error;
  if (waiverResponse.error) throw waiverResponse.error;
  if (transactionResponse.error) throw transactionResponse.error;

  const memberMap = new Map(
    ((membersResponse.data || []) as MemberSummary[]).map(member => [
      member.user_id,
      member.team_name || 'Unnamed team',
    ])
  );

  const waiverActivities: LeagueActivityItem[] = (waiverResponse.data || []).map((row: any) => {
    const status = normalizeStatus(row.status);
    const teamName = memberMap.get(row.user_id) || 'Unnamed team';
    const playerIn = firstRelation<LeagueActivityPlayer>(row.player_to_add);
    const playerOut = firstRelation<LeagueActivityPlayer>(row.player_to_drop);
    return {
      id: `waiver-${row.id}`,
      category: 'WAIVER',
      status,
      timestamp: row.processed_at || new Date(0).toISOString(),
      gameweek: row.gameweek,
      title: isCompletedActivityStatus(status) ? `${teamName} completed a waiver` : `${teamName}'s waiver was unsuccessful`,
      subtitle: row.priority_order ? `Claim priority ${row.priority_order}` : 'Waiver claim',
      managerIds: [row.user_id],
      playersIn: playerIn ? [playerIn] : [],
      playersOut: playerOut ? [playerOut] : [],
      failureReason: row.failure_reason,
    };
  });

  const transactionGroups = new Map<string, any[]>();
  (transactionResponse.data || []).forEach((row: any) => {
    const rawType = String(row.type || '').toUpperCase();
    const groupKey = rawType === 'TRADE' ? row.parent_transaction_id || row.id : row.id;
    transactionGroups.set(groupKey, [...(transactionGroups.get(groupKey) || []), row]);
  });

  const ledgerActivities: LeagueActivityItem[] = Array.from(transactionGroups.entries()).map(([groupKey, rows]) => {
    const first = rows[0];
    const rawType = String(first.type || '').toUpperCase();
    const category: LeagueActivityCategory = rawType === 'TRADE' ? 'TRADE' : rawType === 'WAIVER' ? 'WAIVER' : 'FREE_AGENT';
    const senderName = memberMap.get(first.sender_id) || 'A manager';
    const receiverName = first.receiver_id ? memberMap.get(first.receiver_id) || 'another manager' : null;
    return {
      id: `transaction-${groupKey}`,
      category,
      status: normalizeStatus(first.status),
      timestamp: first.created_at || new Date(0).toISOString(),
      title: category === 'TRADE' ? `${senderName} and ${receiverName || 'another manager'}` : `${senderName} signed a free agent`,
      subtitle: category === 'TRADE' ? `${rows.length}-player trade package` : 'Immediate squad transaction',
      managerIds: [first.sender_id, first.receiver_id].filter(Boolean),
      playersIn: rows.map(row => firstRelation<LeagueActivityPlayer>(row.player_in)).filter((player): player is LeagueActivityPlayer => Boolean(player)),
      playersOut: rows.map(row => firstRelation<LeagueActivityPlayer>(row.player_out)).filter((player): player is LeagueActivityPlayer => Boolean(player)),
    };
  });

  const freeAgentActivities: LeagueActivityItem[] = (freeAgentResponse.error ? [] : freeAgentResponse.data || []).map((row: any) => {
    const playerIn = firstRelation<LeagueActivityPlayer>(row.player_in);
    const playerOut = firstRelation<LeagueActivityPlayer>(row.player_out);
    return {
      id: `free-agent-${row.id}`,
      category: 'FREE_AGENT',
      status: 'COMPLETED',
      timestamp: row.completed_at,
      gameweek: row.gameweek,
      title: `${memberMap.get(row.user_id) || 'Unnamed team'} signed a free agent`,
      subtitle: 'Immediate squad transaction',
      managerIds: [row.user_id],
      playersIn: playerIn ? [playerIn] : [],
      playersOut: playerOut ? [playerOut] : [],
    };
  });

  return [...waiverActivities, ...ledgerActivities, ...freeAgentActivities].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}
