export function formatUniversalGalleryImages(
  rawImages: any[],
  fallbackTitle: string = 'GALLERY',
  fallbackCategory: string = 'GALLERY'
) {
  if (!Array.isArray(rawImages) || rawImages.length === 0) return [];

  return rawImages.map((p: any, idx: number) => {
    if (typeof p === 'string') {
      const isHorizontal = idx % 5 === 0;
      const verticalRatios = [2 / 3, 3 / 4, 4 / 5];
      const vertRatio = verticalRatios[idx % 3];
      const finalAspect = isHorizontal ? 3 / 2 : vertRatio;

      return {
        originalIndex: idx,
        id: `photo-${idx}-${p.slice(-10)}`,
        uri: p,
        fullUri: p,
        blurUri: null,
        width: null,
        height: null,
        aspectRatio: finalAspect,
        isHorizontal: isHorizontal,
        caption: fallbackTitle,
        category: fallbackCategory.trim(),
      };
    }

    const thumbUri =
      p.file_url_thumb ||
      p.file_url_mobile ||
      p.thumbnail_url ||
      p.thumbnailUrl ||
      p.mobile_url ||
      p.thumb_url ||
      p.preview_url ||
      p.r2Url ||
      p.file_url ||
      p.uri ||
      p.src ||
      p.url ||
      '';

    const fullUri =
      p.file_url ||
      p.r2Url ||
      p.file_url_mobile ||
      p.file_url_thumb ||
      p.thumbnail_url ||
      p.fullUri ||
      p.uri ||
      p.src ||
      p.url ||
      '';

    let originalAspect: number | null = null;
    if (p.aspect_ratio || p.aspectRatio) {
      originalAspect = Number(p.aspect_ratio || p.aspectRatio);
    } else if (p.width && p.height && Number(p.height) > 0) {
      originalAspect = Number(p.width) / Number(p.height);
    }

    const isHorizontal = originalAspect ? originalAspect > 1.05 : idx % 5 === 0;
    const verticalRatios = [2 / 3, 3 / 4, 4 / 5];
    const vertRatio = verticalRatios[idx % 3];

    const finalAspect = isHorizontal
      ? originalAspect && originalAspect > 1.0
        ? originalAspect
        : 3 / 2
      : originalAspect && originalAspect <= 1.0
      ? originalAspect
      : vertRatio;

    return {
      originalIndex: idx,
      id: p.id || `photo-${idx}`,
      uri: thumbUri,
      fullUri: fullUri,
      blurUri: p.blur_data_url || p.blurDataUrl || p.cover_blur_data_url || null,
      width: p.width ? Number(p.width) : null,
      height: p.height ? Number(p.height) : null,
      aspectRatio: finalAspect,
      isHorizontal: isHorizontal,
      caption: p.caption || p.title || p.alt || fallbackTitle,
      category: (
        p.tab_name ||
        p.tabName ||
        p.category ||
        p.tag ||
        p.tagName ||
        p.tab ||
        p.event_name ||
        p.eventName ||
        p.folder_name ||
        p.sub_folder ||
        fallbackCategory
      ).trim(),
    };
  });
}
