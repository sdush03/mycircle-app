import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Platform,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { VideoAirPlayButton } from 'expo-video';
import { ScreenCastModal } from './ScreenCastModal';

interface ScreenCastButtonProps {
  size?: number;
  color?: string;
  activeColor?: string;
  style?: StyleProp<ViewStyle>;
  videoTitle?: string;
  onPress?: () => void;
}

export const ScreenCastButton: React.FC<ScreenCastButtonProps> = ({
  size = 22,
  color = '#FFFFFF',
  activeColor = '#E5C483',
  style,
  videoTitle,
  onPress,
}) => {
  const [modalVisible, setModalVisible] = useState(false);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (onPress) {
      onPress();
    } else {
      setModalVisible(true);
    }
  };

  const isIOS = Platform.OS === 'ios';

  return (
    <>
      <View style={[styles.container, style]}>
        {/* Visual Cast Icon */}
        <Pressable
          onPress={handlePress}
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.btnPressed,
          ]}
        >
          <MaterialCommunityIcons name="cast" size={size} color={color} />
        </Pressable>

        {/* On iOS, overlay native VideoAirPlayButton so tap opens Apple AVRoutePickerView directly */}
        {isIOS && (
          <View style={styles.airplayOverlay} pointerEvents="box-only">
            <VideoAirPlayButton
              tint="transparent"
              activeTint={activeColor}
              prioritizeVideoDevices={true}
              style={styles.airplayNativeBtn}
            />
          </View>
        )}
      </View>

      <ScreenCastModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        videoTitle={videoTitle}
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.96 }],
  },
  airplayOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.011, // Almost invisible but receives the touch on iOS to invoke native AVRoutePickerView
    zIndex: 10,
  },
  airplayNativeBtn: {
    width: '100%',
    height: '100%',
  },
});
