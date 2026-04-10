/**
 * MeetingScribe — Routing Engine
 *
 * Evaluates a list of RoutingRules against a CalendarEvent and returns the
 * first matching destination (or the default destination if no rule matches).
 *
 * Rules are evaluated in priority order (lowest priority number first).
 * Within a rule, all specified match fields must match (AND logic).
 * Unspecified fields are treated as "match anything".
 */

import type {
  CalendarEvent,
  RoutingRule,
  RoutingDestination,
  DefaultDestination,
  RoutingMatch,
} from '@/types';

export interface RouteResult {
  /** The destination to save to. Null if no rule matched AND no default is set. */
  destination: RoutingDestination | DefaultDestination | null;
  /** The rule that matched, or null if falling through to default. */
  matchedRule: RoutingRule | null;
  /** Whether this result came from the default destination (no rule matched). */
  isDefault: boolean;
}

/**
 * Find the best routing destination for a calendar event.
 *
 * @param event - The calendar event to route.
 * @param rules - All configured routing rules (will be sorted by priority).
 * @param defaultDestination - Fallback when no rule matches. May be null.
 * @returns The routing result with the selected destination.
 */
export function resolveRoute(
  event: CalendarEvent,
  rules: RoutingRule[],
  defaultDestination: DefaultDestination | null,
): RouteResult {
  // Sort by priority ascending (lower number = higher priority).
  // Stable sort preserves insertion order for equal priorities.
  const sorted = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (matchesRule(event, rule.match)) {
      return {
        destination: rule.destination,
        matchedRule: rule,
        isDefault: false,
      };
    }
  }

  return {
    destination: defaultDestination,
    matchedRule: null,
    isDefault: true,
  };
}

/**
 * Test whether a calendar event satisfies all conditions in a RoutingMatch.
 * All specified fields must match (AND). Unspecified fields are ignored.
 */
export function matchesRule(event: CalendarEvent, match: RoutingMatch): boolean {
  if (match.titleContains !== undefined) {
    const pattern = match.titleContains.toLowerCase();
    if (!event.title.toLowerCase().includes(pattern)) {
      return false;
    }
  }

  if (match.calendarAccountEmail !== undefined) {
    if (event.accountEmail.toLowerCase() !== match.calendarAccountEmail.toLowerCase()) {
      return false;
    }
  }

  if (match.calendarProvider !== undefined) {
    if (event.provider !== match.calendarProvider) {
      return false;
    }
  }

  if (match.attendeeEmail !== undefined) {
    const target = match.attendeeEmail.toLowerCase();
    const found = event.attendees.some((a) => a.email.toLowerCase() === target);
    if (!found) {
      return false;
    }
  }

  if (match.organizerEmail !== undefined) {
    if (!event.organizer || event.organizer.toLowerCase() !== match.organizerEmail.toLowerCase()) {
      return false;
    }
  }

  if (match.calendarName !== undefined) {
    if (!event.calendarName || event.calendarName.toLowerCase() !== match.calendarName.toLowerCase()) {
      return false;
    }
  }

  return true;
}
