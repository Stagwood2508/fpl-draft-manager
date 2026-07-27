import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

export default function Index() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#00ff87" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' },
});