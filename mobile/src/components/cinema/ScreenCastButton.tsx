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

  // On iOS, if no custom onPress handler is provided, render native Apple AirPlay button
  // which immediately discovers and presents available Apple TVs and AirPlay 2 screens
  if (isIOS && !onPress) {
    return (
      <>
        <View style={[styles.container, style]}>
          <View style={styles.iconButton}>
            <VideoAirPlayButton
              tint={color}
              activeTint={activeColor}
              prioritizeVideoDevices={true}
              onBeginPresentingRoutes={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              }}
              style={styles.airplayNativeBtn}
            />
          </View>
        </View>

        <ScreenCastModal
          visible={modalVisible}
          onClose={() => setModalVisible(false)}
          videoTitle={videoTitle}
        />
      </>
    );
  }

  return (
    <>
      <Pressable
        onPress={handlePress}
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        style={({ pressed }) => [
          styles.container,
          style,
          pressed && styles.btnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Cast to TV"
      >
        <View style={styles.iconButton}>
          <MaterialCommunityIcons name="cast" size={size} color={color} />
        </View>
      </Pressable>

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
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
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
    transform: [{ scale: 0.94 }],
  },
  airplayNativeBtn: {
    width: 26,
    height: 26,
  },
});
