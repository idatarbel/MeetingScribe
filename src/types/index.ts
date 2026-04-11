/**
 * MeetingScribe — Core type definitions
 *
 * These types are the single source of truth for the extension's domain model.
 * Every module imports from here; nothing defines its own ad-hoc shapes.
 */

// ---------------------------------------------------------------------------
// Auth & Connected Accounts
// ---------------------------------------------------------------------------

export type OAuthProvider = 'google' | 'microsoft' | 'dropbox';

/** A single authenticated account for any provider. */
export interface ConnectedAccount {
  /** Unique stable key, e.g. "google:danspiegel@gmail.com" */
  id: string;
  provider: OAuthProvider;
  email: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
  /** Unix ms when the current accessToken expires. */
  expiresAt: number;
  /** Scopes that were granted during the most recent auth flow. */
  scopes: string[];
  /** Unix ms when this account was first connected. */
  addedAt: number;
}

/** Shape stored in chrome.storage.local under key "connectedAccounts". */
export type ConnectedAccountStore = Record<OAuthProvider, ConnectedAccount[]>;

export function emptyAccountStore(): ConnectedAccountStore {
  return { google: [], microsoft: [], dropbox: [] };
}

// ---------------------------------------------------------------------------
// Calendar Events
// ---------------------------------------------------------------------------

export type CalendarProvider = 'google' | 'microsoft';

export interface CalendarEvent {
  /** Provider-specific event ID (Google or Microsoft Graph). */
  id: string;
  provider: CalendarProvider;
  /** The account email this event was fetched from. */
  accountEmail: string;
  title: string;
  /** ISO 8601 date-time string. */
  startTime: string;
  /** ISO 8601 date-time string. */
  endTime: string;
  /** Raw location string from the calendar event. */
  location?: string;
  /** Dial-in / video conferencing info stripped from description/location. */
  dialIn?: DialInInfo;
  /** Attendee list. */
  attendees: Attendee[];
  /** HTML or plain text description/body from the calendar event. */
  description?: string;
  /** Calendar name (e.g. "Work", "Personal"). */
  calendarName?: string;
  /** Whether this event is an all-day event. */
  isAllDay: boolean;
  /** Organizer email. */
  organizer?: string;
  /** File attachments on the calendar event. */
  attachments?: EventAttachment[];
}

export interface EventAttachment {
  /** Provider-specific file ID (Google Drive fileId, Outlook attachment ID). */
  fileId: string;
  /** Display name of the file. */
  title: string;
  /** MIME type. */
  mimeType: string;
  /** Direct URL to the file (Google Drive link, etc.) */
  fileUrl?: string;
  /** For Outlook: base64-encoded content (inline for small files). */
  contentBase64?: string;
}

export interface Attendee {
  email: string;
  name?: string;
  responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
}

export interface DialInInfo {
  /** Raw dial-in string (phone number, conference URL, etc.) */
  raw: string;
  /** Detected conference platform. */
  platform?: 'zoom' | 'teams' | 'meet' | 'webex' | 'other';
  /** Cleaned meeting URL, if available. */
  url?: string;
}

// ---------------------------------------------------------------------------
// Meeting Notes
// ---------------------------------------------------------------------------

export type NoteFormat = 'html' | 'markdown' | 'docx';

export interface MeetingNote {
  /** UUID v4 generated at note creation time. */
  id: string;
  /** Reference to the calendar event this note is for. */
  eventId: string;
  eventProvider: CalendarProvider;
  /** Snapshot of event metadata at the time the note was created. */
  eventTitle: string;
  eventStartTime: string;
  /** The Tiptap editor's HTML output. */
  contentHtml: string;
  /** Markdown conversion of contentHtml via turndown. */
  contentMarkdown: string;
  /** Unix ms timestamps. */
  createdAt: number;
  updatedAt: number;
  /** Where this note has been saved. Empty if not yet saved. */
  savedTo: SavedDestination[];
  /** Word count of the plain-text content. */
  wordCount: number;
}

export interface SavedDestination {
  provider: OAuthProvider;
  accountId: string;
  accountEmail: string;
  /** Full path including filename, e.g. "/Meetings/2026-04/standup.md" */
  filePath: string;
  /** Provider-specific file ID (Google Drive fileId, OneDrive item ID, etc.) */
  fileId?: string;
  /** Public or internal URL to the saved file. */
  fileUrl?: string;
  /** Unix ms when the upload completed. */
  savedAt: number;
}

// ---------------------------------------------------------------------------
// Draft auto-save
// ---------------------------------------------------------------------------

export interface NoteDraft {
  noteId: string;
  eventId: string;
  contentHtml: string;
  /** Unix ms when the draft was last auto-saved. */
  savedAt: number;
}

// ---------------------------------------------------------------------------
// Routing Engine
// ---------------------------------------------------------------------------

export interface RoutingRule {
  /** UUID v4 for stable identity + drag-reorder. */
  id: string;
  /** Human-readable label, e.g. "Black Nile meetings → OneDrive". */
  label: string;
  /** Match condition — evaluated against the CalendarEvent. */
  match: RoutingMatch;
  /** Where to save when this rule matches. */
  destination: RoutingDestination;
  /** Lower number = higher priority. Rules are evaluated in order. */
  priority: number;
  /** If false, this rule is skipped during evaluation. */
  enabled: boolean;
}

export interface RoutingMatch {
  /** Match mode for each field. All specified fields must match (AND logic). */
  /** Substring or regex match against event title. Case-insensitive. */
  titleContains?: string;
  /** Match events from a specific calendar account email. */
  calendarAccountEmail?: string;
  /** Match events from a specific calendar provider. */
  calendarProvider?: CalendarProvider;
  /** Match events that include a specific attendee email. */
  attendeeEmail?: string;
  /** Match events whose organizer matches this email. */
  organizerEmail?: string;
  /** Match events on a specific calendar name. */
  calendarName?: string;
}

export interface RoutingDestination {
  provider: OAuthProvider;
  /** Must reference a ConnectedAccount.id that exists in the store. */
  accountId: string;
  /** Folder path on the destination provider, e.g. "/Meetings/BlackNile". */
  folderPath: string;
  /** File naming template, e.g. "{date}_{title}" → "2026-04-10_Standup". */
  fileNameTemplate: string;
  /** Output format. */
  format: NoteFormat;
  /** For OneDrive shared drives — the remote drive ID. */
  driveId?: string;
  /** For OneDrive shared drives — the folder item ID. */
  folderId?: string;
}

/** The catch-all destination used when no routing rule matches. */
export interface DefaultDestination extends RoutingDestination {
  /** Always true — distinguishes from regular RoutingDestination at type level. */
  isDefault: true;
}

// ---------------------------------------------------------------------------
// Extension Settings (Options page)
// ---------------------------------------------------------------------------

export interface ExtensionSettings {
  /** Routing rules in priority order (index 0 = highest). */
  routingRules: RoutingRule[];
  /** Fallback destination when no rule matches. */
  defaultDestination: DefaultDestination | null;
  /** Auto-save draft interval in seconds. 0 = disabled. */
  autoSaveIntervalSec: number;
  /** Minutes before meeting start to show "Take Notes" notification. */
  reminderMinutesBefore: number;
  /** Whether to poll calendars for upcoming meetings. */
  calendarPollingEnabled: boolean;
  /** Polling interval in minutes. */
  calendarPollingIntervalMin: number;
  /** Default note format for new notes. */
  defaultNoteFormat: NoteFormat;
  /** Custom HTML template for new notes. If empty, uses the default template. */
  noteTemplate: string;
  /** User-uploaded .docx template as base64. If empty, uses built-in docx generation. */
  docxTemplateBase64: string;
  /** Original filename of the uploaded .docx template (for display). */
  docxTemplateName: string;
}

export function defaultSettings(): ExtensionSettings {
  return {
    routingRules: [],
    defaultDestination: null,
    autoSaveIntervalSec: 30,
    reminderMinutesBefore: 5,
    calendarPollingEnabled: true,
    calendarPollingIntervalMin: 10,
    defaultNoteFormat: 'markdown',
    noteTemplate: '',
    docxTemplateBase64: '',
    docxTemplateName: '',
  };
}

// ---------------------------------------------------------------------------
// Chrome storage keys (single source of truth for key names)
// ---------------------------------------------------------------------------

export const STORAGE_KEYS = {
  CONNECTED_ACCOUNTS: 'connectedAccounts',
  SETTINGS: 'settings',
  DRAFTS: 'drafts',
  CACHED_EVENTS: 'cachedEvents',
} as const;
