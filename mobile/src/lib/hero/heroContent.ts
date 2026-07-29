/**
 * heroContent.ts
 *
 * All editorial copy, message variants and content helpers for the Hero system.
 * The resolver calls these helpers rather than building strings inline.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveMessage {
  /** Primary headline text. */
  h: string;
  /** Supporting subtitle text. */
  s: string;
}

// ─── CTA labels ───────────────────────────────────────────────────────────────

export const HERO_CTA = {
  VIEW_GALLERY:    'View Gallery →',
  VIEW_HIGHLIGHTS: 'View Highlights →',
  RELIVE_GALLERY:  'Relive Gallery →',
} as const;

// ─── Welcome Hero ─────────────────────────────────────────────────────────────

/**
 * Curated editorial subtitles for the Welcome (fallback) Hero.
 * One is selected randomly at app launch and held stable for the session.
 */
export const WELCOME_EDITORIALS: readonly string[] = [
  'Discover beautiful celebrations captured by Misty Visuals.',
  'Every celebration has a story waiting to be explored.',
  'Explore our latest stories, films and moodboards.',
  'Relive beautiful moments and discover new ones.',
  'Love deserves to be remembered beautifully.',
  'Find inspiration through real celebrations.',
  'The finest moments are often the simplest.',
  'Some stories deserve another look.',
];

/**
 * Returns a randomly selected editorial message from WELCOME_EDITORIALS.
 */
export const pickWelcomeEditorial = (): string =>
  WELCOME_EDITORIALS[Math.floor(Math.random() * WELCOME_EDITORIALS.length)];

/**
 * Builds the time-aware greeting headline for the Welcome Hero.
 */
export const buildWelcomeHeadline = (firstName: string, hours: number): string => {
  const greet = hours < 12 ? 'Good Morning' : hours < 17 ? 'Good Afternoon' : 'Good Evening';
  return firstName ? `${greet}, ${firstName}.` : `${greet}.`;
};

// ─── Live Celebration Hero ────────────────────────────────────────────────────

export const LIVE_MESSAGE_VARIANTS: ReadonlyArray<(title: string) => LiveMessage> = [
  (title) => ({
    h: `Today, ${title} celebrate their love.`,
    s: 'Wishing them a lifetime of happiness.',
  }),
  (_) => ({
    h: 'What a beautiful day to celebrate together.',
    s: 'Celebrating beautiful beginnings.',
  }),
  (_) => ({
    h: "Here's to love, laughter and a lifetime of memories.",
    s: 'May every moment become a cherished memory.',
  }),
  (_) => ({
    h: 'May today be filled with unforgettable moments.',
    s: 'Celebrating beautiful beginnings.',
  }),
];

export const pickLiveMessage = (title: string): LiveMessage =>
  LIVE_MESSAGE_VARIANTS[Math.floor(Math.random() * LIVE_MESSAGE_VARIANTS.length)](title);

// ─── Face Matches Hero ────────────────────────────────────────────────────────

export const faceMatchCountLabel = (count: number, isNew: boolean): string => {
  if (count === 1) return isNew ? 'a new memory' : 'a memory';
  return isNew ? `${count} new memories` : `${count} memories`;
};

export const buildFaceMatchHeadlineSingle = (count: number, isNew: boolean): string =>
  `We found ${faceMatchCountLabel(count, isNew)} of you.`;

export const buildFaceMatchHeadlineMulti = (total: number): string =>
  `We found ${total === 1 ? 'a memory' : `${total} memories`} of you.`;

export const buildFaceMatchSubtitleSingle = (eventTitle: string): string =>
  `From ${eventTitle}'s celebration.`;

export const buildFaceMatchSubtitleMulti = (count: number): string =>
  `Across ${count} celebrations.`;

// ─── New Highlights Hero ──────────────────────────────────────────────────────

export const HIGHLIGHTS_COPY = {
  headline: (eventTitle: string) => `${eventTitle}'s highlights are ready.`,
  subtitle: 'Relive the most beautiful moments from their celebration.',
} as const;

// ─── Gallery Ready Hero (NEW) ─────────────────────────────────────────────────

export const GALLERY_READY_COPY = {
  headline: (eventTitle: string) => `${eventTitle}'s gallery is ready.`,
  subtitle: 'Relive every beautiful moment from their celebration.',
} as const;

// ─── Anniversary Hero ─────────────────────────────────────────────────────────

export const ANNIVERSARY_COPY = {
  todayHeadline: 'One year ago today...',
  todaySubtitle: (eventTitle: string) => `Relive ${eventTitle}'s celebration.`,
  countdownHeadline: (eventTitle: string, days: number) =>
    `${eventTitle} celebrate their anniversary in ${days} ${days === 1 ? 'day' : 'days'}.`,
  countdownSubtitle: 'Relive the memories before the big day.',
} as const;

// ─── Tomorrow / Two Days Hero ─────────────────────────────────────────────────

export const TOMORROW_COPY = {
  headline: 'Tomorrow is the big day.',
  subtitle: "We can't wait to capture every beautiful moment.",
} as const;

export const TWO_DAYS_COPY = {
  headline: 'Just 2 days to go.',
  subtitle: 'The celebrations begin very soon.',
} as const;

// ─── Upcoming Hero ────────────────────────────────────────────────────────────

export const UPCOMING_COPY = {
  headline: (eventTitle: string, days: number) =>
    `${eventTitle} celebrate in ${days} days.`,
  subtitle: 'Looking forward to celebrating together.',
} as const;
