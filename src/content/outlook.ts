/**
 * MeetingScribe — Outlook Web content script.
 *
 * Watches for event detail views in Outlook Web (OWA) and injects a
 * "Take Notes" button. Uses MutationObserver to handle SPA navigation.
 *
 * Outlook Web app is a React SPA. The DOM structure differs between:
 * - outlook.office.com (M365 business)
 * - outlook.office365.com (M365 business, alternate domain)
 * - outlook.live.com (personal Outlook/Hotmail)
 *
 * Common patterns (as of 2026):
 * - Event reading pane: div[role="main"] with subject heading
 * - Calendar event detail: .allowTextSelection with event info
 * - Event title: heading inside the event detail pane
 *
 * These selectors are fragile — Microsoft changes their DOM frequently.
 * We use multiple fallback selectors and fail gracefully.
 */

import {
  createTakeNotesButton,
  isButtonInjectedForEvent,
  removeButton,
  sendOpenNotesMessage,
  createDebouncedObserver,
} from './shared';

console.log('[MeetingScribe] Outlook Web content script loaded.');

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** Selectors for the event detail / reading pane. */
const EVENT_DETAIL_SELECTORS = [
  '[data-app-section="CalendarReadingPane"]',  // OWA calendar reading pane
  '.allowTextSelection',                        // Event detail area
  '[role="main"] [data-testid="CalendarCard"]', // Calendar card view
  '[role="complementary"]',                     // Side pane where event details appear
];

/** Selectors for the event title. */
const EVENT_TITLE_SELECTORS = [
  '[data-app-section="CalendarReadingPane"] [role="heading"]',
  '.allowTextSelection h1',
  '.allowTextSelection h2',
  '[role="main"] [role="heading"][aria-level="1"]',
  '[role="main"] [role="heading"][aria-level="2"]',
];

/** Selectors for where to inject the button. */
const ACTION_AREA_SELECTORS = [
  '[data-app-section="CalendarReadingPane"] [role="toolbar"]',
  '.allowTextSelection [role="toolbar"]',
  '[role="main"] [role="toolbar"]',
  '[data-app-section="CalendarReadingPane"]', // fallback: append to reading pane
];

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function scanAndInject(): void {
  // Only run on calendar views
  if (!isCalendarView()) {
    removeButton();
    return;
  }

  // Find the event detail container
  let eventDetail: Element | null = null;
  for (const selector of EVENT_DETAIL_SELECTORS) {
    eventDetail = document.querySelector(selector);
    if (eventDetail) break;
  }

  if (!eventDetail) {
    removeButton();
    return;
  }

  // Extract event title
  let title = '(No title)';
  for (const selector of EVENT_TITLE_SELECTORS) {
    const el = document.querySelector(selector);
    if (el?.textContent?.trim()) {
      title = el.textContent.trim();
      break;
    }
  }

  // Extract event ID from URL or DOM
  const eventId = extractOutlookEventId() ?? `outlook-${Date.now()}`;

  // If our button already exists for THIS event, nothing to do.
  if (isButtonInjectedForEvent(eventId)) return;
  removeButton(); // remove stale button from previous event

  // Find action area
  let actionArea: Element | null = null;
  for (const selector of ACTION_AREA_SELECTORS) {
    actionArea = document.querySelector(selector);
    if (actionArea) break;
  }

  if (!actionArea) return;

  const btn = createTakeNotesButton(() => {
    sendOpenNotesMessage({
      eventId,
      provider: 'microsoft',
      title,
    });
  }, eventId);

  actionArea.appendChild(btn);
}

/**
 * Check if the current Outlook Web view is a calendar view.
 * OWA URLs contain /calendar/ when in calendar mode.
 */
function isCalendarView(): boolean {
  return /\/calendar\b/i.test(window.location.pathname);
}

/**
 * Try to extract a Microsoft event ID from the current URL.
 * OWA URLs may contain the event ID in various formats.
 */
function extractOutlookEventId(): string | null {
  // Pattern: /calendar/item/AAMk... or /calendar/view/.../id/AAMk...
  const match = window.location.href.match(
    /(?:\/item\/|\/id\/|itemId=)(AAMk[A-Za-z0-9_-]+)/,
  );
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// MutationObserver setup
// ---------------------------------------------------------------------------

const observer = createDebouncedObserver(scanAndInject, 500);

if (document.body) {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Initial scan
scanAndInject();

// SPA navigation detection
let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    removeButton();
    setTimeout(scanAndInject, 800);
  }
});

if (document.body) {
  urlObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
