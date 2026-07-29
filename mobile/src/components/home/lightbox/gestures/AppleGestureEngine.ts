import { useState } from 'react';
import { Dimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { 
  useSharedValue, 
  withSpring, 
  withTiming, 
  Easing, 
  runOnJS, 
  SharedValue, 
  useAnimatedReaction 
} from 'react-native-reanimated';
import { getTargetTransform, applyElasticBounds } from '../utils/bounds';

const { width: defaultScreenWidth, height: defaultScreenHeight } = Dimensions.get('screen');

export interface AppleGestureEngineOptions {
  width?: number;
  screenHeight?: number;
  containerW?: number;
  containerH?: number;
  imageAspect?: number | null;
  expandProgress: SharedValue<number>;
  onZoomChange: (isZoomed: boolean) => void;
  onToggleControls: () => void;
  onCloseLightbox: () => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
}

export function useApplePhotosGesture({
  width = defaultScreenWidth,
  screenHeight = defaultScreenHeight,
  containerW = defaultScreenWidth,
  containerH = defaultScreenHeight * 0.82,
  imageAspect,
  expandProgress,
  onZoomChange,
  onToggleControls,
  onCloseLightbox,
  onInteractionStart,
  onInteractionEnd,
}: AppleGestureEngineOptions) {
  // ── Single Shared Transform State (scale, translateX, translateY) ──────
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // React state for strict gesture enablement (State 1: NORMAL vs State 2: ZOOMED)
  const [isZoomedState, setIsZoomedState] = useState(false);

  // Sync scale.value > 1.01 to React state & notify parent FlatList
  useAnimatedReaction(
    () => scale.value > 1.01,
    (isZoomed, previous) => {
      if (isZoomed !== previous && previous !== null && previous !== undefined) {
        runOnJS(setIsZoomedState)(isZoomed);
        runOnJS(onZoomChange)(isZoomed);
      }
    },
    [onZoomChange]
  );

  // Gesture interaction tracking values
  const startScale = useSharedValue(1);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);
  const isPinching = useSharedValue(false);
  // Re-anchored image-space focal point tracking values
  const anchorImgX = useSharedValue(0);
  const anchorImgY = useSharedValue(0);

  // Continuity & pointer tracking state
  const activePointerCount = useSharedValue(0);
  const needsPanReset = useSharedValue(false);

  /**
   * Smooth spring-back to valid target bounds on final release (when 0 pointers remain).
   */
  const finishGesture = () => {
    'worklet';
    isPinching.value = false;
    const target = getTargetTransform(scale.value, translateX.value, translateY.value, containerW, containerH, width, screenHeight, imageAspect);
    scale.value = withSpring(target.scale, { damping: 28, stiffness: 220, mass: 0.5 });
    translateX.value = withSpring(target.translateX, { damping: 28, stiffness: 220, mass: 0.5 });
    translateY.value = withSpring(target.translateY, { damping: 28, stiffness: 220, mass: 0.5 });
  };

  // ── PINCH GESTURE (Native Focal-Point Zoom 1x–5x) ─────────────────────────
  const pinchGesture = Gesture.Pinch()
    .onStart((e) => {
      'worklet';
      isPinching.value = true;
      needsPanReset.value = true;
      runOnJS(onInteractionStart)();
      startScale.value = scale.value;
      startTx.value = translateX.value;
      startTy.value = translateY.value;
      startFocalX.value = e.focalX - width / 2;
      startFocalY.value = e.focalY - screenHeight / 2;
    })
    .onUpdate((e) => {
      'worklet';
      const currentFocalX = e.focalX - width / 2;
      const currentFocalY = e.focalY - screenHeight / 2;

      const rawScale = startScale.value * e.scale;
      const r = rawScale / Math.max(0.001, startScale.value);

      const rawTx = startTx.value * r + startFocalX.value * (1 - r) + (currentFocalX - startFocalX.value);
      const rawTy = startTy.value * r + startFocalY.value * (1 - r) + (currentFocalY - startFocalY.value);

      const bounds = applyElasticBounds(rawScale, rawTx, rawTy, containerW, containerH, width, screenHeight, imageAspect);
      scale.value = bounds.scale;
      translateX.value = bounds.translateX;
      translateY.value = bounds.translateY;
    })
    .onEnd(() => {
      'worklet';
      isPinching.value = false;
      runOnJS(onInteractionEnd)();
      if (scale.value <= 1.001 || activePointerCount.value === 0) {
        finishGesture();
      }
    })
    .onFinalize(() => {
      'worklet';
      isPinching.value = false;
      if (scale.value <= 1.001 || activePointerCount.value === 0) {
        finishGesture();
      }
    });

  // ── IMAGE PAN GESTURE (ENABLED ONLY IN STATE 2: ZOOMED) ───────────────────
  const panZoomGesture = Gesture.Pan()
    .enabled(isZoomedState)
    .minPointers(1)
    .maxPointers(2)
    .onTouchesDown((e) => {
      'worklet';
      activePointerCount.value = e.numberOfTouches;
      if (e.numberOfTouches === 1 && e.allTouches && e.allTouches.length === 1) {
        const xTouch = e.allTouches[0].absoluteX - width / 2;
        const yTouch = e.allTouches[0].absoluteY - screenHeight / 2;
        const curScale = Math.max(0.001, scale.value);
        anchorImgX.value = (xTouch - translateX.value) / curScale;
        anchorImgY.value = (yTouch - translateY.value) / curScale;
        needsPanReset.value = false;
      } else {
        needsPanReset.value = true;
      }
    })
    .onTouchesUp((e) => {
      'worklet';
      activePointerCount.value = e.numberOfTouches;
      if (e.numberOfTouches === 1 && e.allTouches && e.allTouches.length === 1) {
        const xTouch = e.allTouches[0].absoluteX - width / 2;
        const yTouch = e.allTouches[0].absoluteY - screenHeight / 2;
        const curScale = Math.max(0.001, scale.value);
        anchorImgX.value = (xTouch - translateX.value) / curScale;
        anchorImgY.value = (yTouch - translateY.value) / curScale;
        needsPanReset.value = false;
      } else {
        needsPanReset.value = true;
      }
      if (scale.value <= 1.001 || (e.numberOfTouches === 0 && !isPinching.value)) {
        finishGesture();
      }
    })
    .onTouchesCancelled((e) => {
      'worklet';
      activePointerCount.value = e.numberOfTouches;
      if (e.numberOfTouches === 1 && e.allTouches && e.allTouches.length === 1) {
        const xTouch = e.allTouches[0].absoluteX - width / 2;
        const yTouch = e.allTouches[0].absoluteY - screenHeight / 2;
        const curScale = Math.max(0.001, scale.value);
        anchorImgX.value = (xTouch - translateX.value) / curScale;
        anchorImgY.value = (yTouch - translateY.value) / curScale;
        needsPanReset.value = false;
      } else {
        needsPanReset.value = true;
      }
      if (scale.value <= 1.001 || (e.numberOfTouches === 0 && !isPinching.value)) {
        finishGesture();
      }
    })
    .onStart(() => {
      'worklet';
      if (scale.value <= 1.001) return;
      runOnJS(onInteractionStart)();
    })
    .onUpdate((e) => {
      'worklet';
      if (isPinching.value) return;
      if (scale.value <= 1.001) return;

      const curTouchX = e.absoluteX - width / 2;
      const curTouchY = e.absoluteY - screenHeight / 2;

      if (needsPanReset.value) {
        const curScale = Math.max(0.001, scale.value);
        anchorImgX.value = (curTouchX - translateX.value) / curScale;
        anchorImgY.value = (curTouchY - translateY.value) / curScale;
        needsPanReset.value = false;
        return;
      }

      const rawTx = curTouchX - scale.value * anchorImgX.value;
      const rawTy = curTouchY - scale.value * anchorImgY.value;

      const bounds = applyElasticBounds(scale.value, rawTx, rawTy, containerW, containerH, width, screenHeight, imageAspect);
      translateX.value = bounds.translateX;
      translateY.value = bounds.translateY;
    })
    .onEnd(() => {
      'worklet';
      runOnJS(onInteractionEnd)();
      if (scale.value <= 1.001 || activePointerCount.value === 0) {
        finishGesture();
      }
    });

  // ── SWIPE DOWN TO DISMISS (ENABLED ONLY IN STATE 1: NORMAL) ───────────────
  const swipeDownPanGesture = Gesture.Pan()
    .enabled(!isZoomedState)
    .minPointers(1)
    .maxPointers(1)
    .activeOffsetY(15)
    .failOffsetY(-10)
    .failOffsetX([-20, 20])
    .onStart(() => {
      'worklet';
      if (scale.value > 1.001) return;
      runOnJS(onInteractionStart)();
    })
    .onUpdate((e) => {
      'worklet';
      if (scale.value > 1.001 || isPinching.value) return;

      if (e.translationY > 0 && e.translationY > Math.abs(e.translationX)) {
        translateY.value = e.translationY;
        translateX.value = e.translationX * 0.2;
        const progress = Math.min(e.translationY / 400, 1);
        scale.value = 1 - progress * 0.35;
        expandProgress.value = 1 - progress * 0.7;
      }
    })
    .onEnd((e) => {
      'worklet';
      runOnJS(onInteractionEnd)();
      if (scale.value > 1.001 || isPinching.value) {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        scale.value = withSpring(1);
        return;
      }

      const isDownwardDrag = e.translationY > 110 && e.translationY > Math.abs(e.translationX) * 1.5;
      const isDownwardFlick = e.translationY > 40 && e.velocityY > 800 && e.velocityY > Math.abs(e.velocityX) * 1.5;

      if (isDownwardDrag || isDownwardFlick) {
        translateX.value = withSpring(0, { damping: 28, mass: 1, stiffness: 190 });
        translateY.value = withSpring(0, { damping: 28, mass: 1, stiffness: 190 });
        scale.value = withSpring(1, { damping: 28, mass: 1, stiffness: 190 });
        runOnJS(onCloseLightbox)();
      } else {
        translateX.value = withSpring(0, { damping: 20, mass: 1, stiffness: 150 });
        translateY.value = withSpring(0, { damping: 20, mass: 1, stiffness: 150 });
        scale.value = withSpring(1, { damping: 20, mass: 1, stiffness: 150 });
        expandProgress.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
      }
    });

  // ── TAP GESTURES (Single tap toggles controls, Double tap focal zoom) ─────
  const singleTapGesture = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(250)
    .onEnd(() => {
      'worklet';
      if (scale.value > 1.01) return;
      runOnJS(onToggleControls)();
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(250)
    .onEnd((e) => {
      'worklet';
      if (scale.value > 1.01) {
        finishGesture();
        scale.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.quad) });
        translateX.value = withTiming(0, { duration: 250, easing: Easing.out(Easing.quad) });
        translateY.value = withTiming(0, { duration: 250, easing: Easing.out(Easing.quad) });
      } else {
        const targetScale = 2.5;
        const focalX = e.x - width / 2;
        const focalY = e.y - screenHeight / 2;

        const rawTx = focalX * (1 - targetScale);
        const rawTy = focalY * (1 - targetScale);

        const target = getTargetTransform(targetScale, rawTx, rawTy, containerW, containerH, width, screenHeight, imageAspect);

        scale.value = withTiming(target.scale, { duration: 250, easing: Easing.out(Easing.quad) });
        translateX.value = withTiming(target.translateX, { duration: 250, easing: Easing.out(Easing.quad) });
        translateY.value = withTiming(target.translateY, { duration: 250, easing: Easing.out(Easing.quad) });
      }
    });

  const tapGestures = Gesture.Exclusive(doubleTapGesture, singleTapGesture);
  const imageGestures = Gesture.Simultaneous(pinchGesture, panZoomGesture);

  const composedGesture = Gesture.Simultaneous(
    imageGestures,
    swipeDownPanGesture,
    tapGestures
  );

  return {
    scale,
    translateX,
    translateY,
    isZoomedState,
    composedGesture,
    finishGesture,
  };
}
