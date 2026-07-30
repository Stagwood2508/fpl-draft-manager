export interface SquadPlayer {
  id: number;
  web_name: string;
  element_type: 'GKP' | 'DEF' | 'MID' | 'FWD';
  team_name: string;
  is_starter: boolean;
  bench_order: number | null; // 0/1 for GK sub, 1-3 for outfield subs
}

export interface FormattedPitchLayout {
  starters: {
    gkp: SquadPlayer[];
    def: SquadPlayer[];
    mid: SquadPlayer[];
    fwd: SquadPlayer[];
  };
  bench: {
    gkSub: SquadPlayer | null;
    outfieldSubs: SquadPlayer[]; // Sorted 1st, 2nd, 3rd sub (Left to Right)
  };
  isValidFormation: boolean;
  formationLabel: string; // e.g., "3-5-2", "4-4-2", "4-3-3"
}

export function arrangeSquadFormations(players: SquadPlayer[]): FormattedPitchLayout {
  const starters = players.filter((p) => p.is_starter);
  const bench = players.filter((p) => !p.is_starter);

  // Separate starters by position
  const gkpStarters = starters.filter((p) => p.element_type === 'GKP');
  const defStarters = starters.filter((p) => p.element_type === 'DEF');
  const midStarters = starters.filter((p) => p.element_type === 'MID');
  const fwdStarters = starters.filter((p) => p.element_type === 'FWD');

  // Enforce Formation Rules (1 GKP, >= 3 DEF, >= 2 MID, >= 1 FWD, Total = 11)
  const isValidFormation =
    starters.length === 11 &&
    gkpStarters.length === 1 &&
    defStarters.length >= 3 &&
    midStarters.length >= 2 &&
    fwdStarters.length >= 1;

  // Separate Bench
  const gkSub = bench.find((p) => p.element_type === 'GKP') || null;
  const outfieldSubs = bench
    .filter((p) => p.element_type !== 'GKP')
    .sort((a, b) => (a.bench_order || 99) - (b.bench_order || 99));

  return {
    starters: {
      gkp: gkpStarters,
      def: defStarters,
      mid: midStarters,
      fwd: fwdStarters,
    },
    bench: {
      gkSub,
      outfieldSubs,
    },
    isValidFormation,
    formationLabel: `${defStarters.length}-${midStarters.length}-${fwdStarters.length}`,
  };
}