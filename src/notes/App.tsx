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
import { mergeTemplate } from '@/utils/docx-template';
import { marked } from 'marked';
import type { CalendarEvent, OAuthProvider, NoteDraft, NoteFormat, ExtensionSettings } from '@/types';
import { STORAGE_KEYS, defaultSettings } from '@/types';
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
  // const location = params.get('location') ?? undefined; // available for future use
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

  // The consistent base name used for cloud files (shared across attendees)
  const meetingBaseName = generateFileBaseName(title, startTime);

  // Load content: Cloud → Local Draft → Fresh Template (in priority order)
  useEffect(() => {
    if (initialized) return;

    (async () => {
      // 1. Try loading from cloud (another attendee may have saved notes already)
      // Need the routing rule to know where to look
      const settingsResult = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
      const settings = (settingsResult[STORAGE_KEYS.SETTINGS] as import('@/types').ExtensionSettings) ?? null;
      const titleLower = title.toLowerCase();
      const rule = settings?.routingRules.find(
        (r: import('@/types').RoutingRule) =>
          r.enabled && r.match.titleContains &&
          (titleLower === r.match.titleContains.toLowerCase() ||
           titleLower.includes(r.match.titleContains.toLowerCase()) ||
           r.match.titleContains.toLowerCase().includes(titleLower)),
      );

      if (rule) {
        try {
          const cloudFolderPath = `${rule.destination.folderPath}/${meetingBaseName}`;
          const response = await chrome.runtime.sendMessage({
            type: 'LOAD_CLOUD_NOTES',
            payload: {
              accountId: rule.destination.accountId,
              folderPath: cloudFolderPath,
              meetingBaseName,
              driveId: rule.destination.driveId,
            },
          });

          if (response?.ok && response.found && response.content) {
            console.log('[MeetingScribe] Loaded existing notes from cloud');
            // Convert markdown back to HTML for the editor
            const html = await marked.parse(response.content);
            setContentHtml(html);
            setInitialized(true);
            return;
          }
        } catch (err) {
          console.warn('[MeetingScribe] Cloud load failed, falling back to local:', err);
        }
      }

      // 2. Try local draft
      const draft = await loadDraft(draftKey);
      if (draft) {
        setContentHtml(draft.contentHtml);
        setInitialized(true);
        return;
      }

      // 3. Fresh template — use custom template from settings if available
      const settingsForTemplate = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
      const currentSettings = (settingsForTemplate[STORAGE_KEYS.SETTINGS] as import('@/types').ExtensionSettings) ?? null;
      if (currentSettings?.noteTemplate) {
        setContentHtml(currentSettings.noteTemplate);
      } else {
        const event: CalendarEvent = {
          id: eventId,
          provider,
          accountEmail: '',
          title,
          startTime: startTime ?? new Date().toISOString(),
          endTime: endTime ?? new Date().toISOString(),
          attendees: [],
          isAllDay: false,
        };
        setContentHtml(buildNoteTemplate(event));
      }
      setInitialized(true);
    })();
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
        // .md file: editor content ONLY (no header) — this is the round-trip format.
        // The header is added by MeetingHeader on-screen and by buildDocumentHtml for .docx.
        // Saving only editor content prevents header duplication on save→load→save cycles.
        const mdContent = turndown.turndown(contentHtml);

        // .docx file: check if user has a custom template, otherwise use built-in
        const settingsForDocx = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
        const docxSettings = (settingsForDocx[STORAGE_KEYS.SETTINGS] as ExtensionSettings) ?? defaultSettings();
        let docxBase64: string;

        if (docxSettings.docxTemplateBase64) {
          // Merge into user's custom .docx template
          console.log('[MeetingScribe] Using custom .docx template:', docxSettings.docxTemplateName);
          docxBase64 = mergeTemplate(docxSettings.docxTemplateBase64, {
            meetingTitle: title,
            startTime,
            endTime,
            organizer,
            attendees,
            meetingLink,
            contentHtml,
          });
        } else {
          // Built-in: generate from HTML with full header
          const fullHtml = buildDocumentHtml(
            title, startTime, endTime, organizer, attendees, meetingLink, contentHtml, attachments,
          );
          docxBase64 = await htmlToDocxBase64(fullHtml, title);
        }

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
          // Always send both formats — background saves both .md and .docx
          contentText: mdContent,
          contentBase64: docxBase64,
          fileName: meetingBaseName,
        };

        console.log('[MeetingScribe] Sending UPLOAD_NOTE:', {
          baseName: meetingBaseName,
          attachmentCount: attachments.length,
          mdLength: mdContent.length,
          docxLength: docxBase64.length,
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
