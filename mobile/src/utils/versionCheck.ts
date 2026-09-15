/**
 * Compares two semantic version strings (e.g. "1.1.6" and "1.2.0").
 * Returns true if currentVersion is strictly lower than minVersion.
 */
export function isVersionLower(currentVersion: string, minVersion: string): boolean {
  if (!currentVersion || !minVersion) return false;

  // Clean version strings (remove pre-release tags or build suffixes if present, e.g. "1.1.6-beta" -> "1.1.6")
  const cleanCurrent = currentVersion.split('-')[0].trim();
  const cleanMin = minVersion.split('-')[0].trim();

  const currentParts = cleanCurrent.split('.').map((num) => parseInt(num, 10) || 0);
  const minParts = cleanMin.split('.').map((num) => parseInt(num, 10) || 0);

  const maxLength = Math.max(currentParts.length, minParts.length);

  for (let i = 0; i < maxLength; i++) {
    const current = currentParts[i] ?? 0;
    const min = minParts[i] ?? 0;

    if (current < min) return true;
    if (current > min) return false;
  }

  return false;
}
