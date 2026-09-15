import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  StyleSheet,
  Modal,
  StatusBar,
  Image,
  AppState,
  AppStateStatus,
} from 'react-native';
import { useVideoPlayer, VideoPlayer } from 'expo-video';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { videoPreloadManager } from '../../services/videoPreloadManager';
import { videoDownloadManager } from '../../services/videoDownloadManager';
import { playbackFocusManager } from '../../services/playbackFocusManager';
import { videoWatchProgressManager } from '../../services/videoWatchProgressManager';
import { analyticsService } from '../../services/analyticsService';
import { HorizontalCinemaPlayer } from '../cinema/HorizontalCinemaPlayer';
import { VerticalCinemaPlayer } from '../cinema/VerticalCinemaPlayer';
import { classifyCinemaCategory, formatCinemaCategoryTitleCase, formatCinemaDisplayTitle, isVerticalVideo } from '../cinema/CinemaLibraryView';

interface CinemaVideoModalProps {
  visible: boolean;
  video: any | null;
  onClose: () => void;
  eventTitle?: string;
  allowDownloads?: boolean;
}

interface CommonPlayerProps {
  videoUrl: string;
  thumbnailUrl?: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  allowDownloads?: boolean;
  resumeTimeSec?: number;
  videoItem?: any;
  eventTitle?: string;
}

function VideoPlayerView({
  player,
  videoUrl,
  thumbnailUrl,
  title,
  subtitle,
  onClose,
  allowDownloads = true,
  resumeTimeSec,
  videoItem,
  eventTitle,
}: CommonPlayerProps & { player: VideoPlayer }) {
  const [playerStatus, setPlayerStatus] = useState<string>(player.status);
  const [isPlaying, setIsPlaying] = useState<boolean>(player.playing);
  const [bufferedSec, setBufferedSec] = useState<number>(player.bufferedPosition || 0);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(player.currentTime || 0);
  const [durationSec, setDurationSec] = useState<number>(player.duration || 0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBufferingOverlay, setIsBufferingOverlay] = useState<boolean>(false);

  // 4K Cinema Playback & Scrubbing State Engine:
  // Prevents the 300ms audio blip during scrub, prevents premature starts on empty buffer,
  // and auto-recovers from buffer underruns/stalls when scrubbing backwards or forwards.
  const userPausedRef = useRef<boolean>(false);
  const isStalledRef = useRef<boolean>(false);
  const isSeekingRef = useRef<boolean>(false);
  const seekTargetTimeRef = useRef<number | null>(null);
  const seekCommitTimeRef = useRef<number>(0);
  const seekSettlingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEndedRef = useRef<boolean>(false);
  const lastTimeRef = useRef<number>(-1);
  const wasPlayingBeforeBgRef = useRef<boolean>(false);
  const wasPlayingBeforeSeekRef = useRef<boolean>(true);
  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTickRef = useRef<number>(0);
  const hasResumedRef = useRef<boolean>(false);
  const videoViewRef = useRef<any>(null);
  const trackedMilestonesRef = useRef<Set<string>>(new Set());
  const videoId = videoItem?.id || videoItem?.uri || videoUrl;
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [seekRipple, setSeekRipple] = useState<{ direction: 'back' | 'forward'; id: number } | null>(null);
  const [resumedToastSec, setResumedToastSec] = useState<number | null>(resumeTimeSec && resumeTimeSec > 0 ? resumeTimeSec : null);

  useEffect(() => {
    if (resumedToastSec !== null) {
      const timer = setTimeout(() => {
        setResumedToastSec(null);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [resumedToastSec]);

  // Strict poster image check: NEVER pass .mp4 / video URL to ExpoImage
  const cleanThumbnailUrl = useMemo(() => {
    if (!thumbnailUrl || typeof thumbnailUrl !== 'string' || !thumbnailUrl.startsWith('http')) return undefined;
    const clean = thumbnailUrl.split('?')[0].toLowerCase();
    if (clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v') || clean.endsWith('.webm')) {
      return undefined;
    }
    return thumbnailUrl;
  }, [thumbnailUrl]);

  useEffect(() => {
    // 1. Claim 100% network & CPU focus for the entire duration this Cinema modal is open.
    // Suspends all background downloads, probes, and thumbnail prefetching.
    playbackFocusManager.notifyPlaybackStarted();

    console.log(`[CINEMA VIEW 🎬 MOUNT] URL: ${videoUrl.slice(0, 70)}... | Initial Status: ${player.status} | Playing: ${player.playing} | Buffered: ${player.bufferedPosition?.toFixed?.(2) ?? '?'}s | Duration: ${player.duration?.toFixed?.(2) ?? '?'}s`);

    try {
      player.timeUpdateEventInterval = 0.25;
      if (resumeTimeSec && resumeTimeSec > 0) {
        hasResumedRef.current = true;
        player.currentTime = resumeTimeSec;
        console.log(`[CINEMA RESUME ⏱️ MOUNT] Resumed at saved position: ${resumeTimeSec.toFixed(1)}s`);
      } else {
        player.currentTime = 0;
      }
    } catch {}

    // Ensure video is played immediately on mount for both horizontal & vertical
    userPausedRef.current = false;
    isEndedRef.current = false;
    if (player.status !== 'error') {
      try {
        player.muted = false;
        player.play();
        console.log(`[CINEMA VIEW 🎬 AUTO-PLAY] Immediate play() initiated on mount.`);
      } catch (e) {
        console.warn(`[CINEMA VIEW ⚠️] Immediate play() error:`, e);
      }
    }

    const statusSub = (player as any).addListener?.('statusChange', (payload: any) => {
      const newStatus = payload?.status || player.status;
      console.log(`[CINEMA EVENT 📡 STATUS] -> ${newStatus} (was: ${payload?.oldStatus}) | Playing: ${player.playing}`, payload?.error ? `| ❌ Error: ${JSON.stringify(payload?.error)}` : '');
      setPlayerStatus(newStatus);
      if (payload?.error) {
        const errText = payload.error.message || JSON.stringify(payload.error);
        setErrorMessage(errText);
        analyticsService.trackMediaError(videoId, 'VIDEO', 'PLAYBACK_ERROR', errText, 'CINEMA_MODAL', videoUrl);
      }

      if (newStatus === 'loading') {
        setIsBufferingOverlay(true);
      } else if (newStatus === 'readyToPlay') {
        setIsBufferingOverlay(false);
        if (resumeTimeSec && resumeTimeSec > 0 && (!hasResumedRef.current || Math.abs((player.currentTime || 0) - resumeTimeSec) > 2)) {
          hasResumedRef.current = true;
          try {
            player.currentTime = resumeTimeSec;
            console.log(`[CINEMA RESUME ⏱️ READY] Resumed at saved position: ${resumeTimeSec.toFixed(1)}s`);
          } catch {}
        } else if (!resumeTimeSec) {
          try {
            player.currentTime = 0;
          } catch {}
        }
        // Ensure audio is unmuted and playing if not paused by user
        if (!isSeekingRef.current && !userPausedRef.current) {
          player.muted = false;
          try {
            player.play();
          } catch {}
        }
      }
    });

    const playingSub = (player as any).addListener?.('playingChange', (payload: any) => {
      const playing = payload?.isPlaying ?? player.playing;
      setIsPlaying(playing);

      if (playing) {
        userPausedRef.current = false;
        isEndedRef.current = false;
        setIsBufferingOverlay(false);

        // Track START analytics event once per session
        if (!trackedMilestonesRef.current.has('START')) {
          trackedMilestonesRef.current.add('START');
          analyticsService.trackVideoPlayback(
            videoId,
            'START',
            { totalDurationSeconds: player.duration || 0 },
            'CINEMA_MODAL',
            videoUrl
          );
        }

        // Guarantee audio is unmuted during active playback!
        if (!isSeekingRef.current) {
          player.muted = false;
        }
      } else if (isEndedRef.current) {
        userPausedRef.current = true;
        setIsBufferingOverlay(false);
      }
    });

    const timeSub = (player as any).addListener?.('timeUpdate', (payload: any) => {
      const cur = payload?.currentTime ?? player.currentTime ?? 0;
      const buf = payload?.bufferedPosition ?? player.bufferedPosition ?? 0;
      if (typeof payload?.bufferedPosition === 'number') setBufferedSec(buf);

      // Guard against stale timeUpdate during and immediately after seeking:
      if (isSeekingRef.current && seekTargetTimeRef.current !== null) {
        if (Math.abs(cur - seekTargetTimeRef.current) > 1.0 && Date.now() - seekCommitTimeRef.current < 450) {
          return;
        }
      }

      if (typeof payload?.currentTime === 'number') setCurrentTimeSec(cur);

      lastTimeRef.current = cur;

      const dur = player.duration ?? 0;
      if (dur > 0 && cur > 0) {
        const ratio = cur / dur;
        if (ratio >= 0.25 && !trackedMilestonesRef.current.has('25')) {
          trackedMilestonesRef.current.add('25');
          analyticsService.trackVideoPlayback(videoId, 'MILESTONE_25', { watchTimeSeconds: cur, totalDurationSeconds: dur, completionRatio: ratio }, 'CINEMA_MODAL', videoUrl);
        }
        if (ratio >= 0.50 && !trackedMilestonesRef.current.has('50')) {
          trackedMilestonesRef.current.add('50');
          analyticsService.trackVideoPlayback(videoId, 'MILESTONE_50', { watchTimeSeconds: cur, totalDurationSeconds: dur, completionRatio: ratio }, 'CINEMA_MODAL', videoUrl);
        }
        if (ratio >= 0.75 && !trackedMilestonesRef.current.has('75')) {
          trackedMilestonesRef.current.add('75');
          analyticsService.trackVideoPlayback(videoId, 'MILESTONE_75', { watchTimeSeconds: cur, totalDurationSeconds: dur, completionRatio: ratio }, 'CINEMA_MODAL', videoUrl);
        }
      }

      // Persist watch progress periodically
      if (resumeTimeSec && resumeTimeSec > 2.0 && cur < 1.0) {
        return;
      }
      if (videoItem && dur > 0 && cur > 0) {
        videoWatchProgressManager.saveProgress(videoItem, cur, dur);
      }
    });

    const sourceLoadSub = (player as any).addListener?.('sourceLoad', () => {
      console.log(`[CINEMA EVENT 📦 SOURCE LOADED] Metadata loaded! Duration: ${player.duration?.toFixed(1) ?? '?'}s`);
      if (!isSeekingRef.current && !userPausedRef.current) {
        player.muted = false;
        try {
          player.play();
        } catch {}
      }
    });

    const endSub = (player as any).addListener?.('playToEnd', () => {
      console.log(`[CINEMA EVENT 🏁 PLAY TO END] Playback reached end of video.`);
      isEndedRef.current = true;
      userPausedRef.current = true;
      setIsBufferingOverlay(false);
      setIsCompleted(true);
      if (videoItem) {
        videoWatchProgressManager.markCompleted(videoItem);
      }
      if (!trackedMilestonesRef.current.has('COMPLETE')) {
        trackedMilestonesRef.current.add('COMPLETE');
        analyticsService.trackVideoPlayback(
          videoId,
          'COMPLETE',
          { watchTimeSeconds: player.duration || 0, totalDurationSeconds: player.duration || 0, completionRatio: 1.0 },
          'CINEMA_MODAL',
          videoUrl
        );
      }
    });

    // ── AppState Lifecycle (Background / Screen Cast Guard) ───────────────────
    // When the app moves to background (or phone is locked / user switches apps):
    // 1. If AirPlay / Screen Cast is NOT active: Pause playback immediately so it never plays in bg.
    // 2. If AirPlay / Screen Cast IS active: Allow TV playback to continue seamlessly in background.
    // 3. When app returns to foreground: Auto-resume if it was playing before backgrounding.
    const appStateSub = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const isExternal = Boolean((player as any)?.isExternalPlaybackActive);
      console.log(`[CINEMA APP_STATE 📱] State: ${nextAppState} | isExternal: ${isExternal} | playing: ${player.playing}`);

      if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (!isExternal) {
          if (player.playing && !userPausedRef.current) {
            wasPlayingBeforeBgRef.current = true;
            try {
              player.pause();
            } catch {}
            console.log('[CINEMA BG ⏸️] App backgrounded without AirPlay/Screen Cast — paused video.');
          } else {
            wasPlayingBeforeBgRef.current = false;
          }
        } else {
          console.log('[CINEMA BG 📺] App backgrounded WITH Screen Cast/AirPlay active — maintaining external stream on TV.');
        }
      } else if (nextAppState === 'active') {
        if (!isExternal && wasPlayingBeforeBgRef.current && !userPausedRef.current && !isEndedRef.current) {
          wasPlayingBeforeBgRef.current = false;
          try {
            player.muted = false;
            player.play();
            console.log('[CINEMA FG ▶️] App returned to active foreground — resumed playback.');
          } catch {}
        }
      }
    });

    // 400ms Heartbeat Watchdog:
    // Synchronizes UI state and ensures playback and audio are resilient
    const heartbeat = setInterval(() => {
      // Do NOT auto-resume in heartbeat if app is in background and AirPlay is not active!
      if (AppState.currentState !== 'active' && !(player as any)?.isExternalPlaybackActive) {
        return;
      }

      heartbeatTickRef.current += 1;
      const s = player.status;
      const p = player.playing;
      const buffered = player.bufferedPosition ?? 0;
      const current = player.currentTime ?? 0;
      const duration = player.duration ?? 0;
      const bufferedAhead = buffered - current;

      if (heartbeatTickRef.current % 5 === 0) {
        console.log(`[CINEMA HEARTBEAT 💓] Status: ${s} | Playing: ${p} | Buffered: ${buffered.toFixed(1)}s / ${duration.toFixed(1)}s | Current: ${current.toFixed(1)}s | Ahead: ${bufferedAhead.toFixed(1)}s`);
      }

      setPlayerStatus(s);
      setIsPlaying(p);
      if (player.bufferedPosition != null) setBufferedSec(buffered);
      if (player.currentTime != null) {
        const isStaleSeek = isSeekingRef.current && seekTargetTimeRef.current !== null && Math.abs(current - seekTargetTimeRef.current) > 1.0 && Date.now() - seekCommitTimeRef.current < 450;
        if (!isStaleSeek) {
          setCurrentTimeSec(current);
        }
      }
      if (player.duration != null) setDurationSec(duration);

      const isNearEnd = duration > 0 && current >= duration - 0.2;
      if (isNearEnd) {
        isEndedRef.current = true;
        setIsCompleted(true);
      } else if (current < duration - 1.5) {
        isEndedRef.current = false;
        setIsCompleted(false);
      }

      // Audio safety: if playing and not seeking, guarantee audio is never left muted
      if (p && !isSeekingRef.current && player.muted) {
        player.muted = false;
      }

      // Auto-resume if stalled by network (not user-paused, not ended, not seeking, not error)
      // When AirPlay is active to TV, do NOT force play() or interfere with the TV's independent buffering
      const isExternal = (player as any).isExternalPlaybackActive;
      if (!p && !userPausedRef.current && !isEndedRef.current && !isSeekingRef.current && s !== 'error') {
        if (!isExternal) {
          if (bufferedAhead >= 0.5 || s === 'readyToPlay') {
            player.muted = false;
            try {
              player.play();
            } catch {}
            setIsBufferingOverlay(false);
          } else {
            setIsBufferingOverlay(true);
          }
        }
      }
    }, 400);

    return () => {
      clearInterval(heartbeat);
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      appStateSub?.remove?.();
      statusSub?.remove?.();
      playingSub?.remove?.();
      timeSub?.remove?.();
      sourceLoadSub?.remove?.();
      endSub?.remove?.();
      try {
        if (!isEndedRef.current) {
          const cur = player.currentTime ?? 0;
          const dur = player.duration ?? 0;
          const isStaleZero = resumeTimeSec && resumeTimeSec > 2.0 && cur < 1.0;
          if (!isStaleZero && videoItem && dur > 0 && cur > 0) {
            if (cur / dur >= 0.9) {
              videoWatchProgressManager.markCompleted(videoItem);
            } else {
              videoWatchProgressManager.saveProgress(videoItem, cur, dur);
            }
          }
        }
      } catch {}
      try {
        player.allowsExternalPlayback = false; // Disconnect AirPlay route on close
        player.showNowPlayingNotification = false;
      } catch {}
      playbackFocusManager.notifyPlaybackStopped();
      console.log(`[CINEMA VIEW 🎬 UNMOUNT] Closed for URL: ${videoUrl.slice(0, 50)}...`);
    };
  }, [player, videoUrl]);

  const handleClose = useCallback(() => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      // Always disconnect AirPlay and stop playback on the player directly,
      // because returnPlayer() no-ops if the URL isn't in the preload cache (new player path).
      player.allowsExternalPlayback = false;
      player.showNowPlayingNotification = false;
      player.pause();
      if (videoUrl) {
        videoPreloadManager.returnPlayer(videoUrl);
      }
    } catch {}
    onClose();
  }, [player, videoUrl, onClose]);

  const onPlayPauseToggle = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (player.playing) {
      userPausedRef.current = true;
      player.pause();
    } else {
      userPausedRef.current = false;
      isEndedRef.current = false;
      setIsCompleted(false);
      player.play();
    }
  }, [player]);

  const onReplay = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      player.currentTime = 0;
      setCurrentTimeSec(0);
      setIsCompleted(false);
      isEndedRef.current = false;
      userPausedRef.current = false;
      player.muted = false;
      player.play();
    } catch {}
  }, [player]);

  const lastSeekThrottleRef = useRef(0);
  const seekThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSeekStart = useCallback(() => {
    isSeekingRef.current = true;
  }, []);

  const onSeek = useCallback((targetTimeSec: number) => {
    seekTargetTimeRef.current = targetTimeSec;
    seekCommitTimeRef.current = Date.now();
    setCurrentTimeSec(targetTimeSec);
    const now = Date.now();
    // Throttle native AVPlayer currentTime assignments to ~80ms intervals during active drag
    if (now - lastSeekThrottleRef.current > 80) {
      lastSeekThrottleRef.current = now;
      try {
        player.currentTime = targetTimeSec;
      } catch {}
    } else {
      if (seekThrottleTimerRef.current) clearTimeout(seekThrottleTimerRef.current);
      seekThrottleTimerRef.current = setTimeout(() => {
        try {
          player.currentTime = targetTimeSec;
        } catch {}
      }, 80);
    }
  }, [player]);

  const onSeekEnd = useCallback((targetTimeSec: number) => {
    if (seekThrottleTimerRef.current) clearTimeout(seekThrottleTimerRef.current);
    if (seekSettlingTimerRef.current) clearTimeout(seekSettlingTimerRef.current);
    seekTargetTimeRef.current = targetTimeSec;
    seekCommitTimeRef.current = Date.now();
    try {
      player.currentTime = targetTimeSec;
      setCurrentTimeSec(targetTimeSec);
      player.muted = false;
      if (!userPausedRef.current && player.status !== 'error') {
        player.play();
      }
    } catch {}
    // Keep isSeekingRef active for 400ms after seek release to block stale async timeUpdate ticks
    seekSettlingTimerRef.current = setTimeout(() => {
      isSeekingRef.current = false;
      seekTargetTimeRef.current = null;
    }, 400);
  }, [player]);

  const onDoubleTapSeek = useCallback((direction: 'back' | 'forward') => {
    const delta = direction === 'forward' ? 10 : -10;
    const dur = player.duration || 0;
    const cur = player.currentTime || 0;
    const target = Math.max(0, Math.min(dur, cur + delta));
    try {
      player.currentTime = target;
      setCurrentTimeSec(target);
    } catch {}
    setSeekRipple({ direction, id: Date.now() });
    setTimeout(() => setSeekRipple(null), 600);
  }, [player]);

  const onRestartFromBeginning = useCallback(() => {
    try {
      player.currentTime = 0;
      setCurrentTimeSec(0);
      setResumedToastSec(null);
      player.muted = false;
      player.play();
      if (videoItem) {
        videoWatchProgressManager.clearProgress(videoItem);
      }
    } catch {}
  }, [player, videoItem]);

  // Ground-truth runtime track size from expo-video
  const [trackSize, setTrackSize] = useState<{ width: number; height: number } | null>(() => {
    const size = (player as any)?.videoTrack?.size;
    if (size && size.width > 0 && size.height > 0) {
      return { width: size.width, height: size.height };
    }
    return null;
  });

  useEffect(() => {
    const trackSub = (player as any).addListener?.('videoTrackChange', (payload: any) => {
      const size = payload?.videoTrack?.size || (player as any)?.videoTrack?.size;
      if (size && size.width > 0 && size.height > 0) {
        setTrackSize({ width: size.width, height: size.height });
      }
    });
    return () => {
      trackSub?.remove?.();
    };
  }, [player]);

  const isVertical = useMemo(() => {
    // 1. If player has loaded runtime video track size, it is the ultimate ground truth
    if (trackSize && trackSize.width > 0 && trackSize.height > 0) {
      return trackSize.height > trackSize.width;
    }

    // 2. Explicit metadata and category check via unified helper
    if (isVerticalVideo(videoItem)) {
      return true;
    }

    // 3. Fallback keyword checks on title/subtitle
    const titleClean = (title || '').toLowerCase();
    const subClean = (subtitle || '').toLowerCase();
    if (
      titleClean.includes('reel') ||
      titleClean.includes('vertical') ||
      titleClean.includes('short') ||
      subClean.includes('candid') ||
      subClean.includes('reel')
    ) {
      return true;
    }

    // 4. If explicit dimensions are present (ignoring synthetic 16x9 or 9x16 fallbacks)
    const rawW = Number(videoItem?.videoWidth || videoItem?.exif?.videoWidth || videoItem?.width || videoItem?.meta?.width) || 0;
    const rawH = Number(videoItem?.videoHeight || videoItem?.exif?.videoHeight || videoItem?.height || videoItem?.meta?.height) || 0;
    if (rawW > 0 && rawH > 0 && !(rawW === 16 && rawH === 9) && !(rawW === 9 && rawH === 16)) {
      return rawH > rawW;
    }

    return false;
  }, [trackSize, videoItem, title, subtitle]);

  if (isVertical) {
    return (
      <VerticalCinemaPlayer
        player={player}
        videoViewRef={videoViewRef}
        cleanThumbnailUrl={cleanThumbnailUrl}
        title={title}
        subtitle={subtitle}
        onClose={handleClose}
        currentTimeSec={currentTimeSec}
        durationSec={durationSec}
        bufferedSec={bufferedSec}
        isPlaying={isPlaying}
        isBuffering={isBufferingOverlay || playerStatus === 'loading'}
        isCompleted={isCompleted}
        isError={playerStatus === 'error'}
        errorMessage={errorMessage}
        onPlayPauseToggle={onPlayPauseToggle}
        onSeekStart={onSeekStart}
        onSeek={onSeek}
        onSeekEnd={onSeekEnd}
        onReplay={onReplay}
        onDoubleTapSeek={onDoubleTapSeek}
        seekRipple={seekRipple}
        resumedToastSec={resumedToastSec}
        onRestartFromBeginning={onRestartFromBeginning}
      />
    );
  }

  return (
    <HorizontalCinemaPlayer
      player={player}
      videoViewRef={videoViewRef}
      cleanThumbnailUrl={cleanThumbnailUrl}
      title={title}
      subtitle={subtitle}
      eventTitle={eventTitle}
      videoItem={videoItem}
      onClose={handleClose}
      currentTimeSec={currentTimeSec}
      durationSec={durationSec}
      bufferedSec={bufferedSec}
      isPlaying={isPlaying}
      isBuffering={isBufferingOverlay || playerStatus === 'loading'}
      isCompleted={isCompleted}
      isError={playerStatus === 'error'}
      errorMessage={errorMessage}
      onPlayPauseToggle={onPlayPauseToggle}
      onSeekStart={onSeekStart}
      onSeek={onSeek}
      onSeekEnd={onSeekEnd}
      onReplay={onReplay}
      onDoubleTapSeek={onDoubleTapSeek}
      seekRipple={seekRipple}
      resumedToastSec={resumedToastSec}
      onRestartFromBeginning={onRestartFromBeginning}
    />
  );
}

function VideoPlayerContentWithNewPlayer(props: CommonPlayerProps) {
  // CRITICAL FOR TV AIRPLAY: Smart TVs (Samsung, Hisense, LG, Roku) run third-party
  // AirPlay 2 receiver SDKs that require a network-reachable HTTP/HTTPS URL.
  // If initialized with a local sandbox file:// URL, Smart TVs hang on the AirPlay splash screen.
  const effectiveUrl = props.videoUrl;
  console.log(`[CINEMA MODAL 🎬] Creating new player for: ${effectiveUrl.slice(0, 60)}...`);
  const player = useVideoPlayer(
    {
      uri: effectiveUrl,
      metadata: {
        title: props.title || 'The Wedding Film',
        artist: props.subtitle || "Director's Cut",
        artwork: props.thumbnailUrl || undefined,
      },
    },
    (p) => {
      p.loop = false;
      p.muted = false;
      p.audioMixingMode = 'auto';
      p.allowsExternalPlayback = true;
      p.showNowPlayingNotification = true;
      if (props.resumeTimeSec && props.resumeTimeSec > 0) {
        try {
          p.currentTime = props.resumeTimeSec;
          console.log(`[CINEMA NEW PLAYER 🎬] Pre-seeked to resume time: ${props.resumeTimeSec.toFixed(1)}s`);
        } catch {}
      } else {
        try {
          p.currentTime = 0;
        } catch {}
      }
      p.bufferOptions = {
        waitsToMinimizeStalling: true,
        preferredForwardBufferDuration: 0, // 0 allows iOS and TV to negotiate optimal forward buffer
      };
      console.log(`[CINEMA MODAL 🎬] New player initialized, calling play()...`);
      p.play();
    }
  );

  return <VideoPlayerView player={player} {...props} />;
}

function VideoPlayerContentWithPreloaded(props: CommonPlayerProps & { player: VideoPlayer }) {
  useEffect(() => {
    props.player.loop = false;
    props.player.muted = false;
    props.player.audioMixingMode = 'auto';
    props.player.allowsExternalPlayback = true;
    props.player.showNowPlayingNotification = true;
    if (props.resumeTimeSec && props.resumeTimeSec > 0) {
      try {
        props.player.currentTime = props.resumeTimeSec;
        console.log(`[CINEMA PRELOAD ⚡] Pre-seeked immediately to ${props.resumeTimeSec.toFixed(1)}s`);
      } catch (e) {
        console.warn(`[CINEMA PRELOAD ⚠️] Pre-seek error:`, e);
      }
    } else {
      try {
        props.player.currentTime = 0;
      } catch {}
    }
    props.player.bufferOptions = {
      waitsToMinimizeStalling: true,
      preferredForwardBufferDuration: 0,
    };
    console.log(`[CINEMA MODAL ⚡ PRELOAD HIT] Mounted with pre-buffered player! Status: ${props.player.status} | Buffered: ${props.player.bufferedPosition?.toFixed(2)}s | Target Resume: ${props.resumeTimeSec ?? 0}s`);
    
    // 50ms settle tick so modal fade animation settles before hardware decode starts
    const timer = setTimeout(() => {
      try {
        if (props.resumeTimeSec && props.resumeTimeSec > 0) {
          props.player.currentTime = props.resumeTimeSec;
          console.log(`[CINEMA PRELOAD ⚡ TIMER] Applied seek to ${props.resumeTimeSec.toFixed(1)}s before play()`);
        }
        console.log(`[CINEMA MODAL 🎬] Calling play() on pre-buffered player at position ${props.player.currentTime?.toFixed?.(1) ?? '?'}s...`);
        props.player.play();
      } catch (e) {
        console.warn(`[CINEMA MODAL ⚠️] play() error:`, e);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [props.player, props.resumeTimeSec]);

  return <VideoPlayerView {...props} />;
}

function extractCleanVideoUrl(video: any): string | null {
  if (!video) return null;
  if (typeof video === 'string') {
    const l = video.toLowerCase();
    if (l.endsWith('.jpg') || l.endsWith('.jpeg') || l.endsWith('.png') || l.endsWith('.webp')) return null;
    return video;
  }

  // Prioritize true video URLs over images
  const candidates = [
    video.videoUrl,
    video.fullUri,
    video.photoUrl,
    video.file_url,
    video.r2Url,
    video.uri,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('http')) {
      const lower = c.toLowerCase();
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp')) {
        continue;
      }
      return c;
    }
  }
  return null;
}

export function CinemaVideoModal({
  visible,
  video,
  onClose,
  eventTitle,
  allowDownloads = true,
}: CinemaVideoModalProps) {
  const videoUrl = extractCleanVideoUrl(video);
  const cleanThumbnailUrl = useMemo(() => {
    const raw = video?.thumbnailUrl || video?.thumbUri || video?.preview_url;
    if (!raw || typeof raw !== 'string' || !raw.startsWith('http')) return undefined;
    const clean = raw.split('?')[0].toLowerCase();
    if (clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v') || clean.endsWith('.webm')) {
      return undefined;
    }
    return raw;
  }, [video]);
  // Derive clean Couple + Video Title, Category Subtitle, and Logo Artwork for in-app & TV AirPlay
  const airplayMeta = useMemo(() => {
    // Construct Line 1: Couple + Title (e.g. "Soumi Abhinav Wedding Trailer")
    const displayTitle = formatCinemaDisplayTitle(eventTitle, video);

    // Category: "Director's Cut", "Candid Diaries", "Stage & Spotlight", "Extended Cuts"
    let cat = "Director's Cut";
    try {
      const explicit = (video?.cinemaCategory || video?.category || video?.exif?.cinemaCategory || '').trim();
      const classified = explicit || classifyCinemaCategory(video);
      cat = formatCinemaCategoryTitleCase(classified);
    } catch {}

    // Artist / Subtitle for TV & App: clean category without studio postfix
    const artist = cat;

    // Artwork: Thumbnail URL or Misty Visuals logo
    let artwork: string | undefined = cleanThumbnailUrl;
    if (!artwork) {
      try {
        const resolved = Image.resolveAssetSource(require('../../../assets/images/logo-glow.png'));
        artwork = resolved?.uri;
      } catch {}
    }

    return {
      displayTitle,
      categorySubtitle: cat,
      artist,
      artwork,
    };
  }, [video, eventTitle, cleanThumbnailUrl]);

  // Check if a warm pre-buffered player instance is already in cache
  const preloadedPlayer = useMemo(() => {
    if (visible && videoUrl) {
      const p = videoPreloadManager.takePlayer(videoUrl);
      if (p && (p.status as any) !== 'error') {
        return p;
      }
    }
    return null;
  }, [visible, videoUrl]);

  useEffect(() => {
    if (visible && videoUrl) {
      console.log(`[CINEMA MODAL 🎬 OPEN] Title: "${airplayMeta.displayTitle}" | Preloaded: ${!!preloadedPlayer} | URL: ${videoUrl.slice(0, 60)}...`);
    }
  }, [visible, videoUrl, airplayMeta.displayTitle, preloadedPlayer]);

  return (
    <Modal
      visible={visible && !!videoUrl}
      animationType="fade"
      transparent={true}
      presentationStyle="overFullScreen"
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.modalRoot}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        {visible && videoUrl ? (
          preloadedPlayer ? (
            <VideoPlayerContentWithPreloaded
              player={preloadedPlayer}
              videoUrl={videoUrl}
              thumbnailUrl={airplayMeta.artwork}
              title={airplayMeta.displayTitle}
              subtitle={airplayMeta.artist}
              onClose={onClose}
              allowDownloads={allowDownloads}
              resumeTimeSec={video?.resumeTimeSec}
              videoItem={video}
              eventTitle={eventTitle}
            />
          ) : (
            <VideoPlayerContentWithNewPlayer
              videoUrl={videoUrl}
              thumbnailUrl={airplayMeta.artwork}
              title={airplayMeta.displayTitle}
              subtitle={airplayMeta.artist}
              onClose={onClose}
              allowDownloads={allowDownloads}
              resumeTimeSec={video?.resumeTimeSec}
              videoItem={video}
              eventTitle={eventTitle}
            />
          )
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
