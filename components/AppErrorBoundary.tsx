import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { reportAppError } from '@/utils/errorReporting';

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void reportAppError(error, {
      errorType: 'REACT_RENDER',
      metadata: { componentStack: info.componentStack?.slice(0, 12000) },
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>
          The error has been recorded. You can safely try loading the app again.
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => this.setState({ failed: false })}>
          <Text style={styles.buttonText}>TRY AGAIN</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07131C', alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', textTransform: 'uppercase' },
  message: { color: '#A8B4BC', fontSize: 14, textAlign: 'center', lineHeight: 21, marginTop: 12, maxWidth: 440 },
  button: { backgroundColor: '#00F27A', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 6, marginTop: 24 },
  buttonText: { color: '#00150B', fontSize: 13, fontWeight: '900' },
});
