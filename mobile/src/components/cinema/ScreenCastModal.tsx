import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
  Dimensions,
  Animated,
  Easing,
  Linking,
  ScrollView,
} from 'react-native';
import { MaterialCommunityIcons, Ionicons, Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoAirPlayButton } from 'expo-video';
import {
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_MEDIUM,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_FUTURA,
} from '../../constants/fonts';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ScreenCastModalProps {
  visible: boolean;
  onClose: () => void;
  videoTitle?: string;
}

export const ScreenCastModal: React.FC<ScreenCastModalProps> = ({
  visible,
  onClose,
  videoTitle,
}) => {
  const insets = useSafeAreaInsets();
  const [isScanning, setIsScanning] = useState(true);

  // Radar wave pulse animations
  const pulseAnim1 = useRef(new Animated.Value(0)).current;
  const pulseAnim2 = useRef(new Animated.Value(0)).current;

  const startScanningAnimation = () => {
    setIsScanning(true);
    pulseAnim1.setValue(0);
    pulseAnim2.setValue(0);

    const createPulse = (anim: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: 1900,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      );
    };

    const loop1 = createPulse(pulseAnim1, 0);
    const loop2 = createPulse(pulseAnim2, 950);
    loop1.start();
    loop2.start();

    const timer = setTimeout(() => {
      setIsScanning(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }, 2200);

    return () => {
      loop1.stop();
      loop2.stop();
      clearTimeout(timer);
    };
  };

  useEffect(() => {
    if (visible) {
      const cleanup = startScanningAnimation();
      return cleanup;
    }
  }, [visible]);

  const handleDismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onClose();
  };

  const handleRescan = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    startScanningAnimation();
  };

  const handleOpenCastSettings = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (Platform.OS === 'android') {
      try {
        await Linking.sendIntent('android.settings.CAST_SETTINGS');
      } catch {
        try {
          await Linking.openSettings();
        } catch {}
      }
    }
  };

  const handleOpenSmartView = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (Platform.OS === 'android') {
      try {
        await Linking.sendIntent('android.settings.WIFI_DISPLAY_SETTINGS');
      } catch {
        try {
          await Linking.sendIntent('android.settings.CAST_SETTINGS');
        } catch {
          await Linking.openSettings();
        }
      }
    }
  };

  const isIOS = Platform.OS === 'ios';

  const ring1Scale = pulseAnim1.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 2.4],
  });
  const ring1Opacity = pulseAnim1.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0.7, 0.4, 0],
  });

  const ring2Scale = pulseAnim2.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 2.4],
  });
  const ring2Opacity = pulseAnim2.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0.7, 0.4, 0],
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleDismiss}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismissArea} onPress={handleDismiss} />
        <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom + 14, 26) }]}>
          {/* Top Drag Handle */}
          <View style={styles.modalDragHandle} />

          {/* Close Button Top Right */}
          <Pressable
            onPress={handleDismiss}
            hitSlop={16}
            style={styles.modalCloseBtn}
          >
            <Text style={styles.modalCloseText}>✕</Text>
          </Pressable>

          {/* Brand Prefix */}
          <Text style={styles.brandPrefix}>MISTY VISUALS CINEMA</Text>

          {/* Header Row with Animated Radar Icon */}
          <View style={styles.headerRow}>
            <View style={styles.radarWrapper}>
              {isScanning && (
                <>
                  <Animated.View
                    style={[
                      styles.radarRing,
                      {
                        transform: [{ scale: ring1Scale }],
                        opacity: ring1Opacity,
                      },
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.radarRing,
                      {
                        transform: [{ scale: ring2Scale }],
                        opacity: ring2Opacity,
                      },
                    ]}
                  />
                </>
              )}
              <View style={[styles.castIconCircle, isScanning && styles.castIconCircleActive]}>
                <MaterialCommunityIcons
                  name={isScanning ? 'radar' : 'cast-connected'}
                  size={22}
                  color="#E5C483"
                />
              </View>
            </View>

            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Cast to TV or Screen</Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {videoTitle ? `Streaming: ${videoTitle}` : 'Experience your wedding films in 4K on the big screen'}
              </Text>
            </View>
          </View>

          {/* Live Wi-Fi Scanning Status Banner */}
          <View style={styles.wifiStatusBar}>
            <View
              style={[
                styles.wifiDot,
                isScanning ? styles.wifiDotScanning : styles.wifiDotReady,
              ]}
            />
            <Text style={styles.wifiStatusText}>
              {isScanning
                ? 'Scanning local Wi-Fi for available screens & TVs…'
                : 'Connected to Wi-Fi • Ready to stream'}
            </Text>

            {!isScanning && (
              <Pressable
                onPress={handleRescan}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.rescanBtn,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Feather name="refresh-cw" size={12} color="#E5C483" />
                <Text style={styles.rescanText}>Rescan</Text>
              </Pressable>
            )}
          </View>

          {/* Active Device Targets */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.optionsScrollView}
            contentContainerStyle={styles.optionsList}
          >
            {/* 1. Apple TV & AirPlay 2 */}
            <View style={styles.deviceOptionCard}>
              <View style={styles.deviceIconBg}>
                <Ionicons name="tv-outline" size={22} color="#FFFFFF" />
              </View>
              <View style={styles.deviceInfo}>
                <View style={styles.deviceNameRow}>
                  <Text style={styles.deviceName}>Apple TV & AirPlay 2</Text>
                  <View style={styles.badgeTag}>
                    <Text style={styles.badgeTagText}>AirPlay 2</Text>
                  </View>
                </View>
                <Text style={styles.deviceDesc}>
                  Apple TV, Roku, Sony, Samsung & LG TVs with AirPlay
                </Text>
              </View>

              {isIOS ? (
                <View style={styles.airplayRowBtnContainer}>
                  <VideoAirPlayButton
                    tint="#FFFFFF"
                    activeTint="#E5C483"
                    prioritizeVideoDevices={true}
                    style={styles.inlineAirPlayBtn}
                  />
                  <Text style={styles.connectBtnText}>Connect</Text>
                </View>
              ) : (
                <View style={styles.passiveTag}>
                  <Text style={styles.passiveTagText}>Apple Devices</Text>
                </View>
              )}
            </View>

            {/* 2. Google Cast & Chromecast */}
            <View style={styles.deviceOptionCard}>
              <View style={styles.deviceIconBg}>
                <MaterialCommunityIcons name="google-chrome" size={20} color="#FFFFFF" />
              </View>
              <View style={styles.deviceInfo}>
                <View style={styles.deviceNameRow}>
                  <Text style={styles.deviceName}>Chromecast & Google TV</Text>
                  <View style={styles.badgeTag}>
                    <Text style={styles.badgeTagText}>Google Cast</Text>
                  </View>
                </View>
                <Text style={styles.deviceDesc}>
                  Google TV, Android TV, Chromecast Ultra
                </Text>
              </View>

              {!isIOS ? (
                <Pressable
                  onPress={handleOpenCastSettings}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    pressed && styles.btnPressed,
                  ]}
                >
                  <Text style={styles.actionBtnText}>Connect →</Text>
                </Pressable>
              ) : (
                <View style={styles.passiveTag}>
                  <Text style={styles.passiveTagText}>Smart TV</Text>
                </View>
              )}
            </View>

            {/* 3. Smart TV Screen Mirroring (Samsung Smart View / Miracast) */}
            <View style={styles.deviceOptionCard}>
              <View style={styles.deviceIconBg}>
                <MaterialCommunityIcons name="television-play" size={20} color="#FFFFFF" />
              </View>
              <View style={styles.deviceInfo}>
                <View style={styles.deviceNameRow}>
                  <Text style={styles.deviceName}>Smart TV Mirroring</Text>
                  <View style={styles.badgeTag}>
                    <Text style={styles.badgeTagText}>Smart View</Text>
                  </View>
                </View>
                <Text style={styles.deviceDesc}>
                  Samsung Smart View, LG webOS, DLNA Mirroring
                </Text>
              </View>

              {!isIOS ? (
                <Pressable
                  onPress={handleOpenSmartView}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    pressed && styles.btnPressed,
                  ]}
                >
                  <Text style={styles.actionBtnText}>Mirror →</Text>
                </Pressable>
              ) : (
                <View style={styles.passiveTag}>
                  <Text style={styles.passiveTagText}>Mirroring</Text>
                </View>
              )}
            </View>

            {/* Quick Tips Box */}
            <View style={styles.instructionsCard}>
              <Text style={styles.instructionsTitle}>QUICK TIPS FOR 4K STREAMING</Text>
              <View style={styles.instructionStep}>
                <Text style={styles.stepDot}>•</Text>
                <Text style={styles.stepText}>
                  Keep both your phone and smart TV on the same Wi-Fi network (5GHz recommended for smooth 4K playback).
                </Text>
              </View>
              <View style={styles.instructionStep}>
                <Text style={styles.stepDot}>•</Text>
                <Text style={styles.stepText}>
                  {isIOS
                    ? 'Tap the AirPlay Connect icon to select your TV and begin theater playback.'
                    : 'Tap Connect or pull down Quick Settings to launch Screen Cast / Smart View.'}
                </Text>
              </View>
            </View>
          </ScrollView>

          {/* Dismiss Button */}
          <Pressable
            style={({ pressed }) => [
              styles.dismissBtn,
              pressed && styles.btnPressed,
            ]}
            onPress={handleDismiss}
          >
            <Text style={styles.dismissBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: '#141416',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '85%',
  },
  modalDragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 14,
    right: 18,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  modalCloseText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  brandPrefix: {
    fontFamily: FONT_FUTURA,
    fontSize: 9.5,
    letterSpacing: 2.5,
    color: '#E5C483',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  radarWrapper: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  radarRing: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#E5C483',
  },
  castIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(229, 196, 131, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(229, 196, 131, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  castIconCircleActive: {
    borderColor: '#E5C483',
    backgroundColor: 'rgba(229, 196, 131, 0.22)',
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 18,
    color: '#FFFFFF',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  headerSubtitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.65)',
  },
  wifiStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    gap: 8,
    marginBottom: 14,
  },
  wifiDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  wifiDotScanning: {
    backgroundColor: '#E5C483',
  },
  wifiDotReady: {
    backgroundColor: '#34C759',
  },
  wifiStatusText: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 11,
    color: '#D4D4D8',
    flex: 1,
  },
  rescanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(229, 196, 131, 0.15)',
  },
  rescanText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 10,
    color: '#E5C483',
  },
  optionsScrollView: {
    maxHeight: 320,
    marginBottom: 14,
  },
  optionsList: {
    gap: 10,
  },
  deviceOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  deviceIconBg: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceInfo: {
    flex: 1,
  },
  deviceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  deviceName: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 13.5,
    color: '#FFFFFF',
  },
  badgeTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeTagText: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  deviceDesc: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  actionBtn: {
    backgroundColor: 'rgba(229, 196, 131, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(229, 196, 131, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7,
  },
  actionBtnText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 11.5,
    color: '#E5C483',
    letterSpacing: 0.3,
  },
  airplayRowBtnContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
  },
  inlineAirPlayBtn: {
    width: 22,
    height: 22,
  },
  connectBtnText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 11.5,
    color: '#FFFFFF',
  },
  passiveTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  passiveTagText: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  instructionsCard: {
    backgroundColor: 'rgba(229, 196, 131, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(229, 196, 131, 0.18)',
    borderRadius: 12,
    padding: 12,
    gap: 6,
    marginTop: 4,
  },
  instructionsTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 10,
    letterSpacing: 1.4,
    color: '#E5C483',
    marginBottom: 2,
  },
  instructionStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  stepDot: {
    color: '#E5C483',
    fontSize: 12,
    lineHeight: 16,
  },
  stepText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.75)',
    flex: 1,
  },
  dismissBtn: {
    backgroundColor: '#FFFFFF',
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissBtnText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 14,
    color: '#000000',
    letterSpacing: 0.3,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
