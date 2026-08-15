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

  // Return unchanged if already a resize URL or local asset
  if (
    trimmed.includes('/api/gallery/resize') ||
    trimmed.startsWith('file:') ||
    trimmed.startsWith('ph:') ||
    trimmed.startsWith('data:') ||
    trimmed.includes('/cdn-cgi/image/')
  ) {
    return trimmed;
  }

  const base = (API_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/api/gallery/resize?url=${encodeURIComponent(trimmed)}&w=${width}&q=${quality}`;
}

/**
 * Resolves the thumbnail URI for an image item.
 * Always generates an on-the-fly resized URL from the full-resolution photo
 * and leverages Cloudflare Edge caching.
 */
export function getThumbnailUrl(
  p: any,
  width: number = 400,
  quality: number = 75
): string {
  if (!p) return '';
  if (typeof p === 'string') {
    return getResizedImageUrl(p, width, quality);
  }

  // Always use on-the-fly resizing from full-resolution original
  const fullUri = getFullPhotoUrl(p);
  return getResizedImageUrl(fullUri, width, quality);
}

/**
 * Resolves the original full-resolution 4K/high-res URI for Lightbox or full-screen viewing.
 */
export function getFullPhotoUrl(p: any): string {
  if (!p) return '';
  if (typeof p === 'string') return p;
  return (
    p.fullUri ||
    p.r2Url ||
    p.r2_url ||
    p.file_url ||
    p.url ||
    p.photoUrl ||
    p.imageUrl ||
    p.thumbnailUrl ||
    p.thumbnail_url ||
    p.file_url_mobile ||
    p.uri ||
    ''
  );
}
