/**
 * Google Calendar API v3 integration.
 *
 * Fetches upcoming events from all connected Google accounts.
 * Endpoint: GET https://www.googleapis.com/calendar/v3/calendars/primary/events
 */

import type { CalendarEvent, ConnectedAccount } from '@/types';
import { getAccessToken } from '@/auth';
import { extractDialIn } from '@/utils/strip-dialin';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

/**
 * Fetch upcoming events for a single Google account.
 *
 * @param account - The connected Google account.
 * @param timeMin - ISO 8601 start of the query window (defaults to now).
 * @param timeMax - ISO 8601 end of the query window (defaults to 7 days from now).
 * @param maxResults - Maximum number of events to return (default 50).
 */
export async function fetchGoogleCalendarEvents(
  account: ConnectedAccount,
  timeMin?: string,
  timeMax?: string,
  maxResults = 50,
): Promise<CalendarEvent[]> {
  const accessToken = await getAccessToken(account.id);
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    timeMin: timeMin ?? now.toISOString(),
    timeMax: timeMax ?? weekFromNow.toISOString(),
    maxResults: String(maxResults),
    singleEvents: 'true',      // expand recurring events
    orderBy: 'startTime',
    // supportsAttachments is REQUIRED for the API to return the attachments field
    supportsAttachments: 'true',
    fields:
      'items(id,summary,start,end,location,description,attendees,organizer,conferenceData,attachments)',
  });

  const url = `${CALENDAR_API_BASE}/calendars/primary/events?${params.toString()}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Google Calendar API error (${response.status}) for ${account.email}: ${body}`,
    );
  }

  const data = (await response.json()) as GoogleCalendarResponse;

  return (data.items ?? []).map((item) => mapGoogleEvent(item, account.email));
}

// ---------------------------------------------------------------------------
// Google Calendar API types (partial — only what we use)
// ---------------------------------------------------------------------------

interface GoogleCalendarResponse {
  items?: GoogleCalendarItem[];
  nextPageToken?: string;
}

interface GoogleCalendarItem {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  description?: string;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  organizer?: { email?: string; displayName?: string };
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType: string;
      uri?: string;
      label?: string;
    }>;
  };
  attachments?: Array<{
    fileId?: string;
    fileUrl?: string;
    title?: string;
    mimeType?: string;
    iconLink?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapGoogleEvent(item: GoogleCalendarItem, accountEmail: string): CalendarEvent {
  const startTime =
    item.start?.dateTime ?? item.start?.date ?? new Date().toISOString();
  const endTime =
    item.end?.dateTime ?? item.end?.date ?? startTime;
  const isAllDay = !item.start?.dateTime;

  // Try to extract conferencing info from Google's structured conferenceData first,
  // then fall back to parsing description/location text.
  let conferenceUrl: string | undefined;
  if (item.conferenceData?.entryPoints) {
    const videoEntry = item.conferenceData.entryPoints.find(
      (ep) => ep.entryPointType === 'video',
    );
    conferenceUrl = videoEntry?.uri;
  }

  const dialIn = conferenceUrl
    ? { raw: conferenceUrl, platform: detectPlatform(conferenceUrl), url: conferenceUrl }
    : extractDialIn(item.description, item.location);

  return {
    id: item.id,
    provider: 'google',
    accountEmail,
    title: item.summary ?? '(No title)',
    startTime,
    endTime,
    location: item.location,
    dialIn,
    attendees: (item.attendees ?? []).map((a) => ({
      email: a.email,
      name: a.displayName,
      responseStatus: mapResponseStatus(a.responseStatus),
    })),
    description: item.description,
    isAllDay,
    organizer: item.organizer?.email,
    attachments: (item.attachments ?? []).map((a) => ({
      fileId: a.fileId ?? '',
      title: a.title ?? 'Untitled',
      mimeType: a.mimeType ?? 'application/octet-stream',
      fileUrl: a.fileUrl,
    })),
  };
}

function detectPlatform(url: string): 'zoom' | 'teams' | 'meet' | 'webex' | 'other' {
  if (/zoom\.us/i.test(url)) return 'zoom';
  if (/meet\.google\.com/i.test(url)) return 'meet';
  if (/teams\.microsoft\.com/i.test(url)) return 'teams';
  if (/webex\.com/i.test(url)) return 'webex';
  return 'other';
}

function mapResponseStatus(
  status?: string,
): 'accepted' | 'declined' | 'tentative' | 'needsAction' {
  switch (status) {
    case 'accepted':
      return 'accepted';
    case 'declined':
      return 'declined';
    case 'tentative':
      return 'tentative';
    default:
      return 'needsAction';
  }
}
