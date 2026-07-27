import { supabase } from './supabase';

// Define the shape of our internal DEFCON structures
interface DefconTier {
  threshold: number;
  points: number;
}

interface DefconConfig {
  tier_1: DefconTier;
  tier_2: DefconTier;
  tier_3: DefconTier;
}

interface MatchStatsMatrix {
  tackles: number;
  interceptions: number;
  blocks: number;
  recoveries: number;
  clearances: number;
}

/**
 * Senior DB Engineer Matrix Engine
 * Evaluates raw defensive match statistics against custom positional rulesets.
 */
export class DraftEngine {
  
  /**
   * Resolves the current structured JSONB rule vectors for a specific league.
   */
  static async fetchLeagueSettings(leagueId: string) {
    const { data, error } = await supabase
      .from('league_settings')
      .select('*')
      .eq('league_id', leagueId)
      .single();

    if (error) {
      console.error(`[ENGINE EXCEPTION] Failed to fetch settings envelope for league ${leagueId}:`, error);
      return null;
    }

    return data;
  }

  /**
   * Core Mathematical Execution Matrix
   * Accumulates actions, parses thresholds, and runs an automated linear comparison.
   */
  static calculateDefconPoints(
    playerPosition: 1 | 2 | 3 | 4, // 1: GKP, 2: DEF, 3: MID, 4: FWD
    matchStats: MatchStatsMatrix,
    leagueSettings: any
  ): number {
    if (!leagueSettings) return 0;

    // 1. Map position integers to corresponding database JSONB configuration keys
    let positionMatrix: DefconConfig;

    switch (playerPosition) {
      case 1:
        positionMatrix = leagueSettings.defcon_thresholds_gkp;
        break;
      case 2:
        positionMatrix = leagueSettings.defcon_thresholds_def;
        break;
      case 3:
        positionMatrix = leagueSettings.defcon_thresholds_mid;
        break;
      case 4:
        positionMatrix = leagueSettings.defcon_thresholds_fwd;
        break;
      default:
        return 0;
    }

    if (!positionMatrix) return 0;

    // 2. Compute the cumulative sum of tactical defensive actions
    const totalDefensiveActions = 
      (matchStats.tackles || 0) +
      (matchStats.interceptions || 0) +
      (matchStats.blocks || 0) +
      (matchStats.recoveries || 0) +
      (matchStats.clearances || 0);

    // 3. Evaluate tiers sequentially (Tier 3 down to Tier 1 to award peak points crossed)
    let assignedBonusPoints = 0;

    const { tier_1, tier_2, tier_3 } = positionMatrix;

    if (totalDefensiveActions >= tier_3.threshold) {
      assignedBonusPoints = tier_3.points;
    } else if (totalDefensiveActions >= tier_2.threshold) {
      assignedBonusPoints = tier_2.points;
    } else if (totalDefensiveActions >= tier_1.threshold) {
      assignedBonusPoints = tier_1.points;
    }

    console.log(
      `[ENGINE EVALUATION] Pos: ${playerPosition} | Actions: ${totalDefensiveActions} | Crossed Thresholds -> Points Awarded: ${assignedBonusPoints}`
    );

    return assignedBonusPoints;
  }
}