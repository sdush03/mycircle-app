import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Pressable,
  FlatList,
  Dimensions,
  Share,
  Platform,
  Linking,
  StatusBar,
  Alert,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LightboxImageItem } from './components/LightboxImageItem';
import { Image as ExpoImage } from 'expo-image';
import { savesService } from '../../../services/savesService';
import { API_BASE_URL } from '../../../services/api';
import {
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_JOST_MEDIUM,
  FONT_JOST_REGULAR,
} from '../../../constants/fonts';

const { width, height: screenHeight } = Dimensions.get('screen');

export interface LightboxBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorialLightboxProps {
  visible: boolean;
  images: any[];
  initialIndex: number;
  initialBounds?: LightboxBounds | null;
  onGetBoundsForIndex?: (index: number, callback: (bounds: LightboxBounds) => void) => void;
  onClose: () => void;
  onUnsave?: (item: any) => void;
  onToggleLike?: (item: any) => Promise<boolean | void>;
  likeTargetName?: string;
  title?: string;
  subtitle?: string;
  enableDownload?: boolean;
}

export function EditorialLightbox({
  visible,
  images,
  initialIndex,
  initialBounds,
  onGetBoundsForIndex,
  onClose,
  onUnsave,
  onToggleLike,
  likeTargetName,
  title = 'MISTY VISUALS',
  subtitle,
  enableDownload = false,
}: EditorialLightboxProps) {
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);

  const [activeIdx, setActiveIdx] = useState<number>(initialIndex);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [isZoomed, setIsZoomed] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  // Universal Bounds & Animation Shared Values
  const expandProgress = useSharedValue(0);
  const thumbX = useSharedValue(initialBounds?.x ?? width / 2 - 60);
  const thumbY = useSharedValue(initialBounds?.y ?? screenHeight / 2 - 60);
  const thumbW = useSharedValue(initialBounds?.width ?? 120);
  const thumbH = useSharedValue(initialBounds?.height ?? 120);

  const toastOpacity = useSharedValue(0);
  const heartPopScale = useSharedValue(0);
  const heartPopOpacity = useSharedValue(0);

  // Auto-hide controls timer reference
  const autoHideTimerRef = useRef<any>(null);

  const resetAutoHideTimer = useCallback(() => {
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    autoHideTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3500);
  }, []);

  const pauseAutoHideTimer = useCallback(() => {
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
  }, []);

  useEffect(() => {
    let animTimer: any = null;
    if (visible) {
      setActiveIdx(initialIndex);
      setShowControls(true);
      setIsZoomed(false);
      expandProgress.value = 0;

      if (initialBounds && initialBounds.width > 0) {
        thumbX.value = initialBounds.x;
        thumbY.value = initialBounds.y;
        thumbW.value = initialBounds.width;
        thumbH.value = initialBounds.height;
      } else {
        thumbX.value = width / 2 - 60;
        thumbY.value = screenHeight / 2 - 60;
        thumbW.value = 120;
        thumbH.value = 120;
      }

      // 60-120fps smooth opening: Wait for native Modal mount & layout pass to complete before animating expansion
      animTimer = setTimeout(() => {
        requestAnimationFrame(() => {
          expandProgress.value = withTiming(1, {
            duration: 320,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          });
        });
      }, Platform.OS === 'android' ? 45 : 30);

      resetAutoHideTimer();

      // Defer async storage fetch until opening animation completes
      setTimeout(() => {
        savesService.getSavedPhotos().then((items) => {
          const urls = new Set(items.map((i) => i.photoUrl));
          setSavedUrls(urls);
        });
      }, 350);
    }

    return () => {
      clearTimeout(animTimer);
      pauseAutoHideTimer();
    };
  }, [visible, initialIndex, initialBounds, resetAutoHideTimer, pauseAutoHideTimer]);

  const updateBoundsForIndex = useCallback((idx: number) => {
    if (onGetBoundsForIndex) {
      onGetBoundsForIndex(idx, (newBounds) => {
        if (newBounds && newBounds.width > 0) {
          thumbX.value = newBounds.x;
          thumbY.value = newBounds.y;
          thumbW.value = newBounds.width;
          thumbH.value = newBounds.height;
        }
      });
    }
  }, [onGetBoundsForIndex, thumbX, thumbY, thumbW, thumbH]);

  // Update target bounds whenever active index changes (and auto-scroll background page if offscreen)
  useEffect(() => {
    if (visible) {
      updateBoundsForIndex(activeIdx);
    }
  }, [visible, activeIdx, updateBoundsForIndex]);

  // Imperative StatusBar visibility control matching native iOS/Android Photos app
  useEffect(() => {
    if (visible) {
      StatusBar.setHidden(!showControls || isZoomed, 'fade');
    } else {
      StatusBar.setHidden(false, 'fade');
    }
    return () => {
      StatusBar.setHidden(false, 'fade');
    };
  }, [visible, showControls, isZoomed]);

  // High-performance background prefetching of adjacent photos (+/- 2 photos) in memory-disk cache (Deferred after open)
  useEffect(() => {
    if (visible && activeIdx !== null && images.length > 0) {
      const timer = setTimeout(() => {
        const urlsToPrefetch: string[] = [];
        [activeIdx - 1, activeIdx + 1, activeIdx + 2, activeIdx - 2].forEach((idx) => {
          if (idx >= 0 && idx < images.length) {
            const item = images[idx];
            const uri =
              typeof item === 'string'
                ? item
                : item.fullUri || item.uri || item.photoUrl || item.r2Url || item.file_url || item.url;
            if (uri) urlsToPrefetch.push(uri);
          }
        });
        urlsToPrefetch.forEach((url) => {
          ExpoImage.prefetch(url, 'memory-disk');
        });
      }, 350);

      return () => clearTimeout(timer);
    }
  }, [visible, activeIdx, images]);

  // Adjust activeIdx and scroll FlatList when photos are removed (e.g. un-saving)
  React.useEffect(() => {
    if (!visible || images.length === 0) return;
    if (activeIdx >= images.length) {
      const nextIdx = Math.max(0, images.length - 1);
      setActiveIdx(nextIdx);
      flatListRef.current?.scrollToOffset({ offset: (width + 18) * nextIdx, animated: true });
    }
  }, [visible, images.length, activeIdx]);

  const showToast = useCallback(
    (msg: string) => {
      setToastMsg(msg);
      toastOpacity.value = withTiming(1, { duration: 250 });
      setTimeout(() => {
        toastOpacity.value = withTiming(0, { duration: 300 });
        setTimeout(() => setToastMsg(null), 300);
      }, 1800);
    },
    [toastOpacity]
  );

  const triggerHeartPop = useCallback(() => {
    heartPopScale.value = 0.4;
    heartPopOpacity.value = 1;
    heartPopScale.value = withSpring(1.2, { damping: 10, stiffness: 200 }, () => {
      'worklet';
      heartPopOpacity.value = withTiming(0, { duration: 350 });
    });
  }, [heartPopScale, heartPopOpacity]);

  // Smooth 350ms Bezier collapse back to original bounds on exit
  const handleClose = useCallback(() => {
    pauseAutoHideTimer();
    updateBoundsForIndex(activeIdx);
    flatListRef.current?.scrollToOffset({ offset: (width + 18) * activeIdx, animated: false });

    expandProgress.value = withTiming(
      0,
      {
        duration: 280,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      },
      (finished) => {
        'worklet';
        if (finished) {
          runOnJS(onClose)();
        }
      }
    );
  }, [expandProgress, activeIdx, onClose, updateBoundsForIndex, pauseAutoHideTimer]);

  const currentItem = images[activeIdx] || null;
  const currentUrl = currentItem
    ? typeof currentItem === 'string'
      ? currentItem
      : currentItem.fullUri ||
        currentItem.r2Url ||
        currentItem.r2_url ||
        currentItem.file_url ||
        currentItem.file_url_mobile ||
        currentItem.url ||
        currentItem.imageUrl ||
        currentItem.photoUrl ||
        currentItem.uri ||
        ''
    : '';

  const isSaved = onToggleLike ? !!currentItem?.isLiked : savedUrls.has(currentUrl);

  const handleToggleSave = async () => {
    if (!currentUrl) return;

    if (onToggleLike && currentItem) {
      const wasLiked = !!currentItem.isLiked;
      const targetLabel = likeTargetName || 'My Favourites';
      if (wasLiked) {
        try {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {}
        showToast(`Removed from ${targetLabel}`);
      } else {
        try {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}
        triggerHeartPop();
        showToast(`Saved to ${targetLabel} ✨`);
      }
      await onToggleLike(currentItem);
      return;
    }

    if (isSaved) {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
      const updated = new Set(savedUrls);
      updated.delete(currentUrl);
      setSavedUrls(updated);
      showToast('Removed from Moodboard');
      await savesService.unsavePhoto(currentUrl, currentItem?.id);
      if (onUnsave && currentItem) {
        if (images.length > 1) {
          const hasNext = activeIdx < images.length - 1;
          const targetIdx = hasNext ? activeIdx + 1 : activeIdx - 1;
          flatListRef.current?.scrollToOffset({ offset: (width + 18) * targetIdx, animated: true });

          setTimeout(() => {
            onUnsave(currentItem);
          }, 250);
        } else {
          onUnsave(currentItem);
        }
      }
    } else {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
      const updated = new Set(savedUrls);
      updated.add(currentUrl);
      setSavedUrls(updated);
      triggerHeartPop();
      showToast('Photo saved to Moodboard ✨');
      await savesService.savePhoto(currentUrl);
    }
  };

  const handleShare = async () => {
    if (!currentUrl) return;
    try {
      await Share.share({
        message: `Check out this photo from ${title}:\n${currentUrl}`,
        url: currentUrl,
        title: title,
      });
    } catch (e) {
      console.warn('Share failed:', e);
    }
  };

  const handleDownload = async () => {
    console.log('[DOWNLOAD DEBUG 🚀] handleDownload invoked!');
    if (!enableDownload) {
      console.warn('[DOWNLOAD DEBUG ⚠️] enableDownload is false!');
      showToast('Download disabled');
      return;
    }
    if (!currentItem) {
      console.warn('[DOWNLOAD DEBUG ⚠️] currentItem is null!');
      showToast('No item selected');
      return;
    }
    if (isDownloading) {
      console.log('[DOWNLOAD DEBUG ⏳] Already downloading, ignoring duplicate press');
      return;
    }

    try {
      setIsDownloading(true);

      const rawTargetUri =
        currentItem.fullUri ||
        currentItem.r2Url ||
        currentItem.r2_url ||
        currentItem.file_url ||
        currentItem.url ||
        currentItem.photoUrl ||
        currentItem.uri ||
        currentUrl;

      console.log('[DOWNLOAD DEBUG 🔗] Target URI:', rawTargetUri);

      if (!rawTargetUri) {
        console.warn('[DOWNLOAD DEBUG ❌] No valid target URL found on photo item!');
        showToast('Download unavailable');
        return;
      }

      const filename = currentItem.filename || `photo_${Date.now()}`;
      let safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
      if (!safeName.match(/\.(jpg|jpeg|png)$/i)) {
        safeName += '.jpg';
      }

      console.log(`[DOWNLOAD DEBUG 📁] Target Filename: ${safeName} | OS: ${Platform.OS}`);

      if (Platform.OS === 'web') {
        try {
          console.log('[DOWNLOAD DEBUG 🌐] Executing Web download...');
          const response = await fetch(rawTargetUri);
          if (!response.ok) throw new Error(`HTTP fetch status ${response.status}`);
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = safeName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
          showToast('Photo downloaded!');
          console.log('[DOWNLOAD DEBUG ✅] Web Download successful!');
        } catch (webErr: any) {
          console.warn('[DOWNLOAD DEBUG ⚠️] Web fetch blob failed, falling back to direct target link:', webErr);
          const link = document.createElement('a');
          link.href = rawTargetUri;
          link.download = safeName;
          link.target = '_blank';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          showToast('Downloading photo...');
        }
      } else {
        // Native Mobile (iOS / Android)
        showToast('Saving photo to Photos...');
        console.log('[DOWNLOAD DEBUG 📱 STEP 1] Preparing FileSystem cache path...');

        const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
        const cleanCacheDir = cacheDir.replace(/\/+$/, '');
        const localPath = `${cleanCacheDir}/${safeName}`;
        console.log('[DOWNLOAD DEBUG 📱 STEP 1] Local Path:', localPath);

        let downloadedFileUri: string | null = null;
        try {
          console.log('[DOWNLOAD DEBUG 📱 STEP 2] Starting FileSystem.downloadAsync...');
          const startTime = Date.now();
          const downloadRes = await FileSystem.downloadAsync(rawTargetUri, localPath);
          const duration = Date.now() - startTime;
          console.log(`[DOWNLOAD DEBUG 📱 STEP 2] Download completed in ${duration}ms | Status: ${downloadRes?.status} | URI: ${downloadRes?.uri}`);
          if (downloadRes && downloadRes.uri) {
            downloadedFileUri = downloadRes.uri;
          }
        } catch (dlErr: any) {
          console.error('[DOWNLOAD DEBUG ❌ STEP 2 DOWNLOAD CRASH]:', dlErr);
          Alert.alert('Download File Error', `FileSystem.downloadAsync error: ${dlErr?.message || String(dlErr)}`);
        }

        if (!downloadedFileUri) {
          console.warn('[DOWNLOAD DEBUG ❌ STEP 2] downloadedFileUri is null!');
          showToast('Failed to download photo file');
          return;
        }

        console.log('[DOWNLOAD DEBUG 📱 STEP 3] Checking MediaLibrary permissions...');
        let hasPermission = false;
        try {
          const perm = await MediaLibrary.requestPermissionsAsync();
          console.log('[DOWNLOAD DEBUG 📱 STEP 3] Permission result:', JSON.stringify(perm));
          hasPermission = perm.status === 'granted';
        } catch (pErr: any) {
          console.error('[DOWNLOAD DEBUG ❌ STEP 3 PERMISSION CRASH]:', pErr);
        }

        if (hasPermission) {
          console.log('[DOWNLOAD DEBUG 📱 STEP 4] Saving photo asset to device Photos Library...');
          try {
            if (typeof (MediaLibrary as any).saveToLibraryAsync === 'function') {
              console.log('[DOWNLOAD DEBUG 📱 STEP 4] Calling MediaLibrary.saveToLibraryAsync...');
              await (MediaLibrary as any).saveToLibraryAsync(downloadedFileUri);
              console.log('[DOWNLOAD DEBUG ✅ STEP 4 SUCCESS] Photo saved via saveToLibraryAsync!');
              showToast('Photo saved to Photos! ✨');
              return;
            } else if (typeof MediaLibrary.createAssetAsync === 'function') {
              console.log('[DOWNLOAD DEBUG 📱 STEP 4] Calling MediaLibrary.createAssetAsync...');
              const asset = await MediaLibrary.createAssetAsync(downloadedFileUri);
              console.log('[DOWNLOAD DEBUG ✅ STEP 4 SUCCESS] Created Asset:', JSON.stringify(asset));
              if (asset) {
                showToast('Photo saved to Photos! ✨');
                return;
              }
            }
          } catch (saveErr: any) {
            console.error('[DOWNLOAD DEBUG ❌ STEP 4 SAVE CRASH]:', saveErr);
          }
        }

        console.log('[DOWNLOAD DEBUG 📱 STEP 5] Attempting Native Sharing fallback...');
        try {
          if (Sharing && typeof Sharing.isAvailableAsync === 'function' && (await Sharing.isAvailableAsync())) {
            console.log('[DOWNLOAD DEBUG 📱 STEP 5] Launching Sharing.shareAsync...');
            await Sharing.shareAsync(downloadedFileUri, {
              mimeType: 'image/jpeg',
              UTI: 'public.jpeg',
            });
            console.log('[DOWNLOAD DEBUG ✅ STEP 5 SUCCESS] Sharing sheet displayed!');
            showToast('Photo ready to save');
            return;
          }
        } catch (shareErr: any) {
          console.error('[DOWNLOAD DEBUG ❌ STEP 5 SHARING CRASH]:', shareErr);
        }

        showToast('Save failed, please check permissions');
      }
    } catch (err: any) {
      console.error('[DOWNLOAD DEBUG ❌ UNHANDLED TOP-LEVEL CRASH]:', err);
      Alert.alert('Download Error', `Unhandled error in handleDownload: ${err?.message || String(err)}`);
      showToast('Save failed');
    } finally {
      setIsDownloading(false);
      console.log('[DOWNLOAD DEBUG 🏁] handleDownload finished');
    }
  };

  // 120 FPS Un-Squeezed Uniform Scale Expansion (translateX, translateY, scale)
  const heroAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    const p = expandProgress.value;
    const cx_grid = thumbX.value + thumbW.value / 2;
    const cy_grid = thumbY.value + thumbH.value / 2;
    const cx_screen = width / 2;
    const cy_screen = screenHeight / 2;

    const initialScale = Math.max(thumbW.value / width, 0.12);
    const scale = initialScale + (1 - initialScale) * p;

    const translateX = (cx_grid - cx_screen) * (1 - p);
    const translateY = (cy_grid - cy_screen) * (1 - p);

    return {
      transform: [{ translateX }, { translateY }, { scale }],
      borderRadius: (1 - p) * 16,
      overflow: 'hidden',
      opacity: p > 0.001 ? 1 : 0,
    };
  });

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: '#000000',
    opacity: expandProgress.value,
  }));

  const controlsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: isZoomed ? 0 : expandProgress.value,
  }));

  const toastAnimatedStyle = useAnimatedStyle(() => ({
    opacity: toastOpacity.value,
  }));

  // Auto-generate dynamic category label (e.g. "STORY TITLE · CATEGORY")
  const getDisplaySubtitle = () => {
    if (subtitle) return subtitle.toUpperCase();
    let cat = '';
    if (currentItem && typeof currentItem === 'object') {
      if (currentItem.category) cat = String(currentItem.category).toUpperCase();
      else if (currentItem.eventTitle) cat = String(currentItem.eventTitle).toUpperCase();
    }
    const mainTitle = title.toUpperCase();
    if (cat && cat !== mainTitle) {
      return `${mainTitle}  ·  ${cat}`;
    }
    return mainTitle;
  };

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <LightboxImageItem
        item={item}
        width={width}
        onDoubleTap={handleToggleSave}
        onNavigate={(dir) => {
          if (dir === 'next' && activeIdx < images.length - 1) {
            flatListRef.current?.scrollToIndex({ index: activeIdx + 1, animated: true });
          } else if (dir === 'prev' && activeIdx > 0) {
            flatListRef.current?.scrollToIndex({ index: activeIdx - 1, animated: true });
          }
        }}
        onZoomChange={(zoomed) => {
          // FIX 2: Re-appear controls and restart auto-hide timer when zooming back out (zoomed === false)
          setIsZoomed(zoomed);
          if (zoomed) {
            setShowControls(false);
            pauseAutoHideTimer();
          } else {
            setShowControls(true);
            resetAutoHideTimer();
          }
        }}
        onToggleControls={() => {
          if (!isZoomed) {
            setShowControls((prev) => !prev);
            resetAutoHideTimer();
          }
        }}
        onCloseLightbox={handleClose}
        onInteractionStart={pauseAutoHideTimer}
        onInteractionEnd={resetAutoHideTimer}
        expandProgress={expandProgress}
        heartPopScale={heartPopScale}
        heartPopOpacity={heartPopOpacity}
      />
    ),
    [activeIdx, images.length, isZoomed, handleClose, handleToggleSave, resetAutoHideTimer, pauseAutoHideTimer]
  );

  if (!visible || images.length === 0) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Full-screen Dark Backdrop */}
        <Animated.View style={[StyleSheet.absoluteFillObject, backdropAnimatedStyle]} pointerEvents="none" />

        <View style={styles.lightboxContainer}>
          <StatusBar barStyle="light-content" translucent backgroundColor="transparent" hidden={!showControls || isZoomed} animated />

          {/* Toast Notification Banner */}
          {toastMsg && (
            <Animated.View
              style={[styles.toastBanner, { top: Math.max(insets.top + 75, 100) }, toastAnimatedStyle]}
              pointerEvents="none"
            >
              <Ionicons name="bookmark" size={14} color="#FFD700" style={{ marginRight: 8 }} />
              <Text style={styles.toastText}>{toastMsg}</Text>
            </Animated.View>
          )}

          {/* Animated Hero Stage (GPU Hardware Accelerated 120 FPS Transform Stage) */}
          <Animated.View
            style={[
              StyleSheet.absoluteFillObject,
              { justifyContent: 'center', alignItems: 'center' },
              heroAnimatedStyle,
            ]}
          >
            <View style={styles.lightboxImageContainer}>
              <FlatList
                ref={flatListRef}
                data={images}
                horizontal
                pagingEnabled={false}
                disableIntervalMomentum={true}
                snapToAlignment="center"
                decelerationRate="fast"
                snapToInterval={width + 18}
                scrollEnabled={!isZoomed}
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={initialIndex}
                contentOffset={{ x: (width + 18) * initialIndex, y: 0 }}
                initialNumToRender={3}
                maxToRenderPerBatch={3}
                windowSize={5}
                getItemLayout={(_data, index) => ({
                  length: width + 18,
                  offset: (width + 18) * index,
                  index,
                })}
                scrollEventThrottle={16}
                onScroll={(e) => {
                  const nextIdx = Math.round(e.nativeEvent.contentOffset.x / (width + 18));
                  if (nextIdx >= 0 && nextIdx < images.length && nextIdx !== activeIdx) {
                    setActiveIdx(nextIdx);
                  }
                }}
                onScrollBeginDrag={() => {
                  setShowControls(true);
                  pauseAutoHideTimer();
                }}
                onMomentumScrollEnd={(e) => {
                  const nextIdx = Math.round(e.nativeEvent.contentOffset.x / (width + 18));
                  if (nextIdx >= 0 && nextIdx < images.length) {
                    setActiveIdx(nextIdx);
                  }
                  resetAutoHideTimer();
                }}
                extraData={activeIdx}
                keyExtractor={(item, index) =>
                  typeof item === 'object' && item?.id
                    ? `lb-${item.id}`
                    : typeof item === 'object' && (item?.r2Url || item?.url || item?.photoUrl)
                    ? `lb-${item.r2Url || item.url || item.photoUrl}`
                    : `lb-${index}`
                }
                ItemSeparatorComponent={() => <View style={{ width: 18, backgroundColor: 'transparent' }} />}
                renderItem={renderItem}
              />
            </View>
          </Animated.View>

          {/* Top Editorial Header Gradient Overlay */}
          {showControls && !isZoomed && (
            <Animated.View style={[styles.lightboxHeaderGradient, controlsAnimatedStyle]} pointerEvents="box-none">
              <LinearGradient
                colors={['rgba(0, 0, 0, 0.45)', 'rgba(0, 0, 0, 0.1)', 'transparent']}
                style={[{ width: '100%', paddingTop: Math.max(insets.top + 18, 54) }]}
                pointerEvents="box-none"
              >
                <View style={styles.lightboxHeaderInner}>
                  <View style={styles.headerSpacer} />
                  <View style={styles.lightboxHeaderBrand}>
                    <Text style={styles.lightboxBrandText}>MISTY VISUALS</Text>
                    <Text style={styles.lightboxBrandSub}>EDITORIAL</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [
                      styles.lightboxCloseEditorial,
                      pressed && { opacity: 0.6 },
                    ]}
                    onPress={handleClose}
                    hitSlop={14}
                  >
                    <Text style={styles.lightboxCloseIcon}>✕</Text>
                  </Pressable>
                </View>
              </LinearGradient>
            </Animated.View>
          )}

          {/* Bottom Editorial Footer Gradient Overlay */}
          {showControls && !isZoomed && (
            <Animated.View style={[styles.lightboxFooterGradient, controlsAnimatedStyle]} pointerEvents="box-none">
              <LinearGradient
                colors={['transparent', 'rgba(0, 0, 0, 0.4)', 'rgba(0, 0, 0, 0.85)']}
                style={[{ width: '100%', alignItems: 'center', paddingHorizontal: 24, paddingBottom: Math.max(insets.bottom, 24) + 8 }]}
                pointerEvents="box-none"
              >
                <View style={{ alignItems: 'center', width: '100%' }}>
                  {/* High-Fashion Format Counter: e.g. "01 // 24" */}
                  <View style={styles.lightboxCounterContainer}>
                    <Text style={styles.lightboxCounterCurrent}>
                      {String(activeIdx + 1).padStart(2, '0')}
                    </Text>
                    <Text style={styles.lightboxCounterDivider}>//</Text>
                    <Text style={styles.lightboxCounterTotal}>
                      {String(images.length).padStart(2, '0')}
                    </Text>
                  </View>

                  <Text style={styles.lightboxCategoryText}>{getDisplaySubtitle()}</Text>

                  {/* Actions Row */}
                  <View style={styles.lightboxActionRow}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.lightboxIconOnlyBtn,
                        pressed && { opacity: 0.6 },
                      ]}
                      onPress={handleToggleSave}
                      hitSlop={14}
                    >
                      <Ionicons
                        name={isSaved ? 'heart' : 'heart-outline'}
                        size={21}
                        color={isSaved ? '#ef4444' : '#ffffff'}
                      />
                    </Pressable>

                    {enableDownload && (
                      <Pressable
                        style={({ pressed }) => [
                          styles.lightboxIconOnlyBtn,
                          pressed && { opacity: 0.6 },
                        ]}
                        onPress={() => {
                          handleDownload().catch((e) => console.warn('Download press error:', e));
                        }}
                        disabled={isDownloading}
                        hitSlop={14}
                      >
                        <Feather name="download" size={19} color="#ffffff" />
                      </Pressable>
                    )}

                    <Pressable
                      style={({ pressed }) => [
                        styles.lightboxIconOnlyBtn,
                        pressed && { opacity: 0.6 },
                      ]}
                      onPress={handleShare}
                      hitSlop={14}
                    >
                      <Feather name="share-2" size={18} color="#ffffff" />
                    </Pressable>
                  </View>
                </View>
              </LinearGradient>
            </Animated.View>
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  lightboxContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  toastBanner: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(20, 20, 20, 0.92)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 200,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  toastText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  lightboxHeaderGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  lightboxHeaderInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerSpacer: {
    width: 34,
    height: 34,
  },
  lightboxHeaderBrand: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  lightboxBrandText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 12,
    letterSpacing: 3.5,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '600',
  },
  lightboxBrandSub: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 9,
    letterSpacing: 4.5,
    color: 'rgba(255, 255, 255, 0.4)',
    fontWeight: '500',
  },
  lightboxCloseEditorial: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxCloseIcon: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 14,
    lineHeight: 14,
    fontWeight: '300',
  },
  lightboxImageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxFooterGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  lightboxCategoryText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    letterSpacing: 2,
    color: '#8c867e',
    fontWeight: '500',
    marginBottom: 10,
    textAlign: 'center',
  },
  lightboxCounterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  lightboxCounterCurrent: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 15,
    fontWeight: '500',
    color: '#ffffff',
    letterSpacing: 2,
  },
  lightboxCounterDivider: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: '#6e6962',
  },
  lightboxCounterTotal: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 12,
    color: '#8c867e',
    letterSpacing: 2,
  },
  lightboxActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    marginTop: 6,
  },
  lightboxIconOnlyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
