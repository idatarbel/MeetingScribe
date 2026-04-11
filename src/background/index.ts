/**
 * MeetingScribe — Background Service Worker
 *
 * Responsibilities:
 * 1. Message handler for content scripts (OPEN_NOTES, etc.)
 * 2. chrome.alarms for periodic calendar polling
 * 3. chrome.notifications for meeting reminders
 * 4. Per-event scheduled alarms that fire before meetings start
 */

import type { CalendarEvent } from '@/types';
// loadAccounts will be used in Phase 9 for account status checks
import { fetchAllCalendarEvents } from '@/calendar';
import { uploadNote } from '@/upload';
import { downloadAttachment, uploadAttachmentBlob } from '@/upload/attachments';
import { loadExistingNotes } from '@/upload/cloud-notes';
import { findAccount } from '@/auth';
import { STORAGE_KEYS, defaultSettings } from '@/types';
import type { ExtensionSettings, EventAttachment } from '@/types';

console.log('[MeetingScribe] Background service worker started.');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALARM_CALENDAR_POLL = 'meetingscribe-calendar-poll';
const ALARM_MEETING_PREFIX = 'meetingscribe-meeting-';

// ---------------------------------------------------------------------------
// Message Handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse): boolean | undefined => {
    if (message.type === 'OPEN_NOTES') {
      handleOpenNotes(message.payload as {
        eventId: string;
        provider: 'google' | 'microsoft';
        title: string;
        startTime?: string;
        endTime?: string;
      });
      sendResponse({ ok: true });
      return undefined;
    }

    if (message.type === 'GET_UPCOMING_EVENTS') {
      handleGetUpcomingEvents()
        .then((events) => sendResponse({ ok: true, events }))
        .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
      return true; // async response
    }

    if (message.type === 'REFRESH_CALENDAR') {
      pollCalendar()
        .then(() => sendResponse({ ok: true }))
        .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message.type === 'LOAD_CLOUD_NOTES') {
      const p = message.payload as {
        accountId: string;
        folderPath: string;
        meetingBaseName: string;
        driveId?: string;
      };
      (async () => {
        const account = await findAccount(p.accountId);
        if (!account) {
          sendResponse({ ok: false, error: 'Account not found' });
          return;
        }
        console.log(`[MeetingScribe] Loading cloud notes: ${p.meetingBaseName} from ${p.folderPath}`);
        const mdContent = await loadExistingNotes(account, p.folderPath, p.meetingBaseName, p.driveId);
        if (mdContent) {
          console.log(`[MeetingScribe] Found existing notes (${mdContent.length} chars)`);
          sendResponse({ ok: true, content: mdContent, found: true });
        } else {
          console.log('[MeetingScribe] No existing notes found in cloud');
          sendResponse({ ok: true, content: null, found: false });
        }
      })().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[MeetingScribe] Load cloud notes failed:', msg);
        sendResponse({ ok: false, error: msg });
      });
      return true;
    }

    if (message.type === 'UPLOAD_NOTE') {
      const p = message.payload as {
        accountId: string;
        provider: string;
        eventId: string;
        title: string;
        fileName: string;
        folderPath?: string;
        driveId?: string;
        folderId?: string;
        mimeType?: string;
        contentText?: string;
        contentBase64?: string;
        isBase64?: boolean;
        attachments?: EventAttachment[];
        calendarProvider?: 'google' | 'microsoft';
      };

      // The save payload now includes both .md content and .docx base64
      const mdContent = p.contentText ?? '';
      const docxBase64 = p.contentBase64 ?? '';

      // Create a subfolder named after the meeting
      const baseFolder = p.folderPath ?? '/MeetingScribe';
      const meetingBaseName = p.fileName.replace(/\.[^.]+$/, ''); // strip extension
      const meetingFolderPath = `${baseFolder}/${meetingBaseName}`;

      console.log(`[MeetingScribe] Uploading to folder: ${meetingFolderPath} via ${p.accountId}`);

      (async () => {
        // 1. Save .md file (editable source of truth — for cloud round-tripping)
        const dest = await uploadNote(
          p.accountId,
          meetingFolderPath,
          `${meetingBaseName}.lock`,
          mdContent,
          'text/markdown',
          p.driveId,
          p.folderId,
        );
        console.log('[MeetingScribe] Markdown saved:', dest.filePath);

        // 2. Save .docx file (presentation copy)
        if (docxBase64) {
          const docxContent = atob(docxBase64);
          await uploadNote(
            p.accountId,
            meetingFolderPath,
            `${meetingBaseName}.docx`,
            docxContent,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            p.driveId,
            p.folderId,
          );
          console.log('[MeetingScribe] DOCX saved:', `${meetingBaseName}.docx`);
        }

        // 2. Download and upload attachments (if any)
        const attachments = p.attachments ?? [];
        if (attachments.length > 0) {
          console.log(`[MeetingScribe] Processing ${attachments.length} attachments...`);
          const destAccount = await findAccount(p.accountId);
          if (destAccount) {
            for (const att of attachments) {
              try {
                const blob = await downloadAttachment(att, p.calendarProvider ?? 'google');
                if (blob) {
                  await uploadAttachmentBlob(
                    blob,
                    att.title,
                    destAccount,
                    meetingFolderPath,
                    p.driveId,
                  );
                  console.log(`[MeetingScribe] Attachment saved: ${att.title}`);
                } else {
                  console.warn(`[MeetingScribe] Could not download attachment: ${att.title}`);
                }
              } catch (err) {
                console.error(`[MeetingScribe] Attachment failed: ${att.title}`, err);
              }
            }
          }
        }

        sendResponse({ ok: true, destination: dest });
      })().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[MeetingScribe] Upload failed:', msg);
        sendResponse({ ok: false, error: msg });
      });
      return true;
    }

    return undefined;
  },
);

// ---------------------------------------------------------------------------
// Open Notes Window
// ---------------------------------------------------------------------------

async function handleOpenNotes(payload: {
  eventId: string;
  provider: 'google' | 'microsoft';
  title: string;
  startTime?: string;
  endTime?: string;
  organizer?: string;
  meetingLink?: string;
}): Promise<void> {
  // Enrich from cached events — the content script only sends basic metadata,
  // but the cache has full event data (attendees, organizer, conferencing, etc.)
  let cached = await getCachedEvents();
  let fullEvent = cached?.events.find((e) => e.id === payload.eventId);

  // If the event isn't in the cache, poll the calendar now and try again.
  // Also try matching by title if the event ID from the DOM doesn't match the API ID.
  if (!fullEvent) {
    console.log('[MeetingScribe] Event not in cache, polling calendar...');
    console.log('[MeetingScribe] Looking for eventId:', payload.eventId, 'title:', payload.title);
    const freshEvents = await pollCalendar();
    console.log(`[MeetingScribe] Calendar poll returned ${freshEvents.length} events`);
    if (freshEvents.length > 0) {
      console.log('[MeetingScribe] Event titles from API:', freshEvents.map((e) => e.title));
    }

    fullEvent = freshEvents.find((e) => e.id === payload.eventId);

    // Fallback: match by title (DOM event IDs may not match API event IDs)
    if (!fullEvent) {
      // Try exact match first
      fullEvent = freshEvents.find(
        (e) => e.title.toLowerCase() === payload.title.toLowerCase(),
      );
      // Try substring match (Google Calendar may show truncated titles)
      if (!fullEvent) {
        fullEvent = freshEvents.find(
          (e) => e.title.toLowerCase().includes(payload.title.toLowerCase()) ||
                 payload.title.toLowerCase().includes(e.title.toLowerCase()),
        );
      }
      if (fullEvent) {
        console.log('[MeetingScribe] Matched event by title:', fullEvent.title);
      } else {
        console.warn('[MeetingScribe] Could not find event. DOM title:', payload.title);
      }
    }
  }

  // Log attachment status for debugging
  if (fullEvent) {
    console.log(`[MeetingScribe] Event "${fullEvent.title}" has ${fullEvent.attachments?.length ?? 0} attachments`);
    if (fullEvent.attachments && fullEvent.attachments.length > 0) {
      console.log('[MeetingScribe] Attachments:', fullEvent.attachments.map((a) => a.title));
    }
  }

  const notesUrl = chrome.runtime.getURL('src/notes/index.html');
  const params = new URLSearchParams({
    eventId: payload.eventId,
    provider: payload.provider,
    title: fullEvent?.title ?? payload.title,
  });

  const startTime = fullEvent?.startTime ?? payload.startTime;
  const endTime = fullEvent?.endTime ?? payload.endTime;
  if (startTime) params.set('startTime', startTime);
  if (endTime) params.set('endTime', endTime);
  // Use cache data first, fall back to content script metadata
  const eventOrganizer = fullEvent?.organizer ?? payload.organizer;
  const eventMeetingLink = fullEvent?.dialIn?.url ?? payload.meetingLink;
  if (eventOrganizer) params.set('organizer', eventOrganizer);
  if (fullEvent?.location) params.set('location', fullEvent.location);
  if (eventMeetingLink) params.set('meetingLink', eventMeetingLink);
  if (fullEvent?.attendees && fullEvent.attendees.length > 0) {
    params.set('attendees', JSON.stringify(fullEvent.attendees));
  }
  if (fullEvent?.attachments && fullEvent.attachments.length > 0) {
    params.set('attachments', JSON.stringify(fullEvent.attachments));
  }

  const fullUrl = `${notesUrl}?${params.toString()}`;

  // Check if a notes window for this event is already open
  const existingWindows = await chrome.windows.getAll({ populate: true });
  for (const win of existingWindows) {
    const tab = win.tabs?.find((t) => t.url?.includes(`eventId=${payload.eventId}`));
    if (tab?.id && win.id) {
      // Focus the existing window
      await chrome.windows.update(win.id, { focused: true });
      return;
    }
  }

  // Open a new popup window for notes
  await chrome.windows.create({
    url: fullUrl,
    type: 'popup',
    width: 720,
    height: 740,
  });
}

// ---------------------------------------------------------------------------
// Calendar Polling
// ---------------------------------------------------------------------------

async function handleGetUpcomingEvents(): Promise<CalendarEvent[]> {
  // Try cache first
  const cached = await getCachedEvents();
  if (cached && cached.fetchedAt > Date.now() - 5 * 60 * 1000) {
    return cached.events;
  }

  // Fetch fresh
  return pollCalendar();
}

async function pollCalendar(): Promise<CalendarEvent[]> {
  try {
    const events = await fetchAllCalendarEvents();

    // Cache results
    await chrome.storage.local.set({
      [STORAGE_KEYS.CACHED_EVENTS]: {
        events,
        fetchedAt: Date.now(),
      },
    });

    // Schedule per-event meeting alarms
    await scheduleEventAlarms(events);

    return events;
  } catch (err) {
    console.error('[MeetingScribe] Calendar poll failed:', err);
    return [];
  }
}

async function getCachedEvents(): Promise<{
  events: CalendarEvent[];
  fetchedAt: number;
} | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.CACHED_EVENTS);
  return (result[STORAGE_KEYS.CACHED_EVENTS] as {
    events: CalendarEvent[];
    fetchedAt: number;
  }) ?? null;
}

// ---------------------------------------------------------------------------
// Meeting Reminders (chrome.alarms + chrome.notifications)
// ---------------------------------------------------------------------------

async function scheduleEventAlarms(events: CalendarEvent[]): Promise<void> {
  const settings = await getSettings();
  if (!settings.calendarPollingEnabled) return;

  const minutesBefore = settings.reminderMinutesBefore;

  for (const event of events) {
    if (event.isAllDay) continue;

    const eventStart = new Date(event.startTime).getTime();
    const alarmTime = eventStart - minutesBefore * 60 * 1000;

    // Only schedule future alarms
    if (alarmTime > Date.now()) {
      const alarmName = `${ALARM_MEETING_PREFIX}${event.id}`;
      await chrome.alarms.create(alarmName, { when: alarmTime });
    }
  }
}

// ---------------------------------------------------------------------------
// Alarm Handler
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_CALENDAR_POLL) {
    await pollCalendar();
    return;
  }

  if (alarm.name.startsWith(ALARM_MEETING_PREFIX)) {
    const eventId = alarm.name.slice(ALARM_MEETING_PREFIX.length);
    await showMeetingReminder(eventId);
  }
});

async function showMeetingReminder(eventId: string): Promise<void> {
  const cached = await getCachedEvents();
  const event = cached?.events.find((e) => e.id === eventId);
  if (!event) return;

  const settings = await getSettings();

  chrome.notifications.create(`meeting-${eventId}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
    title: 'Meeting Starting Soon',
    message: `${event.title} starts in ${settings.reminderMinutesBefore} minutes. Click to take notes.`,
    priority: 2,
    requireInteraction: true,
  });
}

// Handle notification clicks — open the notes window
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (!notificationId.startsWith('meeting-')) return;

  const eventId = notificationId.slice('meeting-'.length);
  const cached = await getCachedEvents();
  const event = cached?.events.find((e) => e.id === eventId);
  if (!event) return;

  await handleOpenNotes({
    eventId: event.id,
    provider: event.provider,
    title: event.title,
    startTime: event.startTime,
    endTime: event.endTime,
  });

  chrome.notifications.clear(notificationId);
});

// ---------------------------------------------------------------------------
// Extension Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[MeetingScribe] Extension installed/updated:', details.reason);

  // Set up the periodic calendar polling alarm
  const settings = await getSettings();
  if (settings.calendarPollingEnabled) {
    await chrome.alarms.create(ALARM_CALENDAR_POLL, {
      periodInMinutes: settings.calendarPollingIntervalMin,
    });
  }

  // Inject Outlook content script into any already-open Outlook tabs
  injectOutlookIntoExistingTabs();
});

// On startup, re-create the polling alarm
chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  if (settings.calendarPollingEnabled) {
    await chrome.alarms.create(ALARM_CALENDAR_POLL, {
      periodInMinutes: settings.calendarPollingIntervalMin,
    });
  }
});

// ---------------------------------------------------------------------------
// Programmatic content script injection for CSP-strict sites (Outlook)
// crxjs's dynamic import() loader is blocked by Outlook's CSP.
// We use chrome.scripting.executeScript() instead, which bypasses page CSP.
// ---------------------------------------------------------------------------

const OUTLOOK_PATTERNS = [
  'https://outlook.office.com/*',
  'https://outlook.office365.com/*',
  'https://outlook.live.com/*',
  'https://outlook.cloud.microsoft/*',
];

// Inject the Outlook content script when a matching tab updates.
// Uses chrome.tabs.onUpdated + chrome.scripting.executeScript to inject
// a simple inline script that bypasses Outlook's CSP entirely.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url) return;

  const isOutlook = OUTLOOK_PATTERNS.some((p) => {
    const domain = p.replace('https://', '').replace('/*', '');
    return (tab.url ?? '').includes(domain);
  });

  if (!isOutlook) return;

  try {
    // Inject inline function that creates the Take Notes button.
    // This bypasses CSP because chrome.scripting runs in the ISOLATED world.
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: outlookContentScript,
    });
    console.log(`[MeetingScribe] Outlook content script injected into tab ${tabId}`);
  } catch (err) {
    console.log('[MeetingScribe] Outlook script injection skipped:', (err as Error).message);
  }
});

/**
 * Outlook content script — injected as inline function via chrome.scripting.
 * Self-contained: no imports, no modules, no dynamic import().
 */
function outlookContentScript(): void {
  // Prevent double injection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).__meetingscribe_outlook_injected) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__meetingscribe_outlook_injected = true;

  console.log('[MeetingScribe] Outlook content script running (programmatic injection)');

  const BTN_ID = 'meetingscribe-take-notes-btn';
  let currentMeetingTitle = '';

  function createButton(title: string, meta?: {
    startTime?: string; endTime?: string; organizer?: string; meetingLink?: string;
  }): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = '\u{1F4DD} Take Notes';
    btn.title = 'Open MeetingScribe to take notes on this meeting';
    btn.dataset.eventTitle = title;
    Object.assign(btn.style, {
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '8px 16px', fontSize: '14px', fontWeight: '500',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#ffffff', backgroundColor: '#3b82f6', border: 'none',
      borderRadius: '6px', cursor: 'pointer', lineHeight: '1',
      whiteSpace: 'nowrap', transition: 'background-color 0.15s',
      margin: '8px 16px', zIndex: '9999',
    });
    btn.addEventListener('mouseenter', () => { btn.style.backgroundColor = '#2563eb'; });
    btn.addEventListener('mouseleave', () => { btn.style.backgroundColor = '#3b82f6'; });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        chrome.runtime.sendMessage({
          type: 'OPEN_NOTES',
          payload: {
            eventId: `outlook-${Date.now()}`,
            provider: 'microsoft',
            title,
            startTime: meta?.startTime,
            endTime: meta?.endTime,
            organizer: meta?.organizer,
            meetingLink: meta?.meetingLink,
          },
        }).catch(() => {
          alert('MeetingScribe was updated. Please reload this page (F5) to reconnect.');
        });
      } catch {
        alert('MeetingScribe was updated. Please reload this page (F5) to reconnect.');
      }
    });
    return btn;
  }

  function scanAndInject(): void {
    if (!/\/calendar\b/i.test(window.location.pathname)) {
      removeHost();
      return;
    }

    // Find the event detail panel
    let detailPanel: Element | null = null;
    const chromeSections = new Set([
      'Ribbon', 'CopilotDabRibbon', 'CalendarModule', 'CalendarSurfaceNavigationToolbar',
      'CalendarModuleSurface', 'Surface_Week', 'Surface_Day', 'Surface_Month',
      'Surface_WorkWeek', 'NotificationPane',
    ]);
    const allSections = document.querySelectorAll('[data-app-section]');
    for (const section of allSections) {
      const name = section.getAttribute('data-app-section') ?? '';
      if (name && !chromeSections.has(name) && !name.startsWith('calendar-view')) {
        const text = section.textContent ?? '';
        if (/\d{1,2}:\d{2}\s*(AM|PM)/i.test(text) || /invited/i.test(text)) {
          detailPanel = section;
          break;
        }
      }
    }

    // No event detail panel open — remove button
    if (!detailPanel) {
      removeHost();
      return;
    }

    // Extract title
    let title = '(No title)';
    const candidates = detailPanel.querySelectorAll(
      'div[class], span[class], h1, h2, [role="heading"]',
    );
    for (const el of candidates) {
      if (el.id === BTN_ID) continue;
      if (el.closest('button, a, [role="button"]')) continue;
      let directText = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          directText += child.textContent ?? '';
        }
      }
      directText = directText.trim();
      if (directText.length >= 3 && directText.length <= 150 &&
          !/^\d{1,2}[:/]\d{2}/.test(directText) &&
          !/^(Accepted|Declined|invited|Join|Chat|Respond|https?:)/i.test(directText) &&
          !directText.includes('Take Notes') &&
          !directText.includes('Copilot')) {
        title = directText;
        break;
      }
    }

    if (title === '(No title)') return;

    // Extract meeting metadata from the detail panel text
    const panelText = detailPanel.textContent ?? '';

    // Extract time: "Thu 4/9/2026 12:00 PM - 1:00 PM"
    let startTime: string | undefined;
    let endTime: string | undefined;
    const timeMatch = panelText.match(
      /(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i,
    );
    if (timeMatch) {
      try {
        const startStr = `${timeMatch[1]} ${timeMatch[2]}`;
        const endStr = `${timeMatch[1]} ${timeMatch[3]}`;
        const parsedStart = new Date(startStr);
        const parsedEnd = new Date(endStr);
        if (!isNaN(parsedStart.getTime())) startTime = parsedStart.toISOString();
        if (!isNaN(parsedEnd.getTime())) endTime = parsedEnd.toISOString();
      } catch { /* ignore parse errors */ }
    }

    // Extract organizer: "Sarah Khan invited you" — match only name-like text before "invited"
    let outlookOrganizer: string | undefined;
    const orgMatch = panelText.match(/([A-Z][a-zA-Z'.'-]+(?:\s+[A-Z][a-zA-Z'.'-]+)*)\s+invited you/);
    if (orgMatch) {
      outlookOrganizer = orgMatch[1]?.trim();
    }

    // Extract meeting link: URL starting with https
    let outlookMeetingLink: string | undefined;
    const linkMatch = panelText.match(/(https?:\/\/[^\s<>"']+)/);
    if (linkMatch) {
      outlookMeetingLink = linkMatch[1];
    }

    // Attendee extraction from Outlook DOM is limited — the cache/API provides full attendee list

    // If the meeting title changed, remove old button and create new one
    if (title !== currentMeetingTitle) {
      removeHost();
      currentMeetingTitle = title;
    }

    // If button already exists for this meeting, keep it
    if (document.getElementById('meetingscribe-shadow-host')) return;

    // Use a Shadow DOM host so Outlook can't find or remove our button.
    // Outlook aggressively cleans unknown elements from document.body.
    let host = document.getElementById('meetingscribe-shadow-host') as HTMLDivElement | null;
    let shadow: ShadowRoot;

    if (host) {
      // Host exists — reuse its shadow root
      shadow = host.shadowRoot as ShadowRoot;
      if (!shadow) {
        // Shouldn't happen but safety fallback — remove and recreate
        host.remove();
        host = null;
      }
    }

    if (!host) {
      host = document.createElement('div');
      host.id = 'meetingscribe-shadow-host';
      host.style.cssText = 'position:fixed;top:60px;right:20px;z-index:2147483647;';
      shadow = host.attachShadow({ mode: 'open' }); // 'open' so we can access shadowRoot later
      document.documentElement.appendChild(host);
    }

    shadow = host.shadowRoot as ShadowRoot;
    // Clear previous content
    shadow.innerHTML = '';

    const btn = createButton(title, { startTime, endTime, organizer: outlookOrganizer, meetingLink: outlookMeetingLink });
    btn.style.position = 'relative';
    btn.style.top = 'auto';
    btn.style.right = 'auto';
    btn.style.margin = '0';
    btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    shadow.appendChild(btn);
    console.log(`[MeetingScribe] Take Notes button injected for: "${title}" startTime: ${startTime ?? 'unknown'}`);
  }

  function removeHost(): void {
    document.getElementById('meetingscribe-shadow-host')?.remove();
    currentMeetingTitle = '';
  }

  // Poll every 2 seconds — detects meeting open/close/change
  setInterval(scanAndInject, 2000);
  scanAndInject();

  // SPA navigation: if user leaves calendar view, remove button
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      document.getElementById(BTN_ID)?.remove();
    }
  }, 1000);
}

async function injectOutlookIntoExistingTabs(): Promise<void> {
  try {
    // Query ALL tabs and filter manually — chrome.tabs.query URL patterns
    // may not handle domains without standard TLDs (e.g., outlook.cloud.microsoft)
    const allTabs = await chrome.tabs.query({});
    const tabs = allTabs.filter((t) =>
      t.url && OUTLOOK_PATTERNS.some((p) => {
        const domain = p.replace('https://', '').replace('/*', '');
        return t.url?.includes(domain);
      }),
    );
    console.log(`[MeetingScribe] Found ${tabs.length} existing Outlook tabs (scanned ${allTabs.length} total)`);
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'ISOLATED',
          func: outlookContentScript,
        });
        console.log(`[MeetingScribe] Injected into existing Outlook tab ${tab.id}: ${tab.url}`);
      } catch (err) {
        console.log('[MeetingScribe] Injection into existing tab failed:', (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[MeetingScribe] Failed to query tabs:', err);
  }
}

// ---------------------------------------------------------------------------
// Settings helper
// ---------------------------------------------------------------------------

async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return (result[STORAGE_KEYS.SETTINGS] as ExtensionSettings) ?? defaultSettings();
}
