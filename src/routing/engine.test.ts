import { resolveRoute, matchesRule } from './engine';
import type {
  CalendarEvent,
  RoutingRule,
  DefaultDestination,
  RoutingMatch,
} from '@/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    provider: 'google',
    accountEmail: 'danspiegel@gmail.com',
    title: 'Weekly Standup',
    startTime: '2026-04-10T09:00:00-04:00',
    endTime: '2026-04-10T09:30:00-04:00',
    attendees: [
      { email: 'danspiegel@gmail.com', name: 'Dan Spiegel', responseStatus: 'accepted' },
      { email: 'sarah.khan@blacknile.ai', name: 'Sarah Khan', responseStatus: 'accepted' },
    ],
    isAllDay: false,
    organizer: 'danspiegel@gmail.com',
    ...overrides,
  };
}

function makeRule(overrides: Partial<RoutingRule> = {}): RoutingRule {
  return {
    id: 'rule-1',
    label: 'Test Rule',
    match: {},
    destination: {
      provider: 'google',
      accountId: 'google:danspiegel@gmail.com',
      folderPath: '/Meetings',
      fileNameTemplate: '{date}_{title}',
      format: 'markdown',
    },
    priority: 10,
    enabled: true,
    ...overrides,
  };
}

const defaultDest: DefaultDestination = {
  provider: 'dropbox',
  accountId: 'dropbox:danspiegel@danspiegelllc.com',
  folderPath: '/MeetingNotes',
  fileNameTemplate: '{date}_{title}',
  format: 'markdown',
  isDefault: true,
};

// ---------------------------------------------------------------------------
// matchesRule tests
// ---------------------------------------------------------------------------

describe('matchesRule', () => {
  const event = makeEvent();

  it('matches when all match fields are empty (wildcard)', () => {
    expect(matchesRule(event, {})).toBe(true);
  });

  it('matches on titleContains (case-insensitive)', () => {
    expect(matchesRule(event, { titleContains: 'standup' })).toBe(true);
    expect(matchesRule(event, { titleContains: 'WEEKLY' })).toBe(true);
    expect(matchesRule(event, { titleContains: 'retro' })).toBe(false);
  });

  it('matches on calendarAccountEmail (case-insensitive)', () => {
    expect(matchesRule(event, { calendarAccountEmail: 'danspiegel@gmail.com' })).toBe(true);
    expect(matchesRule(event, { calendarAccountEmail: 'DanSpiegel@Gmail.com' })).toBe(true);
    expect(matchesRule(event, { calendarAccountEmail: 'other@example.com' })).toBe(false);
  });

  it('matches on calendarProvider', () => {
    expect(matchesRule(event, { calendarProvider: 'google' })).toBe(true);
    expect(matchesRule(event, { calendarProvider: 'microsoft' })).toBe(false);
  });

  it('matches on attendeeEmail (case-insensitive)', () => {
    expect(matchesRule(event, { attendeeEmail: 'sarah.khan@blacknile.ai' })).toBe(true);
    expect(matchesRule(event, { attendeeEmail: 'Sarah.Khan@BlackNile.ai' })).toBe(true);
    expect(matchesRule(event, { attendeeEmail: 'unknown@example.com' })).toBe(false);
  });

  it('matches on organizerEmail (case-insensitive)', () => {
    expect(matchesRule(event, { organizerEmail: 'danspiegel@gmail.com' })).toBe(true);
    expect(matchesRule(event, { organizerEmail: 'other@example.com' })).toBe(false);
  });

  it('fails organizerEmail when event has no organizer', () => {
    const noOrg = makeEvent({ organizer: undefined });
    expect(matchesRule(noOrg, { organizerEmail: 'danspiegel@gmail.com' })).toBe(false);
  });

  it('matches on calendarName (case-insensitive)', () => {
    const withCal = makeEvent({ calendarName: 'Work' });
    expect(matchesRule(withCal, { calendarName: 'work' })).toBe(true);
    expect(matchesRule(withCal, { calendarName: 'Personal' })).toBe(false);
  });

  it('fails calendarName when event has no calendarName', () => {
    expect(matchesRule(event, { calendarName: 'Work' })).toBe(false);
  });

  it('applies AND logic — all specified fields must match', () => {
    const andMatch: RoutingMatch = {
      titleContains: 'standup',
      calendarProvider: 'google',
      attendeeEmail: 'sarah.khan@blacknile.ai',
    };
    expect(matchesRule(event, andMatch)).toBe(true);

    // Change one field to non-matching
    const broken: RoutingMatch = {
      ...andMatch,
      calendarProvider: 'microsoft',
    };
    expect(matchesRule(event, broken)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveRoute tests
// ---------------------------------------------------------------------------

describe('resolveRoute', () => {
  it('returns default destination when no rules exist', () => {
    const result = resolveRoute(makeEvent(), [], defaultDest);
    expect(result.isDefault).toBe(true);
    expect(result.destination).toBe(defaultDest);
    expect(result.matchedRule).toBeNull();
  });

  it('returns null destination when no rules exist and no default is set', () => {
    const result = resolveRoute(makeEvent(), [], null);
    expect(result.isDefault).toBe(true);
    expect(result.destination).toBeNull();
    expect(result.matchedRule).toBeNull();
  });

  it('matches the first rule by priority', () => {
    const lowPriority = makeRule({
      id: 'rule-low',
      priority: 20,
      match: { titleContains: 'standup' },
      destination: {
        provider: 'dropbox',
        accountId: 'dropbox:low',
        folderPath: '/Low',
        fileNameTemplate: '{title}',
        format: 'markdown',
      },
    });
    const highPriority = makeRule({
      id: 'rule-high',
      priority: 5,
      match: { titleContains: 'standup' },
      destination: {
        provider: 'google',
        accountId: 'google:high',
        folderPath: '/High',
        fileNameTemplate: '{title}',
        format: 'markdown',
      },
    });

    // Pass rules in wrong order — engine should sort by priority.
    const result = resolveRoute(makeEvent(), [lowPriority, highPriority], defaultDest);
    expect(result.isDefault).toBe(false);
    expect(result.matchedRule?.id).toBe('rule-high');
    expect(result.destination?.folderPath).toBe('/High');
  });

  it('skips disabled rules', () => {
    const disabled = makeRule({
      id: 'disabled-rule',
      enabled: false,
      match: { titleContains: 'standup' },
    });
    const result = resolveRoute(makeEvent(), [disabled], defaultDest);
    expect(result.isDefault).toBe(true);
    expect(result.matchedRule).toBeNull();
  });

  it('falls through non-matching rules to default', () => {
    const noMatch = makeRule({
      match: { titleContains: 'retro' },
    });
    const result = resolveRoute(makeEvent(), [noMatch], defaultDest);
    expect(result.isDefault).toBe(true);
    expect(result.destination).toBe(defaultDest);
  });

  it('matches the first applicable rule and stops', () => {
    const rule1 = makeRule({
      id: 'r1',
      priority: 1,
      match: { titleContains: 'standup' },
      destination: {
        provider: 'google',
        accountId: 'google:first',
        folderPath: '/First',
        fileNameTemplate: '{title}',
        format: 'markdown',
      },
    });
    const rule2 = makeRule({
      id: 'r2',
      priority: 2,
      match: { calendarProvider: 'google' },
      destination: {
        provider: 'microsoft',
        accountId: 'microsoft:second',
        folderPath: '/Second',
        fileNameTemplate: '{title}',
        format: 'html',
      },
    });

    const result = resolveRoute(makeEvent(), [rule2, rule1], defaultDest);
    // rule1 has higher priority (lower number), and both match.
    // Engine should pick rule1.
    expect(result.matchedRule?.id).toBe('r1');
    expect(result.destination?.folderPath).toBe('/First');
  });

  it('handles complex multi-field match', () => {
    const rule = makeRule({
      match: {
        calendarProvider: 'google',
        attendeeEmail: 'sarah.khan@blacknile.ai',
        titleContains: 'standup',
      },
      destination: {
        provider: 'microsoft',
        accountId: 'microsoft:dan.spiegel@blacknile.ai',
        folderPath: '/BlackNile/Meetings',
        fileNameTemplate: '{date}_{title}',
        format: 'markdown',
      },
    });

    const result = resolveRoute(makeEvent(), [rule], defaultDest);
    expect(result.isDefault).toBe(false);
    expect(result.destination?.folderPath).toBe('/BlackNile/Meetings');
  });
});
