import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  StatusBar,
  SafeAreaView,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useDebugCrashStore } from '../../store/debugCrashStore';

export default function DebugCrashModal() {
  if (!__DEV__) return null;

  const { activeCrash, showCrashModal, clearActiveCrash } = useDebugCrashStore();
  const [copied, setCopied] = useState(false);

  if (!showCrashModal || !activeCrash) return null;

  const handleCopy = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const fullLog = `[CRASH REPORT - MYCIRCLE]
Source: ${activeCrash.source}
Fatal: ${activeCrash.isFatal ? 'YES' : 'NO'}
Time: ${new Date(activeCrash.timestamp).toLocaleTimeString()}
Message: ${activeCrash.message}

Stack:
${activeCrash.stack || 'No stack trace available'}

Component Stack:
${activeCrash.componentStack || 'None'}
`;
    try {
      await Clipboard.setStringAsync(fullLog);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {
      Alert.alert('Copy Failed', 'Unable to copy to clipboard.');
    }
  };

  const handleDismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    clearActiveCrash();
  };

  return (
    <Modal
      visible={showCrashModal}
      animationType="slide"
      transparent={false}
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#09090b" />
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, activeCrash.isFatal ? styles.fatalBadge : styles.errorBadge]}>
                <Text style={styles.badgeText}>
                  {activeCrash.isFatal ? '⚠️ FATAL CRASH CAUGHT' : '⚠️ APPLICATION ERROR'}
                </Text>
              </View>
              <Text style={styles.timeText}>
                {new Date(activeCrash.timestamp).toLocaleTimeString()}
              </Text>
            </View>
            <Text style={styles.title}>Crash Debug View</Text>
            <Text style={styles.subtitle}>
              The app caught this error and prevented the process from closing.
            </Text>
          </View>

          {/* Error Message Box */}
          <View style={styles.messageBox}>
            <Text style={styles.sourceLabel}>SOURCE: {activeCrash.source}</Text>
            <ScrollView style={styles.messageScroll} nestedScrollEnabled>
              <Text style={styles.messageText} selectable>
                {activeCrash.message}
              </Text>
            </ScrollView>
          </View>

          {/* Stack Trace Box */}
          <View style={styles.stackBox}>
            <Text style={styles.stackLabel}>STACK TRACE</Text>
            <ScrollView style={styles.stackScroll} nestedScrollEnabled>
              <Text style={styles.stackText} selectable>
                {activeCrash.stack || activeCrash.componentStack || 'No detailed stack trace available for this error.'}
              </Text>
            </ScrollView>
          </View>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.copyBtn, pressed && styles.btnPressed]}
              onPress={handleCopy}
            >
              <Text style={styles.copyBtnText}>
                {copied ? '✅ COPIED TO CLIPBOARD' : '📋 COPY FULL ERROR'}
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.dismissBtn, pressed && styles.btnPressed]}
              onPress={handleDismiss}
            >
              <Text style={styles.dismissBtnText}>DISMISS & STAY IN APP</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#09090b',
  },
  header: {
    marginBottom: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  fatalBadge: {
    backgroundColor: '#ef4444',
  },
  errorBadge: {
    backgroundColor: '#f59e0b',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  timeText: {
    color: '#71717a',
    fontSize: 12,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    color: '#a1a1aa',
    fontSize: 13,
    lineHeight: 18,
  },
  messageBox: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ef4444',
    maxHeight: 140,
  },
  sourceLabel: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  messageScroll: {
    maxHeight: 100,
  },
  messageText: {
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  stackBox: {
    flex: 1,
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  stackLabel: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  stackScroll: {
    flex: 1,
  },
  stackText: {
    color: '#d4d4d8',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  actions: {
    gap: 10,
  },
  copyBtn: {
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  dismissBtn: {
    backgroundColor: '#27272a',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  btnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.99 }],
  },
});
