import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
  Dimensions,
} from 'react-native';
import { MaterialCommunityIcons, Ionicons, Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

  const handleDismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleDismiss}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismissArea} onPress={handleDismiss} />
        <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom + 16, 28) }]}>
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

          {/* Title & Video Info */}
          <View style={styles.headerRow}>
            <View style={styles.castIconCircle}>
              <MaterialCommunityIcons name="cast" size={24} color="#E5C483" />
            </View>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Cast to TV or Screen</Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {videoTitle ? `Streaming: ${videoTitle}` : 'Experience your films in 4K on the big screen'}
              </Text>
            </View>
          </View>

          {/* Wi-Fi Status Bar */}
          <View style={styles.wifiStatusBar}>
            <View style={styles.wifiDot} />
            <Text style={styles.wifiStatusText}>
              Ready to stream • Make sure TV and phone share the same Wi-Fi
            </Text>
          </View>

          {/* Cast Options List */}
          <View style={styles.optionsList}>
            {/* 1. Apple AirPlay 2 */}
            <View style={styles.deviceOptionCard}>
              <View style={styles.deviceIconBg}>
                <Ionicons name="tv-outline" size={22} color="#FFFFFF" />
              </View>
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceName}>Apple TV & AirPlay 2</Text>
                <Text style={styles.deviceDesc}>
                  Apple TV, Roku, Sony, Samsung & LG TVs with AirPlay
                </Text>
              </View>
              {Platform.OS === 'ios' ? (
                <View style={styles.activeTag}>
                  <Text style={styles.activeTagText}>Active</Text>
                </View>
              ) : null}
            </View>

            {/* 2. Google Cast / Chromecast */}
            <View style={styles.deviceOptionCard}>
              <View style={styles.deviceIconBg}>
                <MaterialCommunityIcons name="google-chrome" size={20} color="#FFFFFF" />
              </View>
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceName}>Chromecast & Android TV</Text>
                <Text style={styles.deviceDesc}>
                  Google TV, Android TV, Chromecast with Google TV
                </Text>
              </View>
            </View>

            {/* 3. Smart TV Screen Mirroring */}
            <View style={styles.deviceOptionCard}>
              <View style={styles.deviceIconBg}>
                <Feather name="airplay" size={20} color="#FFFFFF" />
              </View>
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceName}>Smart TV Mirroring</Text>
                <Text style={styles.deviceDesc}>
                  Samsung Smart View, LG webOS, DLNA Screen Cast
                </Text>
              </View>
            </View>
          </View>

          {/* Quick Instructions Card */}
          <View style={styles.instructionsCard}>
            <Text style={styles.instructionsTitle}>HOW TO CONNECT</Text>
            <View style={styles.instructionStep}>
              <Text style={styles.stepNumber}>1</Text>
              <Text style={styles.stepText}>
                Connect both your phone and smart TV to the same Wi-Fi network.
              </Text>
            </View>
            <View style={styles.instructionStep}>
              <Text style={styles.stepNumber}>2</Text>
              <Text style={styles.stepText}>
                {Platform.OS === 'ios'
                  ? 'Tap the Cast button on the video player to pick your Apple TV or AirPlay display.'
                  : 'Swipe down your phone’s Quick Settings and tap Screen Cast / Smart View.'}
              </Text>
            </View>
            <View style={styles.instructionStep}>
              <Text style={styles.stepNumber}>3</Text>
              <Text style={styles.stepText}>
                Sit back and enjoy your wedding memories in cinema-grade color and sound!
              </Text>
            </View>
          </View>

          {/* Got it / Dismiss Button */}
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
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: '#161618',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 20,
    paddingTop: 12,
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
    gap: 12,
    marginBottom: 14,
  },
  castIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(229, 196, 131, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(229, 196, 131, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
    marginBottom: 16,
  },
  wifiDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#34C759',
  },
  wifiStatusText: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 11,
    color: '#D4D4D8',
    flex: 1,
  },
  optionsList: {
    gap: 10,
    marginBottom: 16,
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
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 13.5,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  deviceDesc: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  activeTag: {
    backgroundColor: 'rgba(52, 199, 89, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(52, 199, 89, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  activeTagText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 10,
    color: '#34C759',
    letterSpacing: 0.3,
  },
  instructionsCard: {
    backgroundColor: 'rgba(229, 196, 131, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(229, 196, 131, 0.18)',
    borderRadius: 12,
    padding: 14,
    gap: 8,
    marginBottom: 16,
  },
  instructionsTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 10.5,
    letterSpacing: 1.5,
    color: '#E5C483',
    marginBottom: 4,
  },
  instructionStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  stepNumber: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(229, 196, 131, 0.2)',
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 10.5,
    color: '#E5C483',
    textAlign: 'center',
    lineHeight: 18,
  },
  stepText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11.5,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.8)',
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
