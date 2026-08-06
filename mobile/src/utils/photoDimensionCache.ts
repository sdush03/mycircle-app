const aspectMap = new Map<string, number>();

export function savePhotoAspect(idOrUri: string | number | undefined, aspect: number): void {
  if (!idOrUri || !aspect || isNaN(aspect) || aspect <= 0) return;
  aspectMap.set(String(idOrUri), aspect);
}

export function getPhotoAspect(idOrUri: string | number | undefined): number | null {
  if (!idOrUri) return null;
  return aspectMap.get(String(idOrUri)) || null;
}
