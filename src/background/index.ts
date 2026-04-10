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

      // Reconstruct content
      let content: string;
      if (p.isBase64 && p.contentBase64) {
        content = atob(p.contentBase64);
        console.log(`[MeetingScribe] UPLOAD_NOTE: docx binary, ${content.length} bytes`);
      } else {
        content = p.contentText ?? '';
        console.log(`[MeetingScribe] UPLOAD_NOTE: text, ${content.length} chars`);
      }

      // Create a subfolder named after the meeting, then save notes + attachments inside
      const baseFolder = p.folderPath ?? '/MeetingScribe';
      const meetingFolderName = p.fileName.replace(/\.[^.]+$/, ''); // strip extension
      const meetingFolderPath = `${baseFolder}/${meetingFolderName}`;

      console.log(`[MeetingScribe] Uploading to folder: ${meetingFolderPath} via ${p.accountId}`);

      (async () => {
        // 1. Upload the meeting minutes to the subfolder
        const dest = await uploadNote(
          p.accountId,
          meetingFolderPath,
          p.fileName,
          content,
          p.mimeType ?? 'text/markdown',
          p.driveId,
          p.folderId,
        );
        console.log('[MeetingScribe] Meeting minutes saved:', dest.filePath);

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
  if (fullEvent?.organizer) params.set('organizer', fullEvent.organizer);
  if (fullEvent?.location) params.set('location', fullEvent.location);
  if (fullEvent?.dialIn?.url) params.set('meetingLink', fullEvent.dialIn.url);
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
// Settings helper
// ---------------------------------------------------------------------------

async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return (result[STORAGE_KEYS.SETTINGS] as ExtensionSettings) ?? defaultSettings();
}
