# MeetingScribe — Permissions Justification

This document explains why MeetingScribe requests each Chrome extension permission, as required by the Chrome Web Store review process.

## Manifest Permissions

### `identity`
**Why:** Used to invoke `chrome.identity.launchWebAuthFlow()` for OAuth 2.0 authentication with Google, Microsoft, and Dropbox. This API opens a secure browser window for the user to sign in to their cloud accounts. No user credentials are accessed by the extension — only OAuth tokens returned by the identity provider.

### `storage`
**Why:** Used to persist connected account tokens (`chrome.storage.local`), user settings (routing rules, preferences), draft notes (auto-saved editor content), and cached calendar events. All data stays on the user's local machine; nothing is transmitted to external servers beyond the user's own cloud storage providers.

### `alarms`
**Why:** Used for two purposes:
1. **Periodic calendar polling** — A repeating alarm fetches upcoming events from connected calendars every N minutes (configurable, default 10 min) so the extension can show relevant meetings.
2. **Meeting reminders** — Per-event alarms fire N minutes before each meeting starts (configurable, default 5 min) to trigger a Chrome notification.

### `notifications`
**Why:** Used to display meeting reminders. When a scheduled alarm fires before a meeting, a Chrome notification appears with the meeting title and a "Take Notes" action. Clicking the notification opens the notes editor window for that meeting.

## Host Permissions

### `https://www.googleapis.com/*` and `https://accounts.google.com/*`
**Why:** Required to make API calls to Google Calendar API v3 (fetch events), Google Drive API v3 (upload notes), and Google OAuth 2.0 token endpoint (exchange authorization codes for access tokens).

### `https://login.microsoftonline.com/*` and `https://graph.microsoft.com/*`
**Why:** Required to authenticate with Microsoft via OAuth 2.0 (token endpoint) and to call Microsoft Graph API for calendar events (`/me/calendarView`) and OneDrive file uploads (`/me/drive`).

### `https://api.dropboxapi.com/*`, `https://content.dropboxapi.com/*`, and `https://www.dropbox.com/*`
**Why:** Required for Dropbox OAuth 2.0 authentication (token endpoint at `api.dropboxapi.com`), file uploads (`content.dropboxapi.com/2/files/upload`), and user profile retrieval. The `www.dropbox.com` permission is needed for the OAuth authorization page.

## Content Scripts

### `https://calendar.google.com/*`
**Why:** Injects a "Take Notes" button into the Google Calendar web interface when viewing event details. Uses a MutationObserver to detect when an event popup or detail view is open, then adds a small button that opens the MeetingScribe notes editor for that event. No calendar data is read from the DOM — event metadata is fetched via the Calendar API.

### `https://outlook.office.com/*`, `https://outlook.office365.com/*`, `https://outlook.live.com/*`
**Why:** Same as above, but for Microsoft Outlook Web (both business and personal). Injects a "Take Notes" button into the Outlook calendar event detail view.

## Data Handling

- **No remote server.** MeetingScribe has no backend server. All data flows directly between the user's browser and their own cloud storage providers (Google, Microsoft, Dropbox).
- **No analytics or tracking.** No user behavior data is collected or transmitted.
- **Tokens stored locally.** OAuth tokens are stored in `chrome.storage.local` on the user's machine. They are never sent to any server other than the respective OAuth provider for token refresh.
- **Notes stored in user's cloud.** Meeting notes are uploaded to the user's own Google Drive, OneDrive, or Dropbox account — never to any MeetingScribe-controlled storage.
