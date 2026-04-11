# Known Defects — MeetingScribe

## Active Defects (as of 2026-04-11)

### 1. Draft contamination across meetings
**Symptom:** Opening Take Notes on Meeting B shows the notes from Meeting A.
**Root cause:** The draft key is based on `title + date`, but Google Calendar's content script sometimes extracts the wrong title (truncated, or from the wrong DOM element). If two meetings produce the same draft key, they share drafts.
**Fix needed:** Use the Google Calendar event ID from the `data-eventid` attribute as part of the draft key instead of the title. The event ID is stable and unique per event instance.

### 2. Missing metadata (organizer, attendees, date/time) on some meetings
**Symptom:** Take Notes window shows only the title, no attendees/organizer/time.
**Root cause:** The background worker enriches event data from the calendar API cache. Enrichment fails when:
- The content script's title doesn't match the API's title (Google Calendar UI may show a different title than the API `summary` field)
- The event is from a calendar that isn't being polled (e.g., a subscribed/shared calendar)
- The Microsoft Graph calendar fetch fails silently (scope issues, token expiry)
**Fix needed:**
1. Log and surface calendar poll errors per account
2. Fall back to extracting metadata directly from the Google Calendar DOM (the event popup has organizer, time, attendees visible)
3. Add a "Refresh" button in the notes window that re-polls and re-enriches

### 3. Google Calendar title extraction unreliable
**Symptom:** Title is truncated (e.g., "IconicChat" instead of "IconicChat Team Meeting") or includes extra text.
**Root cause:** The content script's DOM selectors may match the event chip (truncated) instead of the event detail popup (full). The `aria-label` fallback may include extra context (calendar name, event type). The API `summary` field may differ from the UI display.
**Fix needed:** Extract title from the event detail popup heading specifically, not from the first `[data-eventid]` match. Consider using the popup's `[role="heading"]` or `h2`/`h3` elements within the opened detail view.

### 4. Outlook Web Take Notes button flashes on some re-renders
**Symptom:** Button briefly disappears and reappears.
**Root cause:** Outlook's React framework re-renders sections of the page, which can trigger our poll to detect "no panel" for one cycle before detecting it again.
**Fix needed:** Add a grace period — only remove the button if the detail panel has been absent for 3+ consecutive polls (6+ seconds).

### 5. Google Drive cloud load may fail silently
**Symptom:** Re-opening Take Notes on a Google Drive meeting shows a blank template instead of the previously saved notes.
**Root cause:** The `loadFromGoogleDrive` function resolves folders by walking the path. If any folder name contains special characters or the path doesn't match exactly, resolution fails and returns null.
**Fix needed:** Check service worker console for `[MeetingScribe] Google Drive: folder not found` logs and fix path matching.

## Architecture Improvement Needed

### Event identity
The core issue behind defects 1-3 is that MeetingScribe doesn't have a reliable, stable event identifier that works across:
- The content script (DOM `data-eventid`)
- The calendar API (event `id`)
- The notes window (URL param `eventId`)
- Draft storage (draft key)
- Cloud file naming (folder name)

A future refactor should establish a canonical event identity that maps DOM IDs to API IDs on first encounter and persists the mapping in `chrome.storage.local`.
