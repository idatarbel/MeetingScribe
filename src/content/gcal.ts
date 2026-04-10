/**
 * MeetingScribe — Google Calendar content script.
 *
 * Watches for event detail views (popup or full-page) and injects a
 * "Take Notes" button. Uses MutationObserver to handle SPA navigation.
 *
 * Google Calendar DOM structure (as of 2026):
 * - Event popup: div[data-eventid] containing event details
 * - Event detail page: URL contains /eventedit/ or /r/eventedit/ or /r/day/... with event selected
 * - Event title: [data-eventchip] or .UfeRlc or event detail heading
 *
 * These selectors are inherently fragile — Google can change their DOM at any time.
 * We use multiple fallback selectors and fail gracefully (no errors if injection fails).
 */

import {
  createTakeNotesButton,
  isButtonInjectedForEvent,
  removeButton,
  sendOpenNotesMessage,
  createDebouncedObserver,
} from './shared';

console.log('[MeetingScribe] Google Calendar content script loaded.');

// ---------------------------------------------------------------------------
// Selectors (ordered by specificity, with fallbacks)
// ---------------------------------------------------------------------------

/** Selectors for the event detail popup (the bubble that appears when you click an event). */
const EVENT_POPUP_SELECTORS = [
  '[data-eventid]',                    // Primary: event container with data attribute
  '[role="dialog"][data-eventchip]',   // Dialog variant
  '.ecHOke',                           // Backup: event detail popup class (fragile)
];

/** Selectors for the event title inside a popup or detail view. */
const EVENT_TITLE_SELECTORS = [
  '[data-eventid] span[role="heading"]',
  '[data-eventid] .r4nke',            // Event title class in popup
  '.tzcF6',                           // Full-page event title
  '[data-eventid] [dir="auto"]',      // Generic fallback
];

/** Selectors for the action button area in the event popup (where we inject our button). */
const ACTION_AREA_SELECTORS = [
  '[data-eventid] [data-tooltip]',     // Action buttons have tooltips
  '.pPTZAe',                          // Action area wrapper
  '[data-eventid]',                   // Last resort: append to event container itself
];

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Scan the DOM for an open event detail view and inject the button if found.
 */
function scanAndInject(): void {
  // Find the event popup/detail container
  let eventContainer: Element | null = null;
  for (const selector of EVENT_POPUP_SELECTORS) {
    eventContainer = document.querySelector(selector);
    if (eventContainer) break;
  }

  if (!eventContainer) {
    // No event detail open — remove our button if it was left behind
    removeButton();
    return;
  }

  // Extract event metadata
  const eventId =
    eventContainer.getAttribute('data-eventid') ??
    extractEventIdFromUrl() ??
    `gcal-${Date.now()}`;

  // If our button already exists for THIS event, nothing to do.
  // If it exists for a DIFFERENT event (user switched meetings), remove and re-inject.
  if (isButtonInjectedForEvent(eventId)) return;
  removeButton(); // remove stale button from previous event

  let title = '(No title)';
  for (const selector of EVENT_TITLE_SELECTORS) {
    const el = document.querySelector(selector);
    if (el?.textContent?.trim()) {
      title = el.textContent.trim();
      break;
    }
  }

  // Find where to inject the button
  let actionArea: Element | null = null;
  for (const selector of ACTION_AREA_SELECTORS) {
    actionArea = document.querySelector(selector);
    if (actionArea) break;
  }

  if (!actionArea) return;

  // Create and inject the button
  const btn = createTakeNotesButton(() => {
    sendOpenNotesMessage({
      eventId,
      provider: 'google',
      title,
    });
  }, eventId);

  // Insert as the last child of the action area, or after the last action button
  const parent = actionArea.parentElement ?? actionArea;
  parent.appendChild(btn);
}

/**
 * Try to extract a Google Calendar event ID from the current URL.
 * URLs like /r/eventedit/xxx or /r/event/xxx contain the event ID.
 */
function extractEventIdFromUrl(): string | null {
  const match = window.location.pathname.match(/\/(?:eventedit|event)\/([^/]+)/);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// MutationObserver setup
// ---------------------------------------------------------------------------

const observer = createDebouncedObserver(scanAndInject, 500);

// Start observing once the body is available
if (document.body) {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Also run an initial scan
scanAndInject();

// Listen for SPA-style navigation (Google Calendar uses pushState)
let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    removeButton();
    // Delay scan slightly to let the new page render
    setTimeout(scanAndInject, 800);
  }
});

if (document.body) {
  urlObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
