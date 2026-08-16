const DEFAULT_PUBLIC_APP_URL = 'https://fpl-draft-manager.vercel.app';

export const buildLeagueInviteLink = (inviteCode: string) => {
  const configuredBaseUrl = process.env.EXPO_PUBLIC_APP_URL?.trim();
  const baseUrl = (configuredBaseUrl || DEFAULT_PUBLIC_APP_URL).replace(/\/$/, '');
  return `${baseUrl}/join-league?inviteCode=${encodeURIComponent(inviteCode.trim().toUpperCase())}`;
};

