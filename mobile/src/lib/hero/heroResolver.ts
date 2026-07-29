/**
 * heroResolver.ts
 *
 * Two-Tier Hero Resolver Architecture
 *
 * Tier 1 — Time Sensitive (evaluated top-down; strict priority, no randomness/rotation)
 *   1. LIVE (entire wedding day)
 *   2. TOMORROW (exactly 1 day before)
 *   3. UPCOMING (wedding within next 7 days)
 *   4. ANNIVERSARY (within 14-day window)
 *
 * Tier 2 — Editorial Rotation (evaluated only if NO Tier 1 Hero matches)
 *   Candidates:
 *     - NEW_HIGHLIGHTS (21-day window, resets on new highlights)
 *     - NEW_MATCHES (7-day window, resets on new face matches)
 *     - GALLERY_READY (21-day window, resets on new gallery photos)
 *     - UPCOMING (>7 days away)
 *     - WELCOME (fallback)
 *
 * Selection in Tier 2 uses a session-locked Weighted + Least Recently Shown algorithm.
 */

import { HeroType, HeroCard } from './heroTypes';
import { HERO_EXPIRY_MS, TIER2_HERO_WEIGHTS, HERO_DURATION_DAYS } from './heroConfig';
import {
  buildWelcomeHeadline,
  buildFaceMatchHeadlineSingle,
  buildFaceMatchHeadlineMulti,
  buildFaceMatchSubtitleSingle,
  buildFaceMatchSubtitleMulti,
  HIGHLIGHTS_COPY,
  GALLERY_READY_COPY,
  ANNIVERSARY_COPY,
  TOMORROW_COPY,
  UPCOMING_COPY,
  HERO_CTA,
} from './heroContent';

export interface HeroResolverParams {
  events: any[];
  heroSeenData: Record<string, { lastSeenCount: number; firstSeenAt: number }>;
  highlightsHeroData: Record<string, { firstShownAt: number; lastSeenCount: number }>;
  galleryReadyHeroData: Record<string, { firstShownAt: number; lastSeenCount: number }>;
  tier2History: Record<string, { lastShownAt: number }>;
  profileName?: string | null;
  today: Date;
  welcomeEditorial: string;
  getStableLiveMessage: (slug: string, title: string) => { h: string; s: string };
  sessionTier2Ref: React.MutableRefObject<HeroCard | null>;
}

// Same day comparison helper
const isSameDay = (d1: Date, d2: Date) =>
  d1.getFullYear() === d2.getFullYear() &&
  d1.getMonth() === d2.getMonth() &&
  d1.getDate() === d2.getDate();

// Calendar days difference helper (midnight-to-midnight)
const getCalendarDaysDifference = (targetDate: Date, currentDate: Date): number => {
  const d1 = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const d2 = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  return Math.round((d1.getTime() - d2.getTime()) / 86400000);
};

/**
 * Primary Home Hero Resolver
 */
export function resolveHomeHero(params: HeroResolverParams): HeroCard | null {
  // ─── TIER 1: Time Sensitive (Strict Priority, No Randomness, No Rotation) ──
  const tier1Card = evaluateTier1(params);
  if (tier1Card) {
    return tier1Card;
  }

  // ─── TIER 2: Session-Based Editorial Rotation (Weighted + Least Recently Shown) ──
  return evaluateTier2(params);
}

// ─── Tier 1 Evaluators ───────────────────────────────────────────────────────

function evaluateTier1(params: HeroResolverParams): HeroCard | null {
  const { events: evts, today: now, getStableLiveMessage } = params;

  // 1. LIVE (entire wedding day)
  for (const ev of evts) {
    const eventDate = new Date(ev.date || Date.now());
    if (ev.stage === 'LIVE' || isSameDay(eventDate, now)) {
      const pick = getStableLiveMessage(ev.slug, ev.title);
      return {
        type: HeroType.LIVE,
        headline: pick.h,
        subtitle: pick.s,
        cta: '',
        eventSlug: ev.slug,
      };
    }
  }

  // 2. TOMORROW (exactly 1 day before)
  for (const ev of evts) {
    const eventDate = new Date(ev.date || Date.now());
    if (ev.stage === 'UPCOMING' || (eventDate > now && !isSameDay(eventDate, now))) {
      const days = getCalendarDaysDifference(eventDate, now);
      if (days === 1) {
        return {
          type: HeroType.TOMORROW,
          headline: TOMORROW_COPY.headline,
          subtitle: TOMORROW_COPY.subtitle,
          cta: '',
          eventSlug: ev.slug,
        };
      }
    }
  }

  // 3. UPCOMING (within next 7 days)
  for (const ev of evts) {
    const eventDate = new Date(ev.date || Date.now());
    if (ev.stage === 'UPCOMING' || (eventDate > now && !isSameDay(eventDate, now))) {
      const days = getCalendarDaysDifference(eventDate, now);
      if (days > 1 && days <= 7) {
        return {
          type: HeroType.UPCOMING,
          headline: UPCOMING_COPY.headline(ev.title, days),
          subtitle: UPCOMING_COPY.subtitle,
          cta: '',
          eventSlug: ev.slug,
        };
      }
    }
  }

  // 4. ANNIVERSARY (within 14-day window)
  for (const ev of evts) {
    const eventDate = new Date(ev.date || Date.now());
    if (eventDate < now && !isSameDay(eventDate, now)) {
      const yr = eventDate.getFullYear();
      const mo = eventDate.getMonth();
      const dy = eventDate.getDate();
      if (yr < now.getFullYear()) {
        let nextAnniv = new Date(now.getFullYear(), mo, dy);
        if (nextAnniv < now && !isSameDay(nextAnniv, now)) {
          nextAnniv = new Date(now.getFullYear() + 1, mo, dy);
        }
        const isToday = isSameDay(nextAnniv, now);
        const daysUntil = Math.ceil((nextAnniv.getTime() - now.getTime()) / 86400000);
        if (isToday) {
          return {
            type: HeroType.ANNIVERSARY,
            headline: ANNIVERSARY_COPY.todayHeadline,
            subtitle: ANNIVERSARY_COPY.todaySubtitle(ev.title),
            cta: HERO_CTA.RELIVE_GALLERY,
            eventSlug: ev.slug,
          };
        } else if (daysUntil <= HERO_DURATION_DAYS.ANNIVERSARY && daysUntil > 0) {
          return {
            type: HeroType.ANNIVERSARY,
            headline: ANNIVERSARY_COPY.countdownHeadline(ev.title, daysUntil),
            subtitle: ANNIVERSARY_COPY.countdownSubtitle,
            cta: HERO_CTA.RELIVE_GALLERY,
            eventSlug: ev.slug,
          };
        }
      }
    }
  }

  return null;
}

// ─── Tier 2 Evaluators ───────────────────────────────────────────────────────

function evaluateTier2(params: HeroResolverParams): HeroCard | null {
  const { sessionTier2Ref } = params;

  // 1. Session Locking: If a Tier 2 Hero is already selected for this app session, return it
  if (sessionTier2Ref.current) {
    return sessionTier2Ref.current;
  }

  // 2. Gather all eligible Tier 2 candidate cards
  const candidates: HeroCard[] = [];

  const highlightsCard = evalNewHighlights(params);
  if (highlightsCard) candidates.push(highlightsCard);

  const faceMatchesCard = evalFaceMatches(params);
  if (faceMatchesCard) candidates.push(faceMatchesCard);

  const galleryReadyCard = evalGalleryReady(params);
  if (galleryReadyCard) candidates.push(galleryReadyCard);

  const upcomingLongCard = evalUpcomingLong(params);
  if (upcomingLongCard) candidates.push(upcomingLongCard);

  const welcomeCard = evalWelcome(params);
  candidates.push(welcomeCard);

  // 3. Selection Algorithm: Weighted + Least Recently Shown
  const selected = selectWeightedLeastRecentlyShown(candidates, params.tier2History);
  sessionTier2Ref.current = selected;
  return selected;
}

function evalNewHighlights(params: HeroResolverParams): HeroCard | null {
  const { events: evts, today: now, highlightsHeroData: hlData } = params;
  const nowMs = Date.now();
  for (const ev of evts) {
    const hasHighlightsPhotos = (ev.highlightsPhotoCount || 0) > 0;
    if ((ev.stage === 'HIGHLIGHTS' || ev.highlightsReady || ev.isHighlights) && hasHighlightsPhotos) {
      const entry = hlData[ev.slug];
      if (!entry) return null;
      const currentCount = ev.highlightsPhotoCount || 0;
      const hasNewHighlights = currentCount > entry.lastSeenCount;
      const withinWindow = (nowMs - entry.firstShownAt) < HERO_EXPIRY_MS.HIGHLIGHTS;
      if (hasNewHighlights || withinWindow) {
        return {
          type: HeroType.HIGHLIGHTS,
          headline: HIGHLIGHTS_COPY.headline(ev.title),
          subtitle: HIGHLIGHTS_COPY.subtitle,
          cta: HERO_CTA.VIEW_HIGHLIGHTS,
          eventSlug: ev.slug,
        };
      }
    }
  }
  return null;
}

function evalFaceMatches(params: HeroResolverParams): HeroCard | null {
  const { events: evts, heroSeenData: seen } = params;
  const nowMs = Date.now();
  const eventsWithMatches = evts.filter((e: any) => (e.matchedCount || 0) > 0);
  const visibleEvents = eventsWithMatches.filter((e: any) => {
    const seenEntry = seen[e.slug];
    if (!seenEntry) return true;
    const hasNewPhotos = (e.matchedCount || 0) > seenEntry.lastSeenCount;
    const withinWindow = (nowMs - seenEntry.firstSeenAt) < HERO_EXPIRY_MS.FACE_MATCHES;
    return hasNewPhotos || withinWindow;
  });
  if (visibleEvents.length === 0) return null;
  if (visibleEvents.length === 1) {
    const ev = visibleEvents[0];
    const currentCount = ev.matchedCount || 0;
    const seenEntry = seen[ev.slug];
    const prevCount = seenEntry?.lastSeenCount ?? 0;
    const isNew = !!(seenEntry && currentCount > prevCount);
    const diff = isNew ? currentCount - prevCount : currentCount;
    return {
      type: HeroType.FACE_MATCHES,
      headline: buildFaceMatchHeadlineSingle(diff, isNew),
      subtitle: buildFaceMatchSubtitleSingle(ev.title),
      cta: HERO_CTA.VIEW_GALLERY,
      eventSlug: ev.slug,
    };
  } else {
    const total = visibleEvents.reduce((s: number, e: any) => s + (e.matchedCount || 0), 0);
    const top = visibleEvents[0];
    return {
      type: HeroType.FACE_MATCHES,
      headline: buildFaceMatchHeadlineMulti(total),
      subtitle: buildFaceMatchSubtitleMulti(visibleEvents.length),
      cta: HERO_CTA.VIEW_GALLERY,
      eventSlug: top.slug,
    };
  }
}

function evalGalleryReady(params: HeroResolverParams): HeroCard | null {
  const { events: evts, today: now, galleryReadyHeroData: grData } = params;
  const nowMs = Date.now();
  for (const ev of evts) {
    const photoCount = ev.totalPhotoCount || ev.matchedCount || 0;
    if (ev.stage === 'READY' || (photoCount > 0 && ev.stage !== 'HIGHLIGHTS')) {
      const entry = grData[ev.slug];
      if (!entry) return null;
      const hasNewPhotos = photoCount > entry.lastSeenCount;
      const withinWindow = (nowMs - entry.firstShownAt) < HERO_EXPIRY_MS.GALLERY_READY;
      if (hasNewPhotos || withinWindow) {
        return {
          type: HeroType.GALLERY_READY,
          headline: GALLERY_READY_COPY.headline(ev.title),
          subtitle: GALLERY_READY_COPY.subtitle,
          cta: HERO_CTA.VIEW_GALLERY,
          eventSlug: ev.slug,
        };
      }
    }
  }
  return null;
}

function evalUpcomingLong(params: HeroResolverParams): HeroCard | null {
  const { events: evts, today: now } = params;
  for (const ev of evts) {
    const eventDate = new Date(ev.date || Date.now());
    if (ev.stage === 'UPCOMING' || (eventDate > now && !isSameDay(eventDate, now))) {
      const days = getCalendarDaysDifference(eventDate, now);
      if (days > 7) {
        return {
          type: HeroType.UPCOMING,
          headline: UPCOMING_COPY.headline(ev.title, days),
          subtitle: UPCOMING_COPY.subtitle,
          cta: '',
          eventSlug: ev.slug,
        };
      }
    }
  }
  return null;
}

function evalWelcome(params: HeroResolverParams): HeroCard {
  const { profileName, today: now, welcomeEditorial } = params;
  const firstName = profileName ? profileName.split(' ')[0] : '';
  return {
    type: HeroType.WELCOME,
    headline: buildWelcomeHeadline(firstName, now.getHours()),
    subtitle: welcomeEditorial,
    cta: '',
    eventSlug: null,
  };
}

// ── Selection Algorithm: Weighted + Least Recently Shown ──

function selectWeightedLeastRecentlyShown(
  candidates: HeroCard[],
  history: Record<string, { lastShownAt: number }>
): HeroCard {
  if (candidates.length === 1) return candidates[0];

  const now = Date.now();

  const scored = candidates.map((card) => {
    const baseWeight = TIER2_HERO_WEIGHTS[card.type] ?? 10;
    const lastShown = history[card.type]?.lastShownAt || 0;
    const timeSinceLast = lastShown === 0 ? Infinity : now - lastShown;

    // Recency boost multiplier for candidates not shown recently
    let multiplier = 1.0;
    if (lastShown === 0) {
      multiplier = 3.0; // Never shown bonus
    } else if (timeSinceLast > 48 * 3600 * 1000) {
      multiplier = 2.0; // > 48h
    } else if (timeSinceLast > 24 * 3600 * 1000) {
      multiplier = 1.5; // > 24h
    }

    const effectiveWeight = baseWeight * multiplier;
    return { card, effectiveWeight };
  });

  const totalWeight = scored.reduce((sum, item) => sum + item.effectiveWeight, 0);
  let randomPick = Math.random() * totalWeight;

  for (const item of scored) {
    if (randomPick <= item.effectiveWeight) {
      return item.card;
    }
    randomPick -= item.effectiveWeight;
  }

  return scored[0].card;
}
