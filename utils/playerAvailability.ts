export interface PlayerAvailabilityInput {
  status?: string | null;
  chance_of_playing_this_round?: number | null;
  chance_of_playing_next_round?: number | null;
}

export interface PlayerAvailabilityMarker {
  label: string;
  tone: 'caution' | 'serious' | 'critical' | 'out' | 'suspended';
  backgroundColor: string;
  foregroundColor: string;
}

export const getPlayerAvailabilityMarker = (
  player: PlayerAvailabilityInput,
): PlayerAvailabilityMarker | null => {
  const status = String(player.status || 'a').toLowerCase();
  const chance = player.chance_of_playing_this_round ?? player.chance_of_playing_next_round;

  if (status === 'a' && (chance === null || chance === undefined || chance >= 100)) return null;
  if (status === 's') return { label: 'SUSP', tone: 'suspended', backgroundColor: '#6D28D9', foregroundColor: '#FFFFFF' };
  if (chance === 0) return { label: 'OUT', tone: 'out', backgroundColor: '#7F1D1D', foregroundColor: '#FFFFFF' };
  if (chance !== null && chance !== undefined && chance < 100) {
    const roundedChance = Math.max(0, Math.round(chance));
    if (roundedChance <= 25) {
      return { label: `${roundedChance}%`, tone: 'critical', backgroundColor: '#D32F2F', foregroundColor: '#FFFFFF' };
    }
    if (roundedChance <= 50) {
      return { label: `${roundedChance}%`, tone: 'serious', backgroundColor: '#F57C00', foregroundColor: '#FFFFFF' };
    }
    return { label: `${roundedChance}%`, tone: 'caution', backgroundColor: '#F4C430', foregroundColor: '#171717' };
  }
  if (status === 'd') return { label: 'DOUBT', tone: 'caution', backgroundColor: '#F4C430', foregroundColor: '#171717' };
  if (['i', 'u', 'n'].includes(status)) return { label: 'OUT', tone: 'out', backgroundColor: '#7F1D1D', foregroundColor: '#FFFFFF' };
  return { label: 'UNAV', tone: 'out', backgroundColor: '#7F1D1D', foregroundColor: '#FFFFFF' };
};
