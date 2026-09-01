export type GameweekPresentationState =
  | 'UPCOMING'
  | 'LIVE'
  | 'AWAITING_CONFIRMATION'
  | 'FINAL';

export interface PremierLeagueFixtureState {
  is_finished?: boolean | null;
  is_finished_provisional?: boolean | null;
}

export const resolveGameweekPresentationState = ({
  deadline,
  isFinished,
  fixtures,
  now = Date.now(),
}: {
  deadline: string | null | undefined;
  isFinished: boolean;
  fixtures: PremierLeagueFixtureState[];
  now?: number;
}): GameweekPresentationState => {
  if (isFinished) return 'FINAL';

  const deadlineTime = deadline ? new Date(deadline).getTime() : Number.NaN;
  if (!Number.isFinite(deadlineTime) || deadlineTime > now) return 'UPCOMING';

  const allFixturesComplete = fixtures.length > 0 && fixtures.every(fixture =>
    Boolean(fixture.is_finished || fixture.is_finished_provisional)
  );

  return allFixturesComplete ? 'AWAITING_CONFIRMATION' : 'LIVE';
};

