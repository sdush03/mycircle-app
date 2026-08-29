import { API_BASE_URL } from '../services/api';

/**
 * Generates an on-the-fly resized thumbnail URL using the backend resizing service.
 * Responses are automatically cached at the edge by Cloudflare with long max-age.
 *
 * @param url Full-resolution photo URL or source image URL
 * @param width Target image width in px (default: 400 for standard 2-column mobile masonry)
 * @param quality Compression quality 1-100 (default: 75)
 */
export function getResizedImageUrl(
  url?: string | null,
  width: number = 400,
  quality: number = 75
): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  // Return unchanged if already a resize URL, thumbs URL, or local asset
  if (
    trimmed.includes('/api/gallery/resize') ||
    trimmed.startsWith('file:') ||
    trimmed.startsWith('ph:') ||
    trimmed.startsWith('data:') ||
    trimmed.includes('/cdn-cgi/image/')
  ) {
    return trimmed;
  }

  // If on mistyvisuals CDN and has /desktop/, directly use CDN /thumbs/ path for instant edge caching
  if (trimmed.includes('gallery.mistyvisuals.com') && trimmed.includes('/desktop/')) {
    return trimmed.replace('/desktop/', '/thumbs/');
  }

  const base = (API_BASE_URL || '').replace(/\/+$/, '');
  const fullUrl = trimmed.startsWith('/') ? `${base}${trimmed}` : trimmed;
  return `${base}/api/gallery/resize?url=${encodeURIComponent(fullUrl)}&w=${width}&q=${quality}`;
}

/**
 * Resolves the thumbnail URI for an image item.
 * Prioritizes pre-rendered CDN thumbnails (e.g. /thumbs/, thumbnailUrl) for 0ms edge load time,
 * and falls back to on-the-fly resizing from full-resolution original when no thumbnail exists.
 */
export function getThumbnailUrl(
  p: any,
  width: number = 400,
  quality: number = 75
): string {
  if (!p) return '';
  const base = (API_BASE_URL || '').replace(/\/+$/, '');
  if (typeof p === 'string') {
    const trimmed = p.trim();
    if (!trimmed) return '';
    if (trimmed.includes('gallery.mistyvisuals.com') && trimmed.includes('/desktop/')) {
      return trimmed.replace('/desktop/', '/thumbs/');
    }
    if (
      trimmed.includes('/thumbs/') ||
      trimmed.includes('/mobile/') ||
      trimmed.includes('/api/gallery/resize') ||
      trimmed.startsWith('file:') ||
      trimmed.startsWith('ph:') ||
      trimmed.startsWith('data:') ||
      trimmed.includes('/cdn-cgi/image/')
    ) {
      return trimmed.startsWith('/') ? `${base}${trimmed}` : trimmed;
    }
    const full = trimmed.startsWith('/') ? `${base}${trimmed}` : trimmed;
    return getResizedImageUrl(full, width, quality);
  }

  // 1. Direct CDN pre-rendered thumbnail properties from backend
  const directThumb =
    p.file_url_thumb ||
    p.thumbnailUrl ||
    p.thumbnail_url ||
    p.thumb_url ||
    p.preview_url ||
    p.file_url_mobile ||
    p.mobile_url ||
    p.thumbUrl ||
    p.grid_image_url ||
    p.r2Url ||
    p.uri;

  if (directThumb && typeof directThumb === 'string' && directThumb.trim()) {
    const trimmedThumb = directThumb.trim();
    if (trimmedThumb.includes('gallery.mistyvisuals.com') && trimmedThumb.includes('/desktop/')) {
      return trimmedThumb.replace('/desktop/', '/thumbs/');
    }
    if (
      trimmedThumb.includes('/thumbs/') ||
      trimmedThumb.includes('/mobile/') ||
      trimmedThumb.includes('/api/gallery/resize') ||
      trimmedThumb.startsWith('file:') ||
      trimmedThumb.startsWith('ph:') ||
      trimmedThumb.startsWith('data:') ||
      trimmedThumb.includes('/cdn-cgi/image/')
    ) {
      return trimmedThumb.startsWith('/') ? `${base}${trimmedThumb}` : trimmedThumb;
    }
    return trimmedThumb.startsWith('/') ? `${base}${trimmedThumb}` : trimmedThumb;
  }

  // 2. If photo URL is on mistyvisuals CDN with /desktop/, map to /thumbs/
  const fullUri = getFullPhotoUrl(p);
  if (fullUri && fullUri.includes('gallery.mistyvisuals.com') && fullUri.includes('/desktop/')) {
    return fullUri.replace('/desktop/', '/thumbs/');
  }

  // 3. Fallback: On-the-fly resizing from full-resolution original
  if (fullUri) {
    return getResizedImageUrl(fullUri, width, quality);
  }

  return '';
}

/**
 * Resolves the original full-resolution 4K/high-res URI for Lightbox or full-screen viewing.
 */
export function getFullPhotoUrl(p: any): string {
  if (!p) return '';
  const base = (API_BASE_URL || '').replace(/\/+$/, '');
  if (typeof p === 'string') {
    const trimmed = p.trim();
    if (!trimmed) return '';
    if (trimmed.includes('gallery.mistyvisuals.com') && trimmed.includes('/thumbs/')) {
      return trimmed.replace('/thumbs/', '/desktop/');
    }
    return trimmed.startsWith('/') ? `${base}${trimmed}` : trimmed;
  }
  const raw =
    p.fullUri ||
    p.r2Url ||
    p.r2_url ||
    p.file_url ||
    p.photoUrl ||
    p.photo_url ||
    p.imageUrl ||
    p.image_url ||
    p.url ||
    p.file_url_mobile ||
    p.thumbnailUrl ||
    p.thumbnail_url ||
    p.file_url_thumb ||
    p.uri ||
    '';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.includes('gallery.mistyvisuals.com') && trimmed.includes('/thumbs/')) {
      return trimmed.replace('/thumbs/', '/desktop/');
    }
    return trimmed.startsWith('/') ? `${base}${trimmed}` : trimmed;
  }
  return '';
}
