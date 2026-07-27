export interface TeamKitSpec {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  patternStyle?: 'SOLID' | 'GRADIENT' | 'STRIPES' | 'HOOPS' | 'SLEEVES';
}

export const PL_2026_27_KITS: Record<number, TeamKitSpec> = {
  1:  { primaryColor: '#DB0007', secondaryColor: '#FFFFFF', accentColor: '#800000', patternStyle: 'SLEEVES' }, // Arsenal (Dual-tone Red body, White sleeves)
  2:  { primaryColor: '#670E36', secondaryColor: '#95B0E6', accentColor: '#FFC72C', patternStyle: 'SOLID' },    // Aston Villa (Claret & Sky)
  3:  { primaryColor: '#DA291C', secondaryColor: '#000000', accentColor: '#FFFFFF', patternStyle: 'STRIPES' },  // Bournemouth (Red/Black Stripes)
  4:  { primaryColor: '#E30613', secondaryColor: '#FFFFFF', accentColor: '#000000', patternStyle: 'STRIPES' },  // Brentford (Red/White Stripes)
  5:  { primaryColor: '#0057B8', secondaryColor: '#FFFFFF', accentColor: '#FFCD00', patternStyle: 'STRIPES' },  // Brighton (Blue/White Stripes)
  6:  { primaryColor: '#034694', secondaryColor: '#D4AF37', accentColor: '#FFFFFF', patternStyle: 'SOLID' },    // Chelsea (Royal Blue with Gold trim)
  7:  { primaryColor: '#27A8E0', secondaryColor: '#FFFFFF', accentColor: '#000000', patternStyle: 'SOLID' },    // Coventry City (Sky Blue)
  8:  { primaryColor: '#1B458F', secondaryColor: '#C41230', accentColor: '#FFFFFF', patternStyle: 'STRIPES' },  // Crystal Palace (Blue/Red Stripes)
  9:  { primaryColor: '#003399', secondaryColor: '#FFFFFF', accentColor: '#003399', patternStyle: 'SOLID' },    // Everton (Royal Blue & White)
  10: { primaryColor: '#FFFFFF', secondaryColor: '#000000', accentColor: '#CC0000', patternStyle: 'SOLID' },    // Fulham (White with Black trim)
  11: { primaryColor: '#FF9900', secondaryColor: '#000000', accentColor: '#FFFFFF', patternStyle: 'STRIPES' },  // Hull City (Amber/Black Stripes)
  12: { primaryColor: '#0000FF', secondaryColor: '#FFFFFF', accentColor: '#0000FF', patternStyle: 'SOLID' },    // Ipswich Town (Blue)
  13: { primaryColor: '#FFFFFF', secondaryColor: '#1D428A', accentColor: '#FFCD00', patternStyle: 'SOLID' },    // Leeds United (White with Blue/Yellow trim)
  14: { primaryColor: '#840028', secondaryColor: '#FFFFFF', accentColor: '#840028', patternStyle: 'SOLID' },    // Liverpool (Active Maroon/Deep Red)
  15: { primaryColor: '#6CABDD', secondaryColor: '#FFFFFF', accentColor: '#1C2C5B', patternStyle: 'GRADIENT' }, // Man City (Sky Blue fading to White)
  16: { primaryColor: '#DA291C', secondaryColor: '#FFFFFF', accentColor: '#000000', patternStyle: 'SOLID' },    // Man United (Red body with White detail)
  17: { primaryColor: '#000000', secondaryColor: '#FFFFFF', accentColor: '#241F20', patternStyle: 'STRIPES' },  // Newcastle (Black/White Stripes)
  18: { primaryColor: '#DD0000', secondaryColor: '#FFFFFF', accentColor: '#DD0000', patternStyle: 'SOLID' },    // Forest (Garibaldi Red)
  19: { primaryColor: '#EB172B', secondaryColor: '#FFFFFF', accentColor: '#000000', patternStyle: 'STRIPES' },  // Sunderland (Red/White Stripes)
  20: { primaryColor: '#FFFFFF', secondaryColor: '#132257', accentColor: '#132257', patternStyle: 'SOLID' },    // Tottenham (Lilywhite & Navy)
};