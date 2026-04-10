### Phase 0 — OAuth Console Setup
- Google, Azure, and Dropbox developer apps all created and configured in one session
- Key gotcha: Azure's new "Authentication (Preview)" blade has a simpler UI than documented — no "Add a platform" button, just "Add Redirect URI" which auto-creates the SPA platform
- Google's OAuth consent screen "Test users" only accepts Google accounts — Microsoft-only users like `sarah.khan@blacknile.ai` can't be added (and don't need to be)
- Extension ID from first unpacked build: `fcjkeemghkfclpogdoblpoghakfagabk`

### Phase 1 — Scaffold
- crxjs 2.0.0-beta.28 initially installed but a stable 2.4.0 exists — upgraded immediately
- Dropbox sync causes intermittent EBUSY errors when Vite tries to clear `dist/` — retrying the build always works. Consider adding `dist/` to Dropbox's selective sync exclusions if this becomes annoying
- Notes page required manual rollupOptions.input since crxjs only auto-discovers pages referenced in manifest.json
- `import.meta.env` requires a `vite-env.d.ts` with `/// <reference types="vite/client" />` for TypeScript to understand Vite's env variables
- `__dirname` doesn't exist in ESM — used `dirname(fileURLToPath(import.meta.url))` pattern in vite.config.ts and vitest.config.ts

### Phase 2 — Types + Routing Engine
- Types are the single source of truth in `src/types/index.ts` — every module imports from there
- Routing engine uses AND logic for match conditions and priority-sorted evaluation
- 17 routing tests cover all match fields, priority ordering, disabled rules, default fallthrough

### Phase 3 — Auth Layer
- All three providers use `chrome.identity.launchWebAuthFlow()` + PKCE — unified pattern
- Google requires `prompt: 'consent'` + `access_type: 'offline'` to get a refresh_token
- Microsoft may rotate refresh tokens on each refresh — `updateTokens` handles optional refreshToken update
- Dropbox revocation uses a POST to `/2/auth/token/revoke` with Bearer auth (not URL param)
- Microsoft has no simple token revocation endpoint for public clients — we just remove from storage

### Phase 4 — Calendar API
- Google Calendar uses `singleEvents: true` to expand recurring events
- Microsoft Graph uses `/me/calendarView` (not `/me/events`) for expanded recurring events
- Microsoft Graph returns dateTime strings without trailing Z when timezone is separate — `ensureIso()` handles this
- Both providers extract structured conferencing data (Google's `conferenceData`, Microsoft's `onlineMeeting`) before falling back to text parsing

### Phase 5 — Content Scripts
- Content scripts are inherently fragile (both Google Calendar and Outlook are SPAs that change DOM frequently)
- Used multiple fallback selectors ordered by specificity for each target element
- MutationObserver is debounced to 500ms to avoid excessive DOM scanning
- URL change detection via MutationObserver (comparing `location.href`) handles SPA navigation
- Inline styles on the injected button to avoid CSS conflicts with the host page

### Phase 6 — Background Service Worker
- Message types: OPEN_NOTES, GET_UPCOMING_EVENTS, REFRESH_CALENDAR, UPLOAD_NOTE
- Calendar events cached in chrome.storage.local for 5 minutes
- Per-event alarms scheduled on each calendar poll, with configurable reminder offset
- Notification click opens the notes window for that event

### Phase 7 — Notes Window
- Tiptap editor wired with StarterKit, Link, CodeBlock, Placeholder extensions
- Note template auto-generated from CalendarEvent metadata (title, date, attendees, conferencing link, Agenda/Notes/Action Items sections)
- Auto-save drafts to chrome.storage.local every 30s
- Save button shows destination picker with all connected accounts
- Turndown converts HTML → Markdown at save time

### Phase 8 — Upload Modules
- Google Drive uses multipart upload (metadata + content in single request)
- Google Drive folder resolution walks the path and creates missing folders
- OneDrive uses simple PUT to `/me/drive/root:/{path}:/content` (works for files under 4MB)
- Dropbox uses `/2/files/upload` with `Dropbox-API-Arg` header containing metadata as JSON

### Phase 9 — Options Page
- Tab-based layout: Accounts, Routing Rules, General Settings
- ConnectedAccounts shows per-provider account lists with Add/Disconnect
- RoutingRules has full CRUD with a modal editor, priority reorder (up/down arrows), enable/disable toggle
- Initial data load uses `chrome.storage.local.get().then()` with cancellation flag to satisfy React hooks lint rules

### Phase 11 — CWS Prep
- `scripts/package-extension.sh` creates a .zip from dist/ excluding .map files
- `PERMISSIONS.md` justifies every manifest permission
- `privacy-policy.html` is a standalone HTML page ready to be hosted
- `store-assets/README.md` lists required Chrome Web Store images and listing text
