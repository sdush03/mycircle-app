import React, { useState, useRef, useCallback } from 'react';
import { StatusBar } from 'react-native';
import { Image } from 'expo-image';

export interface UseAutoHideTimerOptions {
  activeImageIndex: number | null;
  filteredGalleryImages: any[];
}

export function useAutoHideTimer({
  activeImageIndex,
  filteredGalleryImages,
}: UseAutoHideTimerOptions) {
  const [isZoomed, setIsZoomed] = useState(false);
  const [showControls, setShowControls] = useState(true);

  const autoHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pauseAutoHideTimer = useCallback(() => {
    if (autoHideTimeoutRef.current) {
      clearTimeout(autoHideTimeoutRef.current);
      autoHideTimeoutRef.current = null;
    }
  }, []);

  const resetAutoHideTimer = useCallback(() => {
    if (autoHideTimeoutRef.current) clearTimeout(autoHideTimeoutRef.current);
    autoHideTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 2800);
  }, []);

  const handleZoomChange = useCallback((zoomed: boolean) => {
    setIsZoomed(zoomed);
    if (zoomed) {
      setShowControls(false);
      if (autoHideTimeoutRef.current) clearTimeout(autoHideTimeoutRef.current);
    } else {
      setShowControls(true);
      resetAutoHideTimer();
    }
  }, [resetAutoHideTimer]);

  const handleToggleControls = useCallback(() => {
    setShowControls(prev => {
      const next = !prev;
      if (next) resetAutoHideTimer();
      else if (autoHideTimeoutRef.current) clearTimeout(autoHideTimeoutRef.current);
      return next;
    });
  }, [resetAutoHideTimer]);

  // Imperatively hide/show StatusBar when single tapping in Lightbox or zooming
  React.useEffect(() => {
    if (activeImageIndex !== null) {
      StatusBar.setHidden(!showControls, 'fade');
    } else {
      StatusBar.setHidden(false, 'fade');
    }
    return () => {
      StatusBar.setHidden(false, 'fade');
    };
  }, [activeImageIndex, showControls]);

  // Reset controls & timer whenever changing photo, plus prefetch adjacent images
  React.useEffect(() => {
    if (activeImageIndex !== null) {
      setShowControls(true);
      setIsZoomed(false);
      resetAutoHideTimer();

      const prevImg = filteredGalleryImages[activeImageIndex - 1];
      const nextImg = filteredGalleryImages[activeImageIndex + 1];
      if (prevImg) {
        const url = typeof prevImg === 'object' ? (prevImg.fullUri || prevImg.uri) : prevImg;
        if (url) Image.prefetch(url, 'memory-disk');
      }
      if (nextImg) {
        const url = typeof nextImg === 'object' ? (nextImg.fullUri || nextImg.uri) : nextImg;
        if (url) Image.prefetch(url, 'memory-disk');
      }
    } else {
      if (autoHideTimeoutRef.current) clearTimeout(autoHideTimeoutRef.current);
    }
  }, [activeImageIndex, filteredGalleryImages, resetAutoHideTimer]);

  return {
    isZoomed,
    showControls,
    setShowControls,
    pauseAutoHideTimer,
    resetAutoHideTimer,
    handleZoomChange,
    handleToggleControls,
  };
}
