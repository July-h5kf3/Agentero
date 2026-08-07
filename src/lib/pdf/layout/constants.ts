/**
 * Shared thresholds for the figures rail and PDF layout hover interactions.
 */

/** Default confidence gate (0–1) for sidebar gallery + hover hit targets. */
export const LAYOUT_SIDEBAR_MIN_SCORE = 0.3;

/**
 * Dwell time before auto-opening the visual annotation editor when the
 * pointer rests on a figure / table / algorithm / formula region (no
 * Annotation.md legend path).
 */
export const LAYOUT_HOVER_DWELL_MS = 600;

/**
 * Grace period after leaving a layout-hover region (or its ephemeral draft
 * card) before auto-closing the visual annotation editor. Matches the
 * ask / visual pin card hide delay so the pointer can travel to the card.
 */
export const LAYOUT_HOVER_HIDE_MS = 1000;

/**
 * Formula + Annotation.md legend: free to open (no crop), so dwell is shorter
 * than the visual-ask path — feels like a tooltip, not a modal draft.
 */
export const LAYOUT_FORMULA_HOVER_DWELL_MS = 280;

/**
 * Leave formula region / legend card → close after this grace window.
 * Long enough to cross the small gap into the card; shorter than visual draft
 * hide so moving away feels responsive (citation preview uses ~250ms).
 */
export const LAYOUT_FORMULA_HOVER_HIDE_MS = 320;
