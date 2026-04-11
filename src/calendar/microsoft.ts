/**
 * Microsoft Graph Calendar API integration.
 *
 * Fetches upcoming events from all connected Microsoft accounts.
 * Endpoint: GET https://graph.microsoft.com/v1.0/me/events
 */

import type { CalendarEvent, ConnectedAccount } from '@/types';
import { getAccessToken } from '@/auth';
import { extractDialIn } from '@/utils/strip-dialin';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Fetch upcoming events for a single Microsoft account.
 *
 * @param account - The connected Microsoft account.
 * @param timeMin - ISO 8601 start of the query window (defaults to now).
 * @param timeMax - ISO 8601 end of the query window (defaults to 7 days from now).
 * @param maxResults - Maximum number of events to return (default 50).
 */
export async function fetchMicrosoftCalendarEvents(
  account: ConnectedAccount,
  timeMin?: string,
  timeMax?: string,
  maxResults = 250,
): Promise<CalendarEvent[]> {
  const accessToken = await getAccessToken(account.id);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const startDateTime = timeMin ?? thirtyDaysAgo.toISOString();
  const endDateTime = timeMax ?? weekFromNow.toISOString();

  // Use calendarView to expand recurring events
  const params = new URLSearchParams({
    startDateTime,
    endDateTime,
    $top: String(maxResults),
    $orderby: 'start/dateTime',
    $select:
      'id,subject,start,end,location,body,attendees,organizer,onlineMeeting,isAllDay,hasAttachments',
  });

  const url = `${GRAPH_API_BASE}/me/calendarView?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.timezone="UTC"',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Microsoft Calendar API error (${response.status}) for ${account.email}: ${body}`,
    );
  }

  const data = (await response.json()) as MicrosoftCalendarResponse;

  // Map events and fetch attachments for events that have them
  const events = await Promise.all(
    (data.value ?? []).map((item) => mapMicrosoftEvent(item, account.email, accessToken)),
  );
  return events;
}

// ---------------------------------------------------------------------------
// Microsoft Graph Calendar API types (partial)
// ---------------------------------------------------------------------------

interface MicrosoftCalendarResponse {
  value?: MicrosoftCalendarItem[];
  '@odata.nextLink'?: string;
}

interface MicrosoftCalendarItem {
  id: string;
  subject?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  location?: {
    displayName?: string;
    locationType?: string;
  };
  body?: {
    contentType: 'text' | 'html';
    content: string;
  };
  attendees?: Array<{
    emailAddress: { address: string; name?: string };
    status?: { response?: string };
  }>;
  organizer?: {
    emailAddress: { address: string; name?: string };
  };
  onlineMeeting?: {
    joinUrl?: string;
  };
  isAllDay?: boolean;
  hasAttachments?: boolean;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

async function mapMicrosoftEvent(
  item: MicrosoftCalendarItem,
  accountEmail: string,
  accessToken: string,
): Promise<CalendarEvent> {
  const startTime = item.start?.dateTime
    ? ensureIso(item.start.dateTime)
    : new Date().toISOString();
  const endTime = item.end?.dateTime
    ? ensureIso(item.end.dateTime)
    : startTime;

  // Online meeting link from structured data, then fallback to parsing body/location
  const joinUrl = item.onlineMeeting?.joinUrl;
  const dialIn = joinUrl
    ? { raw: joinUrl, platform: detectPlatform(joinUrl), url: joinUrl }
    : extractDialIn(item.body?.content, item.location?.displayName);

  // Fetch attachments if the event has them
  let attachments: CalendarEvent['attachments'];
  if (item.hasAttachments) {
    attachments = await fetchMicrosoftEventAttachments(item.id, accessToken);
  }

  return {
    id: item.id,
    provider: 'microsoft',
    accountEmail,
    title: item.subject ?? '(No title)',
    startTime,
    endTime,
    location: item.location?.displayName,
    dialIn,
    attendees: (item.attendees ?? []).map((a) => ({
      email: a.emailAddress.address,
      name: a.emailAddress.name,
      responseStatus: mapResponseStatus(a.status?.response),
    })),
    description: item.body?.content,
    isAllDay: item.isAllDay ?? false,
    organizer: item.organizer?.emailAddress.address,
    attachments,
  };
}

/**
 * Fetch attachments for a specific Microsoft calendar event.
 * Returns metadata + base64 content for file attachments.
 */
async function fetchMicrosoftEventAttachments(
  eventId: string,
  accessToken: string,
): Promise<CalendarEvent['attachments']> {
  try {
    const url = `${GRAPH_API_BASE}/me/events/${eventId}/attachments?$select=id,name,contentType,size,contentBytes`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
      value?: Array<{
        '@odata.type': string;
        id: string;
        name: string;
        contentType: string;
        size: number;
        contentBytes?: string; // base64
      }>;
    };

    return (data.value ?? [])
      .filter((att) => att['@odata.type'] === '#microsoft.graph.fileAttachment' && att.contentBytes)
      .map((att) => ({
        fileId: att.id,
        title: att.name,
        mimeType: att.contentType,
        contentBase64: att.contentBytes,
      }));
  } catch (err) {
    console.error('[MeetingScribe] Failed to fetch Outlook attachments:', err);
    return [];
  }
}

/**
 * Microsoft Graph returns dateTime strings WITHOUT a trailing Z when timezone is
 * specified separately. Ensure we have a valid ISO 8601 string.
 */
function ensureIso(dateTime: string): string {
  if (dateTime.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateTime)) {
    return dateTime;
  }
  return `${dateTime}Z`;
}

function detectPlatform(
  url: string,
): 'zoom' | 'teams' | 'meet' | 'webex' | 'other' {
  if (/teams\.microsoft\.com/i.test(url)) return 'teams';
  if (/zoom\.us/i.test(url)) return 'zoom';
  if (/meet\.google\.com/i.test(url)) return 'meet';
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
    case 'tentativelyAccepted':
      return 'tentative';
    default:
      return 'needsAction';
  }
}
