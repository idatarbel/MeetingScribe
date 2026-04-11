/**
 * Build an initial note template from a CalendarEvent.
 *
 * The template is rendered as HTML (for Tiptap) and includes:
 * - Meeting title
 * - Date and time
 * - Attendees
 * - Conferencing link (if available)
 * - Empty sections for Agenda, Notes, and Action Items
 */

import type { CalendarEvent } from '@/types';

/**
 * Format a CalendarEvent into an HTML note template for the Tiptap editor.
 */
export function buildNoteTemplate(_event: CalendarEvent): string {
  const parts: string[] = [];

  // NOTE: Title, date, organizer, attendees, and meeting link are all displayed
  // in the MeetingHeader component above the editor. The template only contains
  // the editable note sections.

  // Sections
  parts.push('<h2>Agenda</h2>');
  parts.push('<ul><li></li></ul>');

  parts.push('<h2>Notes</h2>');
  parts.push('<ul><li></li></ul>');

  parts.push('<h2>Action Items</h2>');
  parts.push('<ul><li></li></ul>');

  return parts.join('');
}

/**
 * Format event start/end into a human-readable string.
 * Exported for use in components that need date formatting.
 */
export function formatEventTime(start: string, end: string, isAllDay: boolean): string {
  if (isAllDay) {
    return new Date(start).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  const startDate = new Date(start);
  const endDate = new Date(end);

  const datePart = startDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const startTime = startDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  const endTime = endDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `${datePart}, ${startTime} – ${endTime}`;
}

/** Minimal HTML entity escaping. Exported for use in other modules. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
