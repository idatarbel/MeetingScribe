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
  // Note: title, date, organizer, attendees, and meeting link are now rendered
  // by the MeetingHeader component, NOT in the template. The template only
  // contains the editable note sections (Agenda, Notes, Action Items).

  it('includes Agenda, Notes, and Action Items sections', () => {
    const html = buildNoteTemplate(makeEvent());
    expect(html).toContain('<h2>Agenda</h2>');
    expect(html).toContain('<h2>Notes</h2>');
    expect(html).toContain('<h2>Action Items</h2>');
  });

  it('includes empty bullet lists for Agenda and Action Items', () => {
    const html = buildNoteTemplate(makeEvent());
    expect(html).toContain('<ul><li></li></ul>');
  });

  it('includes an empty paragraph for Notes', () => {
    const html = buildNoteTemplate(makeEvent());
    expect(html).toContain('<p></p>');
  });
});
