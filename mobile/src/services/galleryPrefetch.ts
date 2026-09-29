import api, { guestApi } from './api';
import { Image } from 'expo-image';
import { useAuthStore } from '../store/authStore';
import { getThumbnailUrl, getFullPhotoUrl } from '../utils/imageUrl';

export const prefetchEventGalleryData = async (eventSlug: string, passcode?: string | null) => {
  if (!eventSlug) return;
  try {
    const familyToken = useAuthStore.getState().token;
    if (!familyToken) return;

    // Skip if already freshly cached within 3 minutes
    const existing = useAuthStore.getState().getGalleryCache(eventSlug);
    if (existing && Date.now() - existing.timestamp < 3 * 60 * 1000) {
      return;
    }

    let data: any = null;
    let eventHeaders: Record<string, string> = { Authorization: `Bearer ${familyToken}` };
    let hasFullAccess: boolean = true;
    let details: any = null;

    try {
      const bundleRes = await guestApi.post(
        `/api/gallery/public/events/${eventSlug}/bundle`,
        { code: passcode || undefined },
        { headers: { Authorization: `Bearer ${familyToken}` } }
      );
      if (bundleRes.data?.success) {
        data = bundleRes.data;
        if (data.token) eventHeaders = { Authorization: `Bearer ${data.token}` };
        if (typeof data.guest?.hasFullAccess === 'boolean') hasFullAccess = data.guest.hasFullAccess;
        details = data.event;
      }
    } catch (_) {
      // /bundle not deployed on remote server yet, fall back to standard endpoints
    }

    const mapPhotoItem = (p: any) => {
      const fullUri = getFullPhotoUrl(p);
      const thumbUri = getThumbnailUrl(p, 400);
      return {
        id: p.id,
        r2Url: thumbUri,
        uri: thumbUri,
        fullUri: fullUri,
        photoUrl: fullUri,
        width: p.width,
        height: p.height,
        tabName: p.tabName || p.tab_name || null,
        blurhash: p.blurhash || p.blur_hash || p.blurHash || null,
        isLiked: typeof p.isLiked === 'boolean' ? p.isLiked : !!(p.likes && p.likes.length > 0),
        likeCount: typeof p.likeCount === 'number' ? p.likeCount : (typeof p.likesCount === 'number' ? p.likesCount : (p._count?.likes || 0)),
        title: p.title || p.exif?.title || p.name || p.caption || p.filename || undefined,
        description: p.description || p.exif?.description || undefined,
        cinemaCategory: p.cinemaCategory || p.exif?.cinemaCategory || undefined,
        sortOrder: p.sortOrder !== undefined ? p.sortOrder : (p.exif?.sortOrder !== undefined ? p.exif.sortOrder : undefined),
        duration: p.duration || p.meta?.duration || p.metadata?.duration || undefined,
        isFeatured: Boolean(p.isFeatured || p.featured || p.meta?.isFeatured || p.exif?.isFeatured),
        category: p.category || p.videoCategory || p.meta?.category || undefined,
        createdAt:
          p.createdAt ||
          p.created_at ||
          p.uploadedAt ||
          p.uploaded_at ||
          p.uploadDate ||
          p.upload_date ||
          p.addedAt ||
          p.date ||
          p.timestamp ||
          p.meta?.createdAt ||
          p.meta?.created_at ||
          p.metadata?.createdAt ||
          p.metadata?.created_at ||
          p.exif?.DateTimeOriginal ||
          p.exif?.CreateDate ||
          undefined,
        created_at: p.created_at || p.createdAt || undefined,
        exif: p.exif || undefined,
        raw: p,
      };
    };

    let mappedPhotos: any[] = [];
    let mappedMatched: any[] = [];
    let mappedFavorites: any[] = [];
    let mappedCinema: any[] = [];
    let totalCount: number = 0;

    if (data) {
      mappedPhotos = Array.isArray(data.photos) ? data.photos.map(mapPhotoItem) : [];
      mappedMatched = Array.isArray(data.matched) ? data.matched.map(mapPhotoItem) : [];
      mappedFavorites = Array.isArray(data.favorites) ? data.favorites.map(mapPhotoItem) : [];
      mappedCinema = Array.isArray(data.cinema) ? data.cinema.map(mapPhotoItem) : [];
      totalCount = typeof data.total === 'number' ? data.total : mappedPhotos.length;
    } else {
      // Fallback prefetch using standard endpoints
      try {
        const ssoRes = await api.post(
          `/api/gallery/public/events/${eventSlug}/auth-from-family`,
          { code: passcode || undefined },
          { headers: { Authorization: `Bearer ${familyToken}` } }
        ).catch(() => ({ data: null }));

        if (ssoRes.data?.token) {
          eventHeaders = { Authorization: `Bearer ${ssoRes.data.token}` };
          if (typeof ssoRes.data?.guest?.hasFullAccess === 'boolean') {
            hasFullAccess = ssoRes.data.guest.hasFullAccess;
          }
        }

        const [eventRes, photosRes, favRes, cinemaRes] = await Promise.all([
          api.get(`/api/gallery/public/events/${eventSlug}`).catch(() => ({ data: null })),
          guestApi.get(`/api/gallery/public/events/${eventSlug}/photos?limit=60&offset=0`, { headers: eventHeaders }).catch(() => ({ data: [] })),
          guestApi.get(`/api/gallery/public/events/${eventSlug}/favorites`, { headers: eventHeaders }).catch(() => ({ data: [] })),
          guestApi.get(`/api/gallery/public/events/${eventSlug}/photos?tab=Cinema&limit=60&offset=0`, { headers: eventHeaders }).catch(() => ({ data: [] })),
        ]);

        details = eventRes.data;
        const rawPhotos = photosRes.data?.photos || (Array.isArray(photosRes.data) ? photosRes.data : []);
        mappedPhotos = Array.isArray(rawPhotos) ? rawPhotos.map(mapPhotoItem) : [];
        totalCount = typeof photosRes.data?.total === 'number' ? photosRes.data.total : mappedPhotos.length;

        const rawFavs = favRes.data?.photos || (Array.isArray(favRes.data) ? favRes.data : []);
        mappedFavorites = Array.isArray(rawFavs) ? rawFavs.map(mapPhotoItem) : [];

        const rawCinema = cinemaRes.data?.photos || (Array.isArray(cinemaRes.data) ? cinemaRes.data : []);
        mappedCinema = Array.isArray(rawCinema) ? rawCinema.map(mapPhotoItem) : [];
      } catch (fbErr) {
        console.warn('[MYCIRCLE PREFETCH ⚠️] Fallback prefetch error:', fbErr);
        return;
      }
    }

    const tabCache: Record<string, any[]> = {};
    if (mappedFavorites.length > 0) tabCache['MY FAVOURITES'] = mappedFavorites;
    if (mappedCinema.length > 0) tabCache['CINEMA'] = mappedCinema;

    // Pre-warm native image cache for cover photo
    if (details) {
      const cover = details.coverPhotoMobileUrl || details.coverPhotoUrl || details.coverUrl || details.bannerUrl;
      if (cover) Image.prefetch(cover);
    }

    // Pre-warm native image cache for top 12 photo thumbnails
    mappedPhotos.slice(0, 12).forEach((p: any) => {
      if (p.r2Url) Image.prefetch(p.r2Url);
    });

    useAuthStore.getState().setGalleryCache(eventSlug, {
      details: details || undefined,
      photos: mappedPhotos,
      matched: mappedMatched,
      favorites: mappedFavorites,
      headers: eventHeaders,
      total: totalCount,
      hasFullAccess: hasFullAccess,
      tabCache: tabCache,
    });
  } catch (err) {
    console.warn('[MYCIRCLE PREFETCH ⚠️] Background prefetch error:', err);
  }
};
