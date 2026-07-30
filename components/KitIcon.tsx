import React from 'react';
import Svg, { Path, Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { PL_2026_27_KITS, TeamKitSpec } from '@/constants/kits';

interface KitIconProps {
  teamId: number;
  size?: number;
}

export default function KitIcon({ teamId, size = 32 }: KitIconProps) {
  const spec: TeamKitSpec = PL_2026_27_KITS[teamId] || {
    primaryColor: '#333333',
    secondaryColor: '#666666',
    accentColor: '#FFFFFF',
    patternStyle: 'SOLID',
  };

  const gradientId = `kitGrad_${teamId}`;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={spec.primaryColor} />
          <Stop offset="100%" stopColor={spec.secondaryColor} />
        </LinearGradient>
      </Defs>

      {/* Main Shirt Body Path */}
      <Path
        d="M25,25 L38,15 Q50,22 62,15 L75,25 L88,40 L72,50 L72,85 L28,85 L28,50 L12,40 Z"
        fill={spec.patternStyle === 'GRADIENT' ? `url(#${gradientId})` : spec.primaryColor}
        stroke={spec.accentColor}
        strokeWidth="2"
      />

      {/* Arsenal-style Contrast Sleeves */}
      {spec.patternStyle === 'SLEEVES' && (
        <>
          {/* Left Sleeve */}
          <Path d="M25,25 L12,40 L28,50 L30,35 Z" fill={spec.secondaryColor} />
          {/* Right Sleeve */}
          <Path d="M75,25 L88,40 L72,50 L70,35 Z" fill={spec.secondaryColor} />
        </>
      )}

      {/* Vertical Stripes (Newcastle, Bournemouth, Brentford, etc.) */}
      {spec.patternStyle === 'STRIPES' && (
        <>
          <Rect x="40" y="20" width="8" height="65" fill={spec.secondaryColor} />
          <Rect x="52" y="20" width="8" height="65" fill={spec.secondaryColor} />
        </>
      )}

      {/* Collar Accent */}
      <Path
        d="M38,15 Q50,25 62,15"
        fill="none"
        stroke={spec.accentColor || spec.secondaryColor}
        strokeWidth="3"
      />
    </Svg>
  );
}