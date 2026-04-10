/**
 * Notes window — the main app opened when the user clicks "Take Notes".
 *
 * Reads event metadata from URL params, builds a note template, renders
 * the Tiptap editor, and handles save + auto-save drafts.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { MeetingHeader } from './components/MeetingHeader';
import { NoteEditor } from './components/NoteEditor';
import { SaveButton } from './components/SaveButton';
import { WordCount } from './components/WordCount';
import { buildNoteTemplate } from '@/utils/note-template';
import { htmlToDocxBase64 } from '@/utils/docx-export';
import type { CalendarEvent, OAuthProvider, NoteDraft, NoteFormat } from '@/types';
import { STORAGE_KEYS } from '@/types';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

export function App() {
  // Parse URL params from the background service worker
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get('eventId') ?? '';
  const provider = (params.get('provider') ?? 'google') as 'google' | 'microsoft';
  const title = params.get('title') ?? 'Meeting Notes';
  const startTime = params.get('startTime') ?? undefined;
  const endTime = params.get('endTime') ?? undefined;
  const organizer = params.get('organizer') ?? undefined;
  const location = params.get('location') ?? undefined;
  const meetingLink = params.get('meetingLink') ?? undefined;
  const attendeesRaw = params.get('attendees');
  const attendees: Array<{ name?: string; email: string }> = attendeesRaw
    ? (JSON.parse(attendeesRaw) as Array<{ name?: string; email: string }>)
    : [];
  const attachmentsRaw = params.get('attachments');
  const attachments = attachmentsRaw
    ? (JSON.parse(attachmentsRaw) as Array<{ fileId: string; title: string; mimeType: string; fileUrl?: string }>)
    : [];

  // Log attachment status on load
  if (attachments.length > 0) {
    console.log(`[MeetingScribe] Notes window has ${attachments.length} attachments:`, attachments.map((a) => a.title));
  } else {
    console.log('[MeetingScribe] Notes window has no attachments. attachmentsRaw:', attachmentsRaw ? 'present' : 'missing');
  }

  const [contentHtml, setContentHtml] = useState('');
  const [saveFormat, setSaveFormat] = useState<NoteFormat>('docx');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>();
  const [initialized, setInitialized] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Draft key uses title + date — NOT the DOM eventId which is unreliable
  // (Google Calendar reuses/changes event IDs across popup opens).
  // This ensures "LiDAC Daily Stand Up" on 2026-04-10 gets a different draft
  // than "Black Nile Strategy" on the same day.
  const safeTitle = title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
  const dateStr = startTime
    ? new Date(startTime).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const draftKey = `${safeTitle}_${dateStr}`;

  // Build the initial note template on first load
  useEffect(() => {
    if (initialized) return;

    // Check for a saved draft for THIS specific meeting
    loadDraft(draftKey).then((draft) => {
      if (draft) {
        setContentHtml(draft.contentHtml);
      } else {
        // Build template from event metadata (enriched by background worker)
        const event: CalendarEvent = {
          id: eventId,
          provider,
          accountEmail: '',
          title,
          startTime: startTime ?? new Date().toISOString(),
          endTime: endTime ?? new Date().toISOString(),
          attendees: attendees.map((a) => ({
            email: a.email,
            name: a.name,
            responseStatus: 'accepted' as const,
          })),
          isAllDay: false,
          organizer,
          location,
          dialIn: meetingLink ? { raw: meetingLink, url: meetingLink, platform: 'other' as const } : undefined,
        };
        setContentHtml(buildNoteTemplate(event));
      }
      setInitialized(true);
    });
  }, [eventId, provider, title, startTime, endTime, initialized]);

  // Auto-save draft every 30 seconds
  useEffect(() => {
    if (!initialized) return;

    autoSaveTimerRef.current = setInterval(() => {
      saveDraft(draftKey, contentHtml);
    }, 30_000);

    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    };
  }, [initialized, eventId, contentHtml]);

  const handleEditorUpdate = useCallback((html: string) => {
    setContentHtml(html);
  }, []);

  const handleSave = useCallback(
    async (accountId: string, accountProvider: OAuthProvider, folderPath: string, driveId?: string, folderId?: string) => {
      setIsSaving(true);
      try {
        const baseName = generateFileBaseName(title, startTime);
        let fileName: string;
        let mimeType: string;

        const payload: Record<string, unknown> = {
          accountId,
          provider: accountProvider,
          eventId,
          title,
          folderPath,
          driveId,
          folderId,
          attachments: attachments.length > 0 ? attachments : undefined,
          calendarProvider: provider,
        };

        // Build the full document by prepending meeting header to editor content.
        // The header (title, date, attendees, etc.) is displayed on screen by the
        // MeetingHeader component but is NOT in the editor HTML, so we add it here.
        const fullHtml = buildDocumentHtml(
          title, startTime, endTime, organizer, attendees, meetingLink, contentHtml, attachments,
        );

        if (saveFormat === 'docx') {
          const b64 = await htmlToDocxBase64(fullHtml, title);
          fileName = `${baseName}.docx`;
          mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          payload.contentBase64 = b64;
          payload.isBase64 = true;
        } else if (saveFormat === 'html') {
          fileName = `${baseName}.html`;
          mimeType = 'text/html';
          payload.contentText = fullHtml;
        } else {
          fileName = `${baseName}.md`;
          mimeType = 'text/markdown';
          payload.contentText = turndown.turndown(fullHtml);
        }

        payload.fileName = fileName;
        payload.mimeType = mimeType;

        console.log('[MeetingScribe] Sending UPLOAD_NOTE:', {
          fileName,
          attachmentCount: attachments.length,
          mimeType,
          isBase64: !!payload.isBase64,
          contentLength: payload.isBase64
            ? (payload.contentBase64 as string).length
            : (payload.contentText as string).length,
        });

        const response = await chrome.runtime.sendMessage({
          type: 'UPLOAD_NOTE',
          payload,
        });

        if (response?.ok) {
          setLastSavedAt(Date.now());
          // Clear draft after successful save
          await clearDraft(draftKey);
        } else {
          console.error('[MeetingScribe] Save failed:', response?.error);
          alert(`Save failed: ${response?.error ?? 'Unknown error'}`);
        }
      } catch (err) {
        console.error('[MeetingScribe] Save error:', err);
        alert(`Save error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setIsSaving(false);
      }
    },
    [contentHtml, eventId, title, saveFormat, startTime, draftKey],
  );

  if (!initialized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-on-surface-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <MeetingHeader
        title={title}
        startTime={startTime}
        endTime={endTime}
        organizer={organizer}
        attendees={attendees}
        meetingLink={meetingLink}
      />

      <NoteEditor
        initialContent={contentHtml}
        onUpdate={handleEditorUpdate}
      />

      <div className="flex items-center gap-4 mt-2">
        <WordCount html={contentHtml} />
      </div>

      <SaveButton
        onSave={handleSave}
        isSaving={isSaving}
        lastSavedAt={lastSavedAt}
        meetingTitle={title}
        saveFormat={saveFormat}
        onFormatChange={setSaveFormat}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft persistence (chrome.storage.local)
// ---------------------------------------------------------------------------

async function loadDraft(eventId: string): Promise<NoteDraft | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.DRAFTS);
  const drafts = (result[STORAGE_KEYS.DRAFTS] as Record<string, NoteDraft>) ?? {};
  return drafts[eventId] ?? null;
}

async function saveDraft(eventId: string, contentHtml: string): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.DRAFTS);
  const drafts = (result[STORAGE_KEYS.DRAFTS] as Record<string, NoteDraft>) ?? {};
  drafts[eventId] = {
    noteId: `draft-${eventId}`,
    eventId,
    contentHtml,
    savedAt: Date.now(),
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.DRAFTS]: drafts });
}

async function clearDraft(eventId: string): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.DRAFTS);
  const drafts = (result[STORAGE_KEYS.DRAFTS] as Record<string, NoteDraft>) ?? {};
  delete drafts[eventId];
  await chrome.storage.local.set({ [STORAGE_KEYS.DRAFTS]: drafts });
}

// ---------------------------------------------------------------------------
// File naming
// ---------------------------------------------------------------------------

function generateFileBaseName(eventTitle: string, eventStartTime?: string): string {
  const eventDate = eventStartTime ? new Date(eventStartTime) : new Date();
  const datePart = eventDate.toISOString().slice(0, 10);
  const timePart = eventDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(':', '');
  const safeName = eventTitle
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .slice(0, 50);
  return `${datePart} ${timePart} - Meeting Minutes - ${safeName}`;
}

// ---------------------------------------------------------------------------
// Build full document HTML (header + editor content) for saving
// ---------------------------------------------------------------------------

function buildDocumentHtml(
  meetingTitle: string,
  start?: string,
  end?: string,
  org?: string,
  atts?: Array<{ name?: string; email: string }>,
  link?: string,
  editorHtml?: string,
  eventAttachments?: Array<{ title: string; fileUrl?: string }>,
): string {
  const parts: string[] = [];

  // Title
  parts.push(`<h1>${esc(meetingTitle)}</h1>`);

  // Date/time
  if (start) {
    const startDate = new Date(start);
    const datePart = startDate.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
    const startTime = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (end) {
      const endTime = new Date(end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      parts.push(`<p>${esc(datePart)}, ${esc(startTime)} – ${esc(endTime)}</p>`);
    } else {
      parts.push(`<p>${esc(datePart)} at ${esc(startTime)}</p>`);
    }
  }

  // Organizer
  if (org) {
    parts.push(`<p><strong>Organizer:</strong> ${esc(org)}</p>`);
  }

  // Meeting link
  if (link) {
    parts.push(`<p><strong>Meeting Link:</strong> <a href="${esc(link)}">${esc(link)}</a></p>`);
  }

  // Attendees
  if (atts && atts.length > 0) {
    const list = atts.map((a) => {
      const label = a.name ? `${a.name} (${a.email})` : a.email;
      return `<li>${esc(label)}</li>`;
    }).join('');
    parts.push(`<p><strong>Attendees (${atts.length}):</strong></p><ul>${list}</ul>`);
  }

  // Attachments
  if (eventAttachments && eventAttachments.length > 0) {
    const attList = eventAttachments.map((a) => {
      if (a.fileUrl) {
        return `<li><a href="${esc(a.fileUrl)}">${esc(a.title)}</a></li>`;
      }
      return `<li>${esc(a.title)}</li>`;
    }).join('');
    parts.push(`<p><strong>Attachments (${eventAttachments.length}):</strong></p><ul>${attList}</ul>`);
  }

  // Divider
  parts.push('<hr>');

  // Editor content
  if (editorHtml) {
    parts.push(editorHtml);
  }

  return parts.join('');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
