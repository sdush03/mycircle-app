const aspectMap = new Map<string, number>();

export function savePhotoAspect(idOrUri: string | number | undefined, aspect: number): void {
  if (!idOrUri || !aspect || isNaN(aspect) || aspect <= 0) return;
  aspectMap.set(String(idOrUri), aspect);
}

export function getPhotoAspect(idOrUri: string | number | undefined): number | null {
  if (!idOrUri) return null;
  return aspectMap.get(String(idOrUri)) || null;
}

export function getPhotoCardAspect(item: any, index: number, isColumn0: boolean): number {
  if (!item) return 0.75;

  const cachedAspect = getPhotoAspect(item?.id) || getPhotoAspect(item?.uri) || getPhotoAspect(item?.r2Url);
  const w = Number(item?.width) || Number(item?.img_width) || Number(item?.imageWidth) || Number(item?.meta?.width) || Number(item?.metadata?.width) || Number(item?.exif?.PixelXDimension) || Number(item?.exif?.ImageWidth) || 0;
  const h = Number(item?.height) || Number(item?.img_height) || Number(item?.imageHeight) || Number(item?.meta?.height) || Number(item?.metadata?.height) || Number(item?.exif?.PixelYDimension) || Number(item?.exif?.ImageHeight) || 0;

  const realAspect = cachedAspect || (w > 0 && h > 0 ? w / h : (Number(item?.aspectRatio) > 0 ? Number(item.aspectRatio) : (Number(item?.aspect_ratio) > 0 ? Number(item.aspect_ratio) : null)));

  if (realAspect && realAspect > 0) {
    return realAspect;
  }

  if (item?.cardAspect && !isNaN(item.cardAspect)) {
    return item.cardAspect;
  }

  const isLandscape = Boolean(item?.isHorizontal);
  if (isLandscape) return 1.5;

  const cycle = (index + (isColumn0 ? 0 : 1)) % 3;
  return cycle === 0 ? 2 / 3 : (cycle === 1 ? 3 / 4 : 4 / 5);
}
