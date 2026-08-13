import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />

        <link rel="manifest" href="/manifest.webmanifest?v=20260813" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=20260812" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png?v=20260812" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-20260813.png" />
        <meta name="theme-color" content="#0A0A0A" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: responsiveWebStyles }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveWebStyles = `
/* -------------------------------------------------------------------------- */
/* EXPO VECTOR ICONS WEB FONT DECLARATIONS                                   */
/* -------------------------------------------------------------------------- */

@font-face {
  font-family: 'Ionicons';
  src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@14.0.0/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf') format('truetype');
}

@font-face {
  font-family: 'MaterialCommunityIcons';
  src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@14.0.0/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf') format('truetype');
}

@font-face {
  font-family: 'MaterialIcons';
  src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@14.0.0/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf') format('truetype');
}

@font-face {
  font-family: 'FontAwesome';
  src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@14.0.0/build/vendor/react-native-vector-icons/Fonts/FontAwesome.ttf') format('truetype');
}

@font-face {
  font-family: 'FontAwesome5Free-Solid';
  src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@14.0.0/build/vendor/react-native-vector-icons/Fonts/FontAwesome5_Solid.ttf') format('truetype');
}

@font-face {
  font-family: 'Feather';
  src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@14.0.0/build/vendor/react-native-vector-icons/Fonts/Feather.ttf') format('truetype');
}

@font-face {
  font-family: 'Octicons';
  src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@14.0.0/build/vendor/react-native-vector-icons/Fonts/Octicons.ttf') format('truetype');
}

/* -------------------------------------------------------------------------- */
/* WEB APP NATIVE ENGINE STYLES                                               */
/* -------------------------------------------------------------------------- */

/* Disable web text selection and tap highlights to match native app feel */
* {
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
  user-select: none;
}

/* Ensure form inputs remain selectable */
input, textarea {
  user-select: text;
}

/* Prevent elastic overscroll bounces on mobile web viewports */
html, body {
  background-color: #0A0A0A;
  overflow: hidden;
  height: 100%;
}
`;
