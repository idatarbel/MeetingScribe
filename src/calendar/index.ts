/**
 * MeetingScribe — Unified Calendar API
 *
 * Fetches events from all connected Google + Microsoft calendar accounts
 * and merges them into a single timeline sorted by start time.
 * UX note: when only one calendar source is connected, no "source" labels are needed.
 */

import type { CalendarEvent, ConnectedAccount } from '@/types';
import { loadAccounts } from '@/auth';
import { fetchGoogleCalendarEvents } from './google';
import { fetchMicrosoftCalendarEvents } from './microsoft';

export { fetchGoogleCalendarEvents } from './google';
export { fetchMicrosoftCalendarEvents } from './microsoft';

/**
 * Fetch upcoming events from ALL connected calendar accounts (Google + Microsoft)
 * and merge them into a single timeline sorted by start time.
 *
 * Errors from individual accounts are caught and logged — a single failing
 * account doesn't block events from other accounts.
 */
export async function fetchAllCalendarEvents(
  timeMin?: string,
  timeMax?: string,
  maxResults = 50,
): Promise<CalendarEvent[]> {
  const store = await loadAccounts();
  const fetches: Promise<CalendarEvent[]>[] = [];

  // Google accounts with calendar scope
  for (const account of store.google) {
    if (hasCalendarScope(account, 'google')) {
      fetches.push(
        fetchGoogleCalendarEvents(account, timeMin, timeMax, maxResults).catch(
          (err) => {
            console.error(
              `[MeetingScribe] Failed to fetch Google Calendar for ${account.email}:`,
              err,
            );
            return [];
          },
        ),
      );
    }
  }

  // Microsoft accounts with calendar scope
  for (const account of store.microsoft) {
    if (hasCalendarScope(account, 'microsoft')) {
      fetches.push(
        fetchMicrosoftCalendarEvents(account, timeMin, timeMax, maxResults).catch(
          (err) => {
            console.error(
              `[MeetingScribe] Failed to fetch Microsoft Calendar for ${account.email}:`,
              err,
            );
            return [];
          },
        ),
      );
    }
  }

  const results = await Promise.all(fetches);
  const allEvents = results.flat();

  // Sort by start time ascending
  allEvents.sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );

  return allEvents;
}

/**
 * Check whether a connected account has the calendar-reading scope granted.
 */
function hasCalendarScope(
  account: ConnectedAccount,
  provider: 'google' | 'microsoft',
): boolean {
  if (provider === 'google') {
    return account.scopes.some((s) =>
      s.includes('calendar.readonly') || s.includes('calendar'),
    );
  }
  if (provider === 'microsoft') {
    return account.scopes.some((s) =>
      s.toLowerCase().includes('calendars.read'),
    );
  }
  return false;
}
