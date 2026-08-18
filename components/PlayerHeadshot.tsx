import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  type ImageProps,
  type ImageStyle,
  type StyleProp,
} from 'react-native';
import KitIcon from '@/components/KitIcon';

interface PlayerHeadshotProps {
  code?: number | null;
  photoCode?: number | null;
  teamId?: number | null;
  style?: StyleProp<ImageStyle>;
  resizeMode?: ImageProps['resizeMode'];
  fallbackSize?: number;
}

const buildHeadshotSources = (code: number) => [
  `https://resources.premierleague.com/premierleague25/photos/players/110x140/${code}.png`,
  `https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png`,
  `https://resources.premierleague.com/premierleague/photos/players/250x250/p${code}.png`,
];

export default function PlayerHeadshot({
  code,
  photoCode,
  teamId,
  style,
  resizeMode = 'contain',
  fallbackSize = 34,
}: PlayerHeadshotProps) {
  const resolvedCode = Number(photoCode || code || 0);
  const sources = useMemo(
    () => resolvedCode > 0 ? buildHeadshotSources(resolvedCode) : [],
    [resolvedCode]
  );
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => {
    setSourceIndex(0);
  }, [resolvedCode]);

  if (sourceIndex >= sources.length) {
    return <KitIcon teamId={Number(teamId || 0)} size={fallbackSize} />;
  }

  return (
    <Image
      key={`${resolvedCode}-${sourceIndex}`}
      source={{ uri: sources[sourceIndex] }}
      style={style}
      resizeMode={resizeMode}
      onError={() => setSourceIndex(current => current + 1)}
      accessibilityIgnoresInvertColors
    />
  );
}
