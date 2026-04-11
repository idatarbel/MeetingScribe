/**
 * MeetingScribe — Outlook Web content script.
 *
 * Watches for event detail views in Outlook Web (OWA) and injects a
 * "Take Notes" button. Uses MutationObserver to handle SPA navigation.
 *
 * Targets:
 * - outlook.office.com (M365 business)
 * - outlook.office365.com (M365 business, alternate)
 * - outlook.live.com (personal Outlook/Hotmail)
 */

import {
  createTakeNotesButton,
  isButtonInjectedForEvent,
  removeButton,
  sendOpenNotesMessage,
  createDebouncedObserver,
} from './shared';

console.log('[MeetingScribe] Outlook Web content script loaded on:', window.location.href);

// ---------------------------------------------------------------------------
// Selectors — Outlook Web 2026 DOM structure
// The event detail panel appears as a side panel when clicking an event.
// These selectors target various elements in the Fluent UI-based layout.
// ---------------------------------------------------------------------------

/** Selectors for the event detail / reading pane. */
const EVENT_DETAIL_SELECTORS = [
  // New OWA: the event detail side panel
  '[data-app-section="CalendarReadingPane"]',
  '[data-app-section="ReadingPane"]',
  // Fluent UI detail panel
  '[role="complementary"][aria-label]',
  // Generic: any panel that contains event-like content
  '.ms-Panel-main',
  '.event-details',
  // Broad fallback: look for the event title pattern
  '[class*="CalendarItemPeek"]',
  '[class*="CalendarDetail"]',
  '[class*="EventDetail"]',
];

/** Selectors for the event title. */
const EVENT_TITLE_SELECTORS = [
  // Heading elements in the detail panel
  '[role="complementary"] [role="heading"]',
  '[role="complementary"] h1',
  '[role="complementary"] h2',
  '[data-app-section] [role="heading"]',
  // Fluent UI heading styles
  '[class*="subjectContainer"] [role="heading"]',
  '[class*="SubjectLine"]',
  // Broad: any heading-level element that's big and in the right area
  '.ms-Panel-main [role="heading"]',
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

  // Find the event detail container using multiple strategies
  let eventDetail: Element | null = null;
  for (const selector of EVENT_DETAIL_SELECTORS) {
    eventDetail = document.querySelector(selector);
    if (eventDetail) break;
  }

  // Fallback: look for any element that has event-like content
  // (title, time, organizer pattern in a side panel)
  if (!eventDetail) {
    // Try to find a complementary region (side panel)
    const panels = document.querySelectorAll('[role="complementary"]');
    for (const panel of panels) {
      // Check if this panel has event-like content (time pattern, attendees, etc.)
      const text = panel.textContent ?? '';
      if (/\d{1,2}:\d{2}\s*(AM|PM)/i.test(text) && text.length > 50) {
        eventDetail = panel;
        break;
      }
    }
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

  // If no title found via selectors, try the first large text in the detail panel
  if (title === '(No title)') {
    const headings = eventDetail.querySelectorAll('h1, h2, [role="heading"], [class*="subject"], [class*="Subject"]');
    for (const h of headings) {
      const text = h.textContent?.trim();
      if (text && text.length > 2 && text.length < 200) {
        title = text;
        break;
      }
    }
  }

  // Extract event ID from URL or generate one
  const eventId = extractOutlookEventId() ?? `outlook-${sanitize(title)}-${Date.now()}`;

  // Check if button already exists for this event
  if (isButtonInjectedForEvent(eventId)) return;
  removeButton();

  // Find or create injection point — try toolbar first, then append to detail panel
  let injectionPoint: Element | null = null;

  // Try toolbar areas
  const toolbarSelectors = [
    '[role="complementary"] [role="toolbar"]',
    '[data-app-section] [role="toolbar"]',
    '.ms-CommandBar',
  ];
  for (const selector of toolbarSelectors) {
    injectionPoint = document.querySelector(selector);
    if (injectionPoint) break;
  }

  // Fallback: inject at the top of the detail panel itself
  if (!injectionPoint) {
    injectionPoint = eventDetail;
  }

  const btn = createTakeNotesButton(() => {
    sendOpenNotesMessage({
      eventId,
      provider: 'microsoft',
      title,
    });
  }, eventId);

  // Add some margin when appending to the detail panel
  btn.style.margin = '8px 16px';

  // Insert as first child if it's the detail panel (so button appears at top)
  if (injectionPoint === eventDetail && eventDetail.firstChild) {
    eventDetail.insertBefore(btn, eventDetail.firstChild);
  } else {
    injectionPoint.appendChild(btn);
  }

  console.log(`[MeetingScribe] Take Notes button injected for: "${title}"`);
}

function isCalendarView(): boolean {
  return /\/calendar\b/i.test(window.location.pathname);
}

function extractOutlookEventId(): string | null {
  const match = window.location.href.match(
    /(?:\/item\/|\/id\/|itemId=)(AAMk[A-Za-z0-9_-]+)/,
  );
  return match?.[1] ?? null;
}

function sanitize(str: string): string {
  return str.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
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
