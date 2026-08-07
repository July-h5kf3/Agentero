/**
 * Shared thresholds for the figures rail and PDF layout hover interactions.
 */

/** Default confidence gate (0–1) for sidebar gallery + hover hit targets. */
export const LAYOUT_SIDEBAR_MIN_SCORE = 0.3;

/**
 * Dwell time before auto-opening the visual annotation editor when the
 * pointer rests on a figure / table / algorithm / formula region.
 */
export const LAYOUT_HOVER_DWELL_MS = 600;

/**
 * Grace period after leaving a layout-hover region (or its ephemeral draft
 * card) before auto-closing the visual annotation editor. Matches the
 * ask / visual pin card hide delay so the pointer can travel to the card.
 */
export const LAYOUT_HOVER_HIDE_MS = 1000;
