import { buildNoteTemplate } from './note-template';
import type { CalendarEvent } from '@/types';

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

describe('buildNoteTemplate', () => {
  it('includes the meeting title as h1', () => {
    const html = buildNoteTemplate(makeEvent());
    expect(html).toContain('<h1>Weekly Standup</h1>');
  });

  it('includes the date', () => {
    const html = buildNoteTemplate(makeEvent());
    expect(html).toContain('<strong>Date:</strong>');
  });

  it('includes organizer when present', () => {
    const html = buildNoteTemplate(makeEvent());
    expect(html).toContain('danspiegel@gmail.com');
    expect(html).toContain('<strong>Organizer:</strong>');
  });

  it('omits organizer when absent', () => {
    const html = buildNoteTemplate(makeEvent({ organizer: undefined }));
    expect(html).not.toContain('<strong>Organizer:</strong>');
  });

  it('lists attendees', () => {
    const html = buildNoteTemplate(makeEvent());
    expect(html).toContain('Dan Spiegel');
    expect(html).toContain('Sarah Khan');
    expect(html).toContain('<li>');
  });

  it('includes meeting link when dialIn has a URL', () => {
    const html = buildNoteTemplate(
      makeEvent({
        dialIn: {
          raw: 'https://meet.google.com/abc-def',
          platform: 'meet',
          url: 'https://meet.google.com/abc-def',
        },
      }),
    );
    expect(html).toContain('meet.google.com');
    expect(html).toContain('<a href=');
  });

  it('shows location when no dialIn URL', () => {
    const html = buildNoteTemplate(
      makeEvent({
        location: 'Conference Room B',
        dialIn: undefined,
      }),
    );
    expect(html).toContain('Conference Room B');
    expect(html).toContain('<strong>Location:</strong>');
  });

  it('includes Agenda, Notes, and Action Items sections', () => {
    const html = buildNoteTemplate(makeEvent());
    expect(html).toContain('<h2>Agenda</h2>');
    expect(html).toContain('<h2>Notes</h2>');
    expect(html).toContain('<h2>Action Items</h2>');
  });

  it('escapes HTML in title', () => {
    const html = buildNoteTemplate(makeEvent({ title: 'Q&A <Session>' }));
    expect(html).toContain('Q&amp;A &lt;Session&gt;');
  });

  it('handles all-day events', () => {
    const html = buildNoteTemplate(makeEvent({ isAllDay: true }));
    // All-day events should show just the date, no time range
    expect(html).not.toContain('–'); // no time range separator
  });
});
