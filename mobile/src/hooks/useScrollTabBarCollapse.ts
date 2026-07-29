import { useRef, useCallback, useEffect } from 'react';
import { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useAuthStore } from '../store/authStore';

/**
 * Universal hook for auto-collapsing/expanding the bottom floating tab bar
 * based on vertical scroll direction across all screens.
 *
 * - Scroll DOWN past threshold -> collapse tab bar (icon-only mode)
 * - Scroll UP anywhere or reach top -> expand tab bar (labels mode)
 */
export function useScrollTabBarCollapse(threshold: number = 40) {
  const setTabBarCollapsed = useAuthStore((state) => state.setTabBarCollapsed);
  const prevOffsetRef = useRef(0);

  // Always reset tab bar to expanded when mounting a screen or unmounting
  useEffect(() => {
    setTabBarCollapsed(false);
    return () => {
      setTabBarCollapsed(false);
    };
  }, [setTabBarCollapsed]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const currentOffset = event.nativeEvent.contentOffset.y;

      // At or near top of screen (or iOS bounce/overscroll)
      if (currentOffset <= 10) {
        setTabBarCollapsed(false);
        prevOffsetRef.current = currentOffset;
        return;
      }

      const diff = currentOffset - prevOffsetRef.current;
      prevOffsetRef.current = currentOffset;

      // Micro-jitter filter: require > 4px scroll delta to trigger change
      if (diff > 4 && currentOffset > threshold) {
        setTabBarCollapsed(true);
      } else if (diff < -4) {
        setTabBarCollapsed(false);
      }
    },
    [setTabBarCollapsed, threshold]
  );

  return handleScroll;
}
