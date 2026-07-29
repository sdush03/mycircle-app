/**
 * heroConfig.ts
 *
 * All Hero system configuration: durations, visibility windows,
 * AsyncStorage keys, and Tier 2 rotation weights.
 */

// ─── Visibility durations ─────────────────────────────────────────────────────

/** Duration constants in days (human-readable source of truth). */
export const HERO_DURATION_DAYS = {
  /** Face Matches hero remains visible for 7 days from first discovery. */
  FACE_MATCHES: 7,
  /** Highlights hero remains visible for 21 days from first discovery. */
  HIGHLIGHTS: 21,
  /** Gallery Ready hero remains visible for 21 days from first discovery. */
  GALLERY_READY: 21,
  /** Anniversary countdown window: show hero when anniversary is ≤14 days away. */
  ANNIVERSARY: 14,
} as const;

/** Pre-computed millisecond values derived from HERO_DURATION_DAYS. */
export const HERO_EXPIRY_MS = {
  FACE_MATCHES:  HERO_DURATION_DAYS.FACE_MATCHES  * 24 * 60 * 60 * 1000,
  HIGHLIGHTS:    HERO_DURATION_DAYS.HIGHLIGHTS     * 24 * 60 * 60 * 1000,
  GALLERY_READY: HERO_DURATION_DAYS.GALLERY_READY * 24 * 60 * 60 * 1000,
  ANNIVERSARY:   HERO_DURATION_DAYS.ANNIVERSARY    * 24 * 60 * 60 * 1000,
} as const;

// ─── Fade transition timings (ms) ────────────────────────────────────────────

export const HERO_TRANSITION = {
  /** Fade-out duration when hero type changes. */
  FADE_OUT_MS: 120,
  /** Fade-in duration after the new hero content mounts. */
  FADE_IN_MS: 200,
} as const;

// ─── AsyncStorage keys ────────────────────────────────────────────────────────

/** Centralised storage key registry — change a key in one place only. */
export const HERO_STORAGE_KEYS = {
  FACE_MATCHES:   '@mycircle_hero_seen_data',
  HIGHLIGHTS:     '@mycircle_highlights_hero_data',
  GALLERY_READY:  '@mycircle_gallery_ready_hero_data',
  TIER2_HISTORY:  '@mycircle_tier2_hero_history',
} as const;

// ─── Tier 2 Rotation Weights ──────────────────────────────────────────────────

/**
 * Editorial weights for Tier 2 rotation selection.
 * Higher weight = higher probability of selection.
 */
export const TIER2_HERO_WEIGHTS: Record<string, number> = {
  NEW_HIGHLIGHTS: 30,
  NEW_MATCHES: 30,
  GALLERY_READY: 20,
  UPCOMING: 15,
  WELCOME: 5,
};

// ─── Priority Architecture Reference ─────────────────────────────────────────

export const HERO_ARCHITECTURE = {
  TIER_1_TIME_SENSITIVE: [
    'LIVE',
    'TOMORROW',
    'UPCOMING_SHORT', // ≤ 7 days
    'ANNIVERSARY',
  ],
  TIER_2_EDITORIAL_ROTATION: [
    'NEW_HIGHLIGHTS',
    'NEW_MATCHES',
    'GALLERY_READY',
    'UPCOMING_LONG', // > 7 days
    'WELCOME',
  ],
} as const;
