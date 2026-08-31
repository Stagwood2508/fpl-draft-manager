import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';

const BRAND_BACKGROUND = '#0A1F14';
const BRAND_PANEL = '#13263D';
const BRAND_ACCENT = '#00F27A';

export default function AppLaunchScreen() {
  const pulse = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    const progressAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );

    pulseAnimation.start();
    progressAnimation.start();

    return () => {
      pulseAnimation.stop();
      progressAnimation.stop();
    };
  }, [progress, pulse]);

  return (
    <View style={styles.container} accessibilityRole="progressbar" accessibilityLabel="Loading FPL Draft Manager">
      <View style={styles.brandBlock}>
        <Animated.View
          style={[
            styles.logoGlow,
            {
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.42] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.05] }) }],
            },
          ]}
        />
        <Image source={require('../assets/splash-icon.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>FPL DRAFT</Text>
        <Text style={styles.titleAccent}>MANAGER</Text>
        <Text style={styles.tagline}>DRAFT · TRADE · COMPETE</Text>
      </View>

      <View style={styles.loadingBlock}>
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressBar,
              {
                transform: [
                  { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-78, 78] }) },
                ],
              },
            ]}
          />
        </View>
        <Text style={styles.loadingText}>PREPARING YOUR LEAGUE</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND_BACKGROUND,
    zIndex: 999,
  },
  brandBlock: {
    alignItems: 'center',
    transform: [{ translateY: -28 }],
  },
  logoGlow: {
    position: 'absolute',
    top: 18,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: BRAND_ACCENT,
  },
  logo: {
    width: 180,
    height: 180,
    marginBottom: 10,
  },
  title: {
    color: '#F2F6F8',
    fontSize: 27,
    lineHeight: 29,
    fontWeight: '900',
    letterSpacing: 1.8,
  },
  titleAccent: {
    color: BRAND_ACCENT,
    fontSize: 27,
    lineHeight: 29,
    fontWeight: '900',
    letterSpacing: 3.2,
  },
  tagline: {
    color: '#91A59B',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2.1,
    marginTop: 13,
  },
  loadingBlock: {
    position: 'absolute',
    bottom: 68,
    alignItems: 'center',
  },
  progressTrack: {
    width: 132,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: BRAND_PANEL,
  },
  progressBar: {
    width: 54,
    height: 3,
    borderRadius: 2,
    backgroundColor: BRAND_ACCENT,
  },
  loadingText: {
    color: '#71877C',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginTop: 12,
  },
});
