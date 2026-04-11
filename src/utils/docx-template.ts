/**
 * Merge meeting data into a user-uploaded .docx template using docxtemplater.
 *
 * Templates use {placeholder} syntax. Available variables:
 *   {meetingTitle}  — Meeting title
 *   {date}          — Formatted date (e.g., "Thu, Apr 10, 2026")
 *   {startTime}     — Start time (e.g., "9:15 AM")
 *   {endTime}       — End time (e.g., "9:45 AM")
 *   {dateTime}      — Full date + time range
 *   {organizer}     — Organizer name/email
 *   {attendees}     — Comma-separated attendee list
 *   {attendeeList}  — Bullet-formatted attendee list (one per line)
 *   {meetingLink}   — Conferencing URL
 *   {notes}         — Full meeting notes content (plain text)
 *   {agenda}        — Agenda section content
 *   {actionItems}   — Action items section content
 */

import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
});

export interface TemplateData {
  meetingTitle: string;
  startTime?: string;
  endTime?: string;
  organizer?: string;
  attendees?: Array<{ name?: string; email: string }>;
  meetingLink?: string;
  contentHtml: string;
}

/**
 * Merge meeting data into a .docx template.
 * @param templateBase64 — The template .docx file as base64 string
 * @param data — Meeting data to merge
 * @returns base64 string of the merged .docx
 */
export function mergeTemplate(
  templateBase64: string,
  data: TemplateData,
): string {
  // Decode base64 to binary
  const binaryStr = atob(templateBase64);
  const zip = new PizZip(binaryStr, { base64: false });

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // Don't throw on missing placeholders — just leave them empty
    nullGetter: () => '',
  });

  // Build template variables
  const startDate = data.startTime ? new Date(data.startTime) : null;
  const endDate = data.endTime ? new Date(data.endTime) : null;

  const dateFormatted = startDate
    ? startDate.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      })
    : '';

  const startTimeFormatted = startDate
    ? startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  const endTimeFormatted = endDate
    ? endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  const dateTime = startTimeFormatted && endTimeFormatted
    ? `${dateFormatted}, ${startTimeFormatted} – ${endTimeFormatted}`
    : dateFormatted;

  const attendeeNames = (data.attendees ?? [])
    .map((a) => a.name ?? a.email)
    .join(', ');

  const attendeeList = (data.attendees ?? [])
    .map((a) => a.name ? `${a.name} (${a.email})` : a.email)
    .join('\n');

  // Convert HTML notes to plain text for template insertion
  const notesText = turndown.turndown(data.contentHtml);

  // Try to extract sections from the notes
  const agendaMatch = notesText.match(/## Agenda\n([\s\S]*?)(?=\n## |$)/i);
  const actionMatch = notesText.match(/## Action Items\n([\s\S]*?)(?=\n## |$)/i);

  doc.render({
    meetingTitle: data.meetingTitle,
    date: dateFormatted,
    startTime: startTimeFormatted,
    endTime: endTimeFormatted,
    dateTime,
    organizer: data.organizer ?? '',
    attendees: attendeeNames,
    attendeeList,
    meetingLink: data.meetingLink ?? '',
    notes: notesText,
    agenda: agendaMatch?.[1]?.trim() ?? '',
    actionItems: actionMatch?.[1]?.trim() ?? '',
  });

  // Generate output as base64
  const output = doc.getZip().generate({
    type: 'base64',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  return output;
}

/**
 * List of available template placeholders for the UI.
 */
export const TEMPLATE_PLACEHOLDERS = [
  { name: '{meetingTitle}', description: 'Meeting title' },
  { name: '{date}', description: 'Date (e.g., Thu, Apr 10, 2026)' },
  { name: '{startTime}', description: 'Start time (e.g., 9:15 AM)' },
  { name: '{endTime}', description: 'End time (e.g., 9:45 AM)' },
  { name: '{dateTime}', description: 'Full date + time range' },
  { name: '{organizer}', description: 'Meeting organizer' },
  { name: '{attendees}', description: 'Comma-separated attendee names' },
  { name: '{attendeeList}', description: 'One attendee per line with email' },
  { name: '{meetingLink}', description: 'Meeting/conferencing URL' },
  { name: '{notes}', description: 'Full meeting notes (plain text)' },
  { name: '{agenda}', description: 'Agenda section content' },
  { name: '{actionItems}', description: 'Action items section content' },
];
