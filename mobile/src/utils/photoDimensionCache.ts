const aspectMap = new Map<string, number>();

export function savePhotoAspect(idOrUri: string | number | undefined, aspect: number): void {
  if (!idOrUri || !aspect || isNaN(aspect) || aspect <= 0) return;
  aspectMap.set(String(idOrUri), aspect);
}

export function getPhotoAspect(idOrUri: string | number | undefined): number | null {
  if (!idOrUri) return null;
  return aspectMap.get(String(idOrUri)) || null;
}

export function getPhotoCardAspect(
  item: any,
  index: number,
  isColumn0OrColIdx: boolean | number = 0,
  numColumns: number = 2,
): number {
  if (!item) return 0.75;

  // 1. If explicit cardAspect is specified, honor it
  if (item?.cardAspect && !isNaN(item.cardAspect) && item.cardAspect > 0) {
    return item.cardAspect;
  }

  // 2. Cinema / Video media handling
  if (item?.isVideo || (typeof item?.tabName === 'string' && item.tabName.trim().toUpperCase() === 'CINEMA')) {
    if (item?.isVertical || item?.isReel) return 9 / 16;
    return 16 / 9;
  }

  // 3. Check actual dimensions to distinguish landscape vs portrait
  const cachedAspect = getPhotoAspect(item?.id) || getPhotoAspect(item?.uri) || getPhotoAspect(item?.r2Url);
  const w = Number(item?.width) || Number(item?.img_width) || Number(item?.imageWidth) || Number(item?.meta?.width) || Number(item?.metadata?.width) || Number(item?.exif?.PixelXDimension) || Number(item?.exif?.ImageWidth) || 0;
  const h = Number(item?.height) || Number(item?.img_height) || Number(item?.imageHeight) || Number(item?.meta?.height) || Number(item?.metadata?.height) || Number(item?.exif?.PixelYDimension) || Number(item?.exif?.ImageHeight) || 0;

  const rawAspect = cachedAspect || (w > 0 && h > 0 ? w / h : (Number(item?.aspectRatio) > 0 ? Number(item.aspectRatio) : (Number(item?.aspect_ratio) > 0 ? Number(item.aspect_ratio) : null)));

  const isLandscape = Boolean(item?.isHorizontal || (rawAspect && rawAspect > 1.05));

  // In 1-column mode: photos should render as an immersive editorial feed
  if (numColumns === 1) {
    if (isLandscape) {
      return (rawAspect && rawAspect > 1.0) ? rawAspect : 1.5;
    }
    // For portraits in 1-column, preserve natural aspect clamped between 3/4 and 4/5
    return (rawAspect && rawAspect >= 0.75 && rawAspect <= 1.0) ? rawAspect : 4 / 5;
  }

  if (isLandscape) {
    // Landscape photos: use their real aspect ratio (e.g. 1.5, 1.33) or default to 3/2 (1.5)
    return (rawAspect && rawAspect > 1.0) ? rawAspect : 1.5;
  }

  // 4. Portrait photos: Cycle 2/3 → 3/4 → 4/5 for organic editorial masonry rhythm!
  // Deterministic calculation based on photo ID + column offset so cards stagger naturally
  const idNum = typeof item?.id === 'number'
    ? item.id
    : (typeof item?.id === 'string' ? item.id.split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0) : index);
  const safeId = (typeof idNum === 'number' && !isNaN(idNum)) ? idNum : (index || 0);
  const colOffset = typeof isColumn0OrColIdx === 'number' ? isColumn0OrColIdx : (isColumn0OrColIdx ? 0 : 1);
  const cycle = Math.abs((safeId || 0) + (colOffset || 0)) % 3;
  const result = cycle === 0 ? 2 / 3 : (cycle === 1 ? 3 / 4 : 4 / 5);
  return isNaN(result) || result <= 0 ? 0.75 : result;
}
