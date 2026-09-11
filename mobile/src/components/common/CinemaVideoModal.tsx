import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  StyleSheet,
  Modal,
  StatusBar,
} from 'react-native';
import { useVideoPlayer, VideoPlayer } from 'expo-video';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { videoPreloadManager } from '../../services/videoPreloadManager';
import { videoDownloadManager } from '../../services/videoDownloadManager';
import { playbackFocusManager } from '../../services/playbackFocusManager';
import { videoWatchProgressManager } from '../../services/videoWatchProgressManager';
import { HorizontalCinemaPlayer } from '../cinema/HorizontalCinemaPlayer';
import { VerticalCinemaPlayer } from '../cinema/VerticalCinemaPlayer';

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
  const isEndedRef = useRef<boolean>(false);
  const lastTimeRef = useRef<number>(-1);
  const wasPlayingBeforeSeekRef = useRef<boolean>(true);
  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTickRef = useRef<number>(0);
  const hasResumedRef = useRef<boolean>(false);
  const videoViewRef = useRef<any>(null);
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
    } catch {}

    const statusSub = (player as any).addListener?.('statusChange', (payload: any) => {
      const newStatus = payload?.status || player.status;
      console.log(`[CINEMA EVENT 📡 STATUS] -> ${newStatus} (was: ${payload?.oldStatus}) | Playing: ${player.playing}`, payload?.error ? `| ❌ Error: ${JSON.stringify(payload?.error)}` : '');
      setPlayerStatus(newStatus);
      if (payload?.error) {
        setErrorMessage(payload.error.message || JSON.stringify(payload.error));
      }

      if (newStatus === 'loading') {
        // Scrubbing or buffering started. Mute audio immediately to prevent random audio chirps!
        player.muted = true;
        isStalledRef.current = true;
        setIsBufferingOverlay(true);
      } else if (newStatus === 'readyToPlay') {
        if (resumeTimeSec && resumeTimeSec > 0 && !hasResumedRef.current) {
          hasResumedRef.current = true;
          try {
            player.currentTime = resumeTimeSec;
            console.log(`[CINEMA RESUME ⏱️] Resumed at saved position: ${resumeTimeSec.toFixed(1)}s`);
          } catch {}
        }
        const cur = player.currentTime ?? 0;
        const buf = player.bufferedPosition ?? 0;
        const bufferedAhead = buf - cur;
        if (bufferedAhead < 2.0 && !userPausedRef.current) {
          console.log(`[CINEMA STATUS BUFFER ⏳] Status readyToPlay but buffer ahead is only ${bufferedAhead.toFixed(1)}s < 2.0s. Holding pause & mute until buffer reaches 2.0s...`);
          player.muted = true;
          try { player.pause(); } catch {}
          isStalledRef.current = true;
          setIsBufferingOverlay(true);
        } else if (bufferedAhead >= 2.0 && !userPausedRef.current && !isEndedRef.current) {
          console.log(`[CINEMA STATUS BUFFER ✅] Status readyToPlay with healthy buffer (${bufferedAhead.toFixed(1)}s). Unmuting & playing!`);
          player.muted = false;
          try { player.play(); } catch {}
          isStalledRef.current = false;
          setIsBufferingOverlay(false);
        }
      }
    });

    const playingSub = (player as any).addListener?.('playingChange', (payload: any) => {
      const playing = payload?.isPlaying ?? player.playing;
      const cur = player.currentTime ?? 0;
      const buf = player.bufferedPosition ?? 0;
      const dur = player.duration ?? 0;
      const bufferedAhead = buf - cur;

      console.log(`[CINEMA EVENT ▶️ PLAYING] isPlaying: ${playing} | Buffer: ${buf.toFixed(1)}s | Current: ${cur.toFixed(1)}s | Ahead: ${bufferedAhead.toFixed(1)}s`);
      setIsPlaying(playing);

      if (playing) {
        userPausedRef.current = false;
        isEndedRef.current = false;
        if (bufferedAhead >= 1.5) {
          player.muted = false;
          isStalledRef.current = false;
          setIsBufferingOverlay(false);
        } else if (bufferedAhead < 1.0 && isSeekingRef.current) {
          // Premature play right after a seek with < 1.0s buffer:
          // Immediately pause and mute to avoid playing a 300ms audio blip before freezing!
          console.log(`[CINEMA PLAY GUARD 🛡️] Premature play after seek (only ${bufferedAhead.toFixed(1)}s buffer). Pausing & muting to prevent glitch!`);
          player.muted = true;
          try { player.pause(); } catch {}
          isStalledRef.current = true;
          setIsBufferingOverlay(true);
        }
      } else if (isEndedRef.current) {
          userPausedRef.current = true;
          setIsBufferingOverlay(false);
        } else if (bufferedAhead < 1.0 || isStalledRef.current || isSeekingRef.current) {
          // Buffer starvation / seek underrun (e.g. backward scrub to unbuffered section)
          console.log(`[CINEMA STALL ⚠️] Player stalled (buffer ahead: ${bufferedAhead.toFixed(1)}s). Watchdog will auto-resume once buffer >= 2.0s.`);
          isStalledRef.current = true;
          userPausedRef.current = false;
          setIsBufferingOverlay(true);
        } else {
          // Intentional user pause during smooth playback
          console.log(`[CINEMA EVENT ⏸️] User paused playback at ${cur.toFixed(1)}s (buffer ahead: ${bufferedAhead.toFixed(1)}s).`);
          userPausedRef.current = true;
          isStalledRef.current = false;
          setIsBufferingOverlay(false);
        }
    });

    const timeSub = (player as any).addListener?.('timeUpdate', (payload: any) => {
      const cur = payload?.currentTime ?? player.currentTime ?? 0;
      const buf = payload?.bufferedPosition ?? player.bufferedPosition ?? 0;
      if (typeof payload?.bufferedPosition === 'number') setBufferedSec(buf);
      if (typeof payload?.currentTime === 'number') setCurrentTimeSec(cur);

      const prevTime = lastTimeRef.current;
      lastTimeRef.current = cur;

      // Playhead jump detection (> 1.2s jump = scrubbing / seeking)
      if (prevTime >= 0 && Math.abs(cur - prevTime) > 1.2) {
        console.log(`[CINEMA SEEK ⏩] Jump detected: ${prevTime.toFixed(1)}s -> ${cur.toFixed(1)}s`);
        isSeekingRef.current = true;
        wasPlayingBeforeSeekRef.current = !userPausedRef.current;

        const bufferedAhead = buf - cur;
        if (bufferedAhead < 2.0 && wasPlayingBeforeSeekRef.current) {
          console.log(`[CINEMA SEEK BUFFER 🛡️] Buffer at seek point is only ${bufferedAhead.toFixed(1)}s. Muting & pausing until buffer >= 2.0s...`);
          player.muted = true;
          try { player.pause(); } catch {}
          isStalledRef.current = true;
          setIsBufferingOverlay(true);
        }

        if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
        seekTimeoutRef.current = setTimeout(() => {
          isSeekingRef.current = false;
        }, 1000);
      }

      // Persist watch progress periodically
      const dur = player.duration ?? 0;
      if (videoItem && dur > 0 && cur > 0) {
        videoWatchProgressManager.saveProgress(videoItem, cur, dur);
      }
    });

    const sourceLoadSub = (player as any).addListener?.('sourceLoad', () => {
      console.log(`[CINEMA EVENT 📦 SOURCE LOADED] Metadata loaded! Duration: ${player.duration?.toFixed(1) ?? '?'}s`);
    });

    const endSub = (player as any).addListener?.('playToEnd', () => {
      console.log(`[CINEMA EVENT 🏁 PLAY TO END] Playback reached end of video.`);
      isEndedRef.current = true;
      userPausedRef.current = true;
      setIsBufferingOverlay(false);
      setIsCompleted(true);
      if (videoItem) {
        videoWatchProgressManager.clearProgress(videoItem);
      }
    });

    // 400ms Heartbeat Watchdog:
    // When AVPlayer stalls on iOS due to buffer starvation, Apple's internal clock stops,
    // which prevents periodic time observers from firing. This JavaScript interval runs
    // continuously, monitoring buffer fill from Cloudflare R2 and auto-resuming playback
    // as soon as a healthy 2.0s cushion is reached!
    const heartbeat = setInterval(() => {
      heartbeatTickRef.current += 1;
      const s = player.status;
      const p = player.playing;
      const buffered = player.bufferedPosition ?? 0;
      const current = player.currentTime ?? 0;
      const duration = player.duration ?? 0;
      const bufferedAhead = buffered - current;

      if (heartbeatTickRef.current % 3 === 0) {
        console.log(`[CINEMA HEARTBEAT 💓] Status: ${s} | Playing: ${p} | Buffered: ${buffered.toFixed(1)}s / ${duration.toFixed(1)}s | Current: ${current.toFixed(1)}s | Ahead: ${bufferedAhead.toFixed(1)}s`);
      }

      setPlayerStatus(s);
      setIsPlaying(p);
      if (player.bufferedPosition != null) setBufferedSec(buffered);
      if (player.currentTime != null) setCurrentTimeSec(current);
      if (player.duration != null) setDurationSec(duration);

      const isNearEnd = duration > 0 && current >= duration - 0.2;
      if (isNearEnd) {
        isEndedRef.current = true;
        setIsCompleted(true);
      } else if (current < duration - 1.5) {
        isEndedRef.current = false;
        setIsCompleted(false);
      }

      // If playback is not active, not intentionally paused by the user, and not at the end:
      if (!p && !userPausedRef.current && !isEndedRef.current && s !== 'error') {
        if (bufferedAhead >= 2.0) {
          console.log(`[CINEMA WATCHDOG 🐕] Buffer ready (${bufferedAhead.toFixed(1)}s ahead >= 2.0s). Auto-resuming playback at ${current.toFixed(1)}s!`);
          player.muted = false;
          try {
            player.play();
          } catch {}
          isStalledRef.current = false;
          setIsBufferingOverlay(false);
        } else {
          // Buffer still filling up
          setIsBufferingOverlay(true);
        }
      }
    }, 400);

    return () => {
      clearInterval(heartbeat);
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      statusSub?.remove?.();
      playingSub?.remove?.();
      timeSub?.remove?.();
      sourceLoadSub?.remove?.();
      endSub?.remove?.();
      try {
        if (!isEndedRef.current) {
          const cur = player.currentTime ?? 0;
          const dur = player.duration ?? 0;
          if (videoItem && dur > 0 && cur > 0) {
            videoWatchProgressManager.saveProgress(videoItem, cur, dur);
          }
        }
      } catch {}
      playbackFocusManager.notifyPlaybackStopped();
      console.log(`[CINEMA VIEW 🎬 UNMOUNT] Closed for URL: ${videoUrl.slice(0, 50)}...`);
    };
  }, [player, videoUrl]);

  const handleClose = useCallback(() => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (videoUrl) {
        videoPreloadManager.returnPlayer(videoUrl);
      } else {
        player.pause();
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
      player.play();
    } catch {}
  }, [player]);

  const onSeekStart = useCallback(() => {
    player.muted = true;
    isSeekingRef.current = true;
  }, [player]);

  const onSeek = useCallback((targetTimeSec: number) => {
    try {
      player.currentTime = targetTimeSec;
      setCurrentTimeSec(targetTimeSec);
    } catch {}
  }, [player]);

  const onSeekEnd = useCallback((targetTimeSec: number) => {
    try {
      player.currentTime = targetTimeSec;
      setCurrentTimeSec(targetTimeSec);
    } catch {}
    isSeekingRef.current = false;
    if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
    seekTimeoutRef.current = setTimeout(() => {
      const cur = player.currentTime ?? 0;
      const buf = player.bufferedPosition ?? 0;
      if (buf - cur >= 1.5 && !userPausedRef.current) {
        player.muted = false;
      }
    }, 350);
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
      if (videoItem) {
        videoWatchProgressManager.clearProgress(videoItem);
      }
    } catch {}
  }, [player, videoItem]);

  const videoW = Number(videoItem?.videoWidth || videoItem?.exif?.videoWidth || videoItem?.width || videoItem?.meta?.width) || 0;
  const videoH = Number(videoItem?.videoHeight || videoItem?.exif?.videoHeight || videoItem?.height || videoItem?.meta?.height) || 0;
  const isExplicitHorizontal = videoW > 0 && videoH > 0 && videoW > videoH;

  const isVertical = !isExplicitHorizontal && (
    (videoH > 0 && videoW > 0 && videoH > videoW) ||
    (videoItem?.aspectRatio && videoItem.aspectRatio < 0.95) ||
    (videoItem?.category && videoItem.category.toLowerCase().includes('reel')) ||
    (title && title.toLowerCase().includes('reel'))
  );

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
  const localPath = videoDownloadManager.getLocalPath(props.videoUrl);
  const effectiveUrl = localPath ? (localPath.startsWith('file://') ? localPath : `file://${localPath}`) : props.videoUrl;
  console.log(`[CINEMA MODAL 🎬] Creating new player for: ${effectiveUrl.slice(0, 60)}... (isLocal: ${!!localPath})`);
  const player = useVideoPlayer(effectiveUrl, (p) => {
    p.loop = false;
    p.audioMixingMode = 'doNotMix';
    p.bufferOptions = {
      waitsToMinimizeStalling: true,
      preferredForwardBufferDuration: 15,
    };
    console.log(`[CINEMA MODAL 🎬] New player initialized, calling play()...`);
    p.play();
  });

  return <VideoPlayerView player={player} {...props} />;
}

function VideoPlayerContentWithPreloaded(props: CommonPlayerProps & { player: VideoPlayer }) {
  useEffect(() => {
    props.player.loop = false;
    props.player.audioMixingMode = 'doNotMix';
    props.player.bufferOptions = {
      waitsToMinimizeStalling: true,
      preferredForwardBufferDuration: 15,
    };
    console.log(`[CINEMA MODAL ⚡ PRELOAD HIT] Mounted with pre-buffered player! Status: ${props.player.status} | Buffered: ${props.player.bufferedPosition?.toFixed(2)}s`);
    
    // 50ms settle tick so modal fade animation settles before hardware decode starts
    const timer = setTimeout(() => {
      try {
        console.log(`[CINEMA MODAL 🎬] Calling play() on pre-buffered player...`);
        props.player.play();
      } catch (e) {
        console.warn(`[CINEMA MODAL ⚠️] play() error:`, e);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [props.player]);

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
  const title = video?.title || video?.filename || eventTitle || 'Cinema Film';
  const subtitle = video?.tabName || 'CINEMA';

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
      console.log(`[CINEMA MODAL 🎬 OPEN] Title: "${title}" | Preloaded: ${!!preloadedPlayer} | URL: ${videoUrl.slice(0, 60)}...`);
    }
  }, [visible, videoUrl, title, preloadedPlayer]);

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
              thumbnailUrl={cleanThumbnailUrl}
              title={title}
              subtitle={subtitle}
              onClose={onClose}
              allowDownloads={allowDownloads}
              resumeTimeSec={video?.resumeTimeSec}
              videoItem={video}
            />
          ) : (
            <VideoPlayerContentWithNewPlayer
              videoUrl={videoUrl}
              thumbnailUrl={cleanThumbnailUrl}
              title={title}
              subtitle={subtitle}
              onClose={onClose}
              allowDownloads={allowDownloads}
              resumeTimeSec={video?.resumeTimeSec}
              videoItem={video}
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
    backgroundColor: '#000000',
  },
});
