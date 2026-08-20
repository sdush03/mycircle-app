import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  Dimensions,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';

const { width } = Dimensions.get('window');

interface CoupleFeatureLockedModalProps {
  visible: boolean;
  onClose: () => void;
}

export const CoupleFeatureLockedModal: React.FC<CoupleFeatureLockedModalProps> = ({
  visible,
  onClose,
}) => {
  const insets = useSafeAreaInsets();

  const handleHirePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Linking.openURL('https://mistyvisuals.com').catch(() => {});
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={[styles.modalCard, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          {/* Close icon */}
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={20} color="#888888" />
          </Pressable>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {/* Lock Icon */}
            <View style={styles.iconCircle}>
              <Ionicons name="sparkles" size={28} color="#111111" />
            </View>

            {/* Badge */}
            <View style={styles.badgePill}>
              <Text style={styles.badgePillText}>EXCLUSIVE COUPLE SUITE</Text>
            </View>

            {/* Title */}
            <Text style={styles.title}>CURATE YOUR WEDDING MOODBOARD</Text>

            {/* Subtitle */}
            <Text style={styles.subtitle}>
              Collaborative moodboard uploads and partner inspiration sharing are exclusively unlocked for MistyVisuals wedding couples.
            </Text>

            {/* Feature List */}
            <View style={styles.featureList}>
              <View style={styles.featureRow}>
                <View style={styles.featureIconBox}>
                  <Ionicons name="heart" size={14} color="#111111" />
                </View>
                <View style={styles.featureTextGroup}>
                  <Text style={styles.featureTitle}>Joint Bride & Groom Curation</Text>
                  <Text style={styles.featureDesc}>Real-time shared feed syncing both partners' saved inspirations.</Text>
                </View>
              </View>

              <View style={styles.featureRow}>
                <View style={styles.featureIconBox}>
                  <Ionicons name="cloud-upload" size={14} color="#111111" />
                </View>
                <View style={styles.featureTextGroup}>
                  <Text style={styles.featureTitle}>Camera Roll & Pinterest Uploads</Text>
                  <Text style={styles.featureDesc}>Add screenshots, outfits, decor ideas, and pose references directly.</Text>
                </View>
              </View>

              <View style={styles.featureRow}>
                <View style={styles.featureIconBox}>
                  <Ionicons name="pricetag" size={14} color="#111111" />
                </View>
                <View style={styles.featureTextGroup}>
                  <Text style={styles.featureTitle}>Smart Sub-Event Tagging</Text>
                  <Text style={styles.featureDesc}>Organize moodboards with #Haldi, #Mehendi, #Sangeet, and #Wedding.</Text>
                </View>
              </View>

              <View style={styles.featureRow}>
                <View style={styles.featureIconBox}>
                  <Ionicons name="camera" size={14} color="#111111" />
                </View>
                <View style={styles.featureTextGroup}>
                  <Text style={styles.featureTitle}>Direct Photography Crew Sync</Text>
                  <Text style={styles.featureDesc}>Visual reference guide ready on event day for your lead photographers.</Text>
                </View>
              </View>
            </View>

            {/* Call to Action */}
            <Pressable style={styles.ctaButton} onPress={handleHirePress}>
              <Text style={styles.ctaButtonText}>HIRE MISTYVISUALS FOR YOUR WEDDING</Text>
            </Pressable>

            <Pressable style={styles.dismissBtn} onPress={onClose}>
              <Text style={styles.dismissBtnText}>MAYBE LATER</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    width: '100%',
    maxHeight: '85%',
    backgroundColor: '#ffffff',
    borderRadius: 28,
    paddingTop: 28,
    paddingHorizontal: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
    position: 'relative',
  },
  closeBtn: {
    position: 'absolute',
    top: 18,
    right: 18,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f4f4f5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  badgePill: {
    backgroundColor: '#111111',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    marginBottom: 12,
  },
  badgePillText: {
    fontSize: 9,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#ffffff',
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 18,
    fontFamily: FONT_FUTURA_BOLD,
    color: '#111111',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: FONT_JOST_REGULAR,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  featureList: {
    width: '100%',
    backgroundColor: '#fafafa',
    borderRadius: 16,
    padding: 16,
    gap: 14,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  featureIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  featureTextGroup: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 12,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#18181b',
    marginBottom: 2,
  },
  featureDesc: {
    fontSize: 11,
    fontFamily: FONT_JOST_REGULAR,
    color: '#71717a',
    lineHeight: 15,
  },
  ctaButton: {
    width: '100%',
    height: 50,
    backgroundColor: '#111111',
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
    marginBottom: 10,
  },
  ctaButtonText: {
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.2,
    color: '#ffffff',
  },
  dismissBtn: {
    paddingVertical: 8,
  },
  dismissBtnText: {
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#888888',
    letterSpacing: 1,
  },
});
