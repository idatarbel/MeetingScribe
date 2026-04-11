/**
 * MeetingScribe — Google Calendar content script.
 *
 * Watches for event detail popups and injects a "Take Notes" button.
 * Extracts meeting metadata (title, time, organizer, attendees) directly
 * from the DOM to reduce dependency on API enrichment.
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
// Selectors
// ---------------------------------------------------------------------------

const EVENT_POPUP_SELECTORS = [
  // Prefer the dialog popup (full event details) over the calendar chip (truncated)
  '[role="dialog"]',
  '[data-eventid]',
  '.ecHOke',
];

const ACTION_AREA_SELECTORS = [
  '[role="dialog"] [data-eventid]',
  '[data-eventid] [data-tooltip]',
  '.pPTZAe',
  '[role="dialog"]',
  '[data-eventid]',
];

// ---------------------------------------------------------------------------
// Metadata extraction from Google Calendar DOM
// ---------------------------------------------------------------------------

function extractEventMetadata(container: Element): {
  title: string;
  startTime?: string;
  endTime?: string;
  organizer?: string;
  attendees?: string; // JSON stringified array
  meetingLink?: string;
} {
  const meta: ReturnType<typeof extractEventMetadata> = { title: '(No title)' };

  // --- Title ---
  // Skip tooltip/button elements and find the actual event title.
  // In the dialog popup, the title comes after action buttons (Close, Edit, Delete, etc.)
  const skipTexts = new Set([
    'close', 'edit event', 'delete event', 'email event details',
    'options', 'print', 'duplicate', 'publish event', 'export',
  ]);

  // 1. Try heading elements
  const headings = container.querySelectorAll(
    'span[role="heading"], [data-eventid] span[role="heading"], h1, h2, h3',
  );
  for (const h of headings) {
    const text = h.textContent?.trim();
    if (text && text.length > 2 && text.length < 200 && !skipTexts.has(text.toLowerCase())) {
      meta.title = text;
      break;
    }
  }

  // 2. Try all spans — find the first substantial one that isn't a button/tooltip
  if (meta.title === '(No title)') {
    const spans = container.querySelectorAll('span');
    for (const span of spans) {
      if (span.children.length > 0) continue; // only leaf nodes
      const text = span.textContent?.trim();
      if (!text || text.length < 4 || text.length > 200) continue;
      if (skipTexts.has(text.toLowerCase())) continue;
      if (span.closest('[role="tooltip"]')) continue;
      if (span.closest('button')) continue;
      // Skip time patterns, email-like text, and common labels
      if (/^\d{1,2}[:/]/.test(text)) continue;
      if (/^(yes|no|maybe|accepted|declined|tentative)/i.test(text)) continue;
      if (text.startsWith('Copy to')) continue;
      meta.title = text;
      break;
    }
  }

  // 3. Fallback: aria-label on event container or child
  if (meta.title === '(No title)') {
    const eventEl = container.querySelector('[data-eventid]') ?? container;
    const ariaLabel = eventEl.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.length > 2) {
      const cleanTitle = ariaLabel
        .replace(/,\s*\w+day.*$/i, '')
        .replace(/,\s*\d{1,2}\s+\w+.*$/i, '')
        .trim();
      if (cleanTitle.length > 2) meta.title = cleanTitle;
    }
  }

  // --- Extract all text from the popup for pattern matching ---
  const popupText = container.textContent ?? '';

  // --- Date/Time ---
  // Google Calendar popup shows time like "Thursday, April 10, 2026 ⋅ 9:15 – 9:45am"
  // or "Thursday, April 10 ⋅ 9:15 – 9:45 AM"
  const timePatterns = [
    // "April 10, 2026 ⋅ 9:15 – 9:45am" or "April 10, 2026 ⋅ 9:15 – 9:45 AM"
    /(\w+\s+\d{1,2},?\s*\d{4})\s*[⋅·]\s*(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})\s*(am|pm)?/i,
    // "Thursday, April 10 ⋅ 9:15 – 9:45am"
    /(\w+,?\s+\w+\s+\d{1,2})\s*[⋅·]\s*(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})\s*(am|pm)?/i,
    // Simpler: just find time range
    /(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})\s*(am|pm)?/i,
  ];

  for (const pattern of timePatterns) {
    const match = popupText.match(pattern);
    if (match) {
      // Try to parse a full date+time
      try {
        if (match[1] && match[2] && match[3]) {
          // Full date pattern
          const dateStr = match[1].replace(/^\w+,?\s*/, ''); // remove day name
          const ampm = match[4] ?? 'AM';
          const startStr = `${dateStr} ${match[2]} ${ampm}`;
          const endStr = `${dateStr} ${match[3]} ${ampm}`;
          const startParsed = new Date(startStr);
          const endParsed = new Date(endStr);
          if (!isNaN(startParsed.getTime())) meta.startTime = startParsed.toISOString();
          if (!isNaN(endParsed.getTime())) meta.endTime = endParsed.toISOString();
        }
      } catch { /* ignore parse errors */ }
      break;
    }
  }

  // --- Organizer ---
  // Look for "Organizer" label or the event creator
  const orgPatterns = [
    /(?:Organizer|Created by)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,
    /(?:Organizer|Created by)[:\s]+([\w.+-]+@[\w.-]+)/,
  ];
  for (const pattern of orgPatterns) {
    const match = popupText.match(pattern);
    if (match) {
      meta.organizer = match[1]?.trim();
      break;
    }
  }

  // --- Meeting link ---
  // Look for conference URLs in the popup
  const links = container.querySelectorAll('a[href]');
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    if (/meet\.google\.com|zoom\.us|teams\.microsoft\.com|webex\.com/i.test(href)) {
      meta.meetingLink = href;
      break;
    }
  }

  // --- Attendees ---
  // Google Calendar popup shows attendees as a list of names/emails
  // Look for attendee-related elements
  const attendeeElements = container.querySelectorAll(
    '[data-email], [data-hovercard-id], [aria-label*="@"]',
  );
  if (attendeeElements.length > 0) {
    const attendees: Array<{ name?: string; email: string }> = [];
    for (const el of attendeeElements) {
      const email = el.getAttribute('data-email') ??
        el.getAttribute('data-hovercard-id') ??
        el.getAttribute('aria-label')?.match(/[\w.+-]+@[\w.-]+/)?.[0];
      if (email && email.includes('@')) {
        const name = el.textContent?.trim();
        attendees.push({ name: name !== email ? name : undefined, email });
      }
    }
    if (attendees.length > 0) {
      meta.attendees = JSON.stringify(attendees);
    }
  }

  return meta;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function scanAndInject(): void {
  let eventContainer: Element | null = null;
  for (const selector of EVENT_POPUP_SELECTORS) {
    eventContainer = document.querySelector(selector);
    if (eventContainer) break;
  }

  if (!eventContainer) {
    removeButton();
    return;
  }

  // Event ID: on the container itself or on a child element within the dialog
  const eventId =
    eventContainer.getAttribute('data-eventid') ??
    eventContainer.querySelector('[data-eventid]')?.getAttribute('data-eventid') ??
    extractEventIdFromUrl() ??
    `gcal-${Date.now()}`;

  if (isButtonInjectedForEvent(eventId)) return;
  removeButton();

  // Extract metadata directly from the DOM
  const meta = extractEventMetadata(eventContainer);

  // Find where to inject the button
  let actionArea: Element | null = null;
  for (const selector of ACTION_AREA_SELECTORS) {
    actionArea = document.querySelector(selector);
    if (actionArea) break;
  }

  if (!actionArea) return;

  const btn = createTakeNotesButton(() => {
    sendOpenNotesMessage({
      eventId,
      provider: 'google',
      title: meta.title,
      startTime: meta.startTime,
      endTime: meta.endTime,
      organizer: meta.organizer,
      meetingLink: meta.meetingLink,
      attendeesJson: meta.attendees,
    });
  }, eventId);

  const parent = actionArea.parentElement ?? actionArea;
  parent.appendChild(btn);
}

function extractEventIdFromUrl(): string | null {
  const match = window.location.pathname.match(/\/(?:eventedit|event)\/([^/]+)/);
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

scanAndInject();

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
