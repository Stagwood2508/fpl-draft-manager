export const appColors = {
  // Main backgrounds
  background: '#06101A',
  backgroundDeep: '#030A11',
  backgroundElevated: '#091521',

  // Cards and panels
  surface: '#0D1924',
  surfaceRaised: '#122230',
  surfaceMuted: '#101C27',
  surfacePressed: '#172936',

  // Borders
  border: '#223443',
  borderStrong: '#365063',
  borderSubtle: '#172733',

  // Text
  textPrimary: '#F7FAFC',
  textSecondary: '#A7B4C2',
  textMuted: '#687887',
  textDisabled: '#465563',

  // Brand and states
  accent: '#00F27A',
  accentDark: '#00A956',
  accentSoft: 'rgba(0, 242, 122, 0.12)',
  accentBorder: 'rgba(0, 242, 122, 0.38)',

  danger: '#FF4D5E',
  dangerSoft: 'rgba(255, 77, 94, 0.12)',
  dangerBorder: 'rgba(255, 77, 94, 0.38)',

  warning: '#F5B942',
  warningSoft: 'rgba(245, 185, 66, 0.12)',

  info: '#38A7FF',
  infoSoft: 'rgba(56, 167, 255, 0.12)',

  white: '#FFFFFF',
  black: '#000000',
};

export const appSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const appRadius = {
  small: 6,
  medium: 10,
  large: 14,
  pill: 999,
};

export const appTypography = {
  screenTitle: {
    fontSize: 20,
    fontWeight: '900' as const,
    letterSpacing: -0.4,
  },

  sectionTitle: {
    fontSize: 12,
    fontWeight: '900' as const,
    letterSpacing: 0.7,
  },

  body: {
    fontSize: 13,
    fontWeight: '600' as const,
  },

  metadata: {
    fontSize: 10,
    fontWeight: '700' as const,
  },

  label: {
    fontSize: 10,
    fontWeight: '900' as const,
    letterSpacing: 0.4,
  },
};