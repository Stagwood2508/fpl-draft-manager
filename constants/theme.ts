export const darkAppColors = {
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
  accentFill: '#00F27A',
  accentForeground: '#06100B',
  accentSoft: 'rgba(0, 242, 122, 0.12)',
  accentBorder: 'rgba(0, 242, 122, 0.38)',

  pitch: '#0D3C25',
  pitchLine: '#B8D5C3',
  pitchBorder: '#316248',
  pitchPlayerSurface: 'rgba(2, 10, 7, 0.18)',
  pitchPlayerNameSurface: 'rgba(1, 7, 5, 0.84)',
  pitchPlayerNameText: '#F7FAFC',

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

export type AppColors = typeof darkAppColors;

export const lightAppColors: AppColors = {
  // Cool Stadium: neutral page chrome, crisp cards and firmer visual hierarchy.
  background: '#F1F5F7',
  backgroundDeep: '#E6EDF1',
  backgroundElevated: '#FFFFFF',

  surface: '#FFFFFF',
  surfaceRaised: '#F6F9FA',
  surfaceMuted: '#E7EEF2',
  surfacePressed: '#D9E4E9',

  border: '#B9CAD3',
  borderStrong: '#91A8B4',
  borderSubtle: '#D4E0E5',

  textPrimary: '#0A2232',
  textSecondary: '#334F5F',
  textMuted: '#57707E',
  textDisabled: '#8B9DA7',

  accent: '#087A59',
  accentDark: '#055C43',
  accentFill: '#57D4A7',
  accentForeground: '#063B2C',
  accentSoft: 'rgba(8, 122, 89, 0.11)',
  accentBorder: 'rgba(8, 122, 89, 0.40)',

  pitch: '#8ED7AD',
  pitchLine: '#55AD7D',
  pitchBorder: '#55AD7D',
  pitchPlayerSurface: 'rgba(255, 255, 255, 0.70)',
  pitchPlayerNameSurface: 'rgba(255, 255, 255, 0.94)',
  pitchPlayerNameText: '#073A2B',

  danger: '#C73545',
  dangerSoft: 'rgba(199, 53, 69, 0.10)',
  dangerBorder: 'rgba(199, 53, 69, 0.30)',

  warning: '#A86B00',
  warningSoft: 'rgba(168, 107, 0, 0.10)',

  info: '#147AC2',
  infoSoft: 'rgba(20, 122, 194, 0.10)',

  white: '#FFFFFF',
  black: '#000000',
};

// Compatibility export for legacy screens while they are migrated to
// useAppTheme(). New and updated screens should use the dynamic palette.
export const appColors = darkAppColors;
