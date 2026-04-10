# MeetingScribe

A Chrome extension that lets you take rich-text notes on calendar meetings and automatically save them to Google Drive, OneDrive, or Dropbox.

## Features

- **Multi-calendar support** — Connect Google Calendar and Microsoft Outlook (personal + business) accounts. Events from all connected calendars appear in a unified timeline.
- **Multi-account storage** — Connect multiple Google Drive, OneDrive, and Dropbox accounts. Choose where to save each note at save time, or let routing rules decide automatically.
- **Rich-text editor** — Tiptap-powered editor with bold, italic, headings, lists, code blocks, links, and horizontal rules.
- **Auto-generated note template** — Opening notes for a meeting pre-fills the title, date, attendees, conferencing link, and empty sections for Agenda, Notes, and Action Items.
- **Routing rules** — Configure rules like "meetings with sarah.khan@blacknile.ai → save to OneDrive /BlackNile/Meetings". Rules are evaluated in priority order; the first match wins.
- **Auto-save drafts** — Notes are auto-saved to `chrome.storage.local` every 30 seconds (configurable). Never lose work.
- **Meeting reminders** — Get a Chrome notification before meetings start with a one-click "Take Notes" action.
- **Content script injection** — A "Take Notes" button appears directly inside Google Calendar and Outlook Web when viewing event details.
- **Markdown export** — Notes are saved as Markdown files (via Turndown) by default, with HTML as an option.

## Prerequisites

- **Node.js** >= 18 (tested on v20.20.0)
- **npm** (no yarn/pnpm/bun — `package-lock.json` only)
- **Chrome** >= 116

## Setup

### 1. Clone and install

```bash
git clone https://github.com/idatarbel/MeetingScribe.git
cd MeetingScribe
npm install
```

### 2. Create `.env` from template

```bash
cp .env.example .env
```

The `.env.example` file has all three OAuth client IDs pre-populated. You only need to fill in secrets (if applicable — PKCE public clients may not need them).

### 3. Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) → project `meetingscribe-492901`.
2. APIs enabled: **Google Calendar API**, **Google Drive API**.
3. OAuth consent screen: **External**, **Testing** mode. Test users must be manually added.
4. OAuth client: **Web application** type, named `MeetingScribe Dev (Web)`.
5. Redirect URI: `https://<your-extension-id>.chromiumapp.org/`
6. Scopes: `openid email profile calendar.readonly drive.file`

### 4. Azure App Registration

1. Open [Azure Portal](https://portal.azure.com/) → App registrations → `MeetingScribe`.
2. Supported account types: **All Microsoft account users** (multitenant + personal).
3. Platform: **Single-page application (SPA)**.
4. Redirect URI: `https://<your-extension-id>.chromiumapp.org/`
5. API permissions (Delegated): `User.Read`, `Calendars.Read`, `Files.ReadWrite`, `offline_access`, `openid`, `profile`, `email`.
6. No client secret — uses PKCE.

### 5. Dropbox Developer Console

1. Open [Dropbox Developer Apps](https://www.dropbox.com/developers/apps) → `MeetingScribe`.
2. Permission type: **Scoped App**, Access type: **Full Dropbox**.
3. Redirect URI: `https://<your-extension-id>.chromiumapp.org/`
4. Scopes: `account_info.read`, `files.metadata.read`, `files.metadata.write`, `files.content.read`, `files.content.write`, `sharing.write`.

### 6. Build and load

```bash
npm run build
```

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** → select the `dist/` folder.
4. Pin MeetingScribe to the toolbar.

### 7. Update redirect URIs (first time only)

After loading the extension, note the **Extension ID** from `chrome://extensions/`. Update the redirect URI in all three consoles:

```
https://<extension-id>.chromiumapp.org/
```

## Development

```bash
npm run dev          # Vite dev server with HMR
npm run build        # Production build to dist/
npm run test         # Run Vitest (single run)
npm run test:watch   # Vitest in watch mode
npm run lint         # ESLint
npm run lint:fix     # ESLint with auto-fix
npm run format       # Prettier format
npm run typecheck    # TypeScript type check (no emit)
```

## Architecture

```
src/
├── auth/              # OAuth + PKCE for Google, Microsoft, Dropbox
│   ├── providers/     # Provider-specific OAuth flows
│   ├── pkce.ts        # PKCE code verifier/challenge generation
│   ├── storage.ts     # ConnectedAccount storage layer
│   └── index.ts       # Unified auth API
├── background/        # Chrome service worker (message handler, alarms, notifications)
├── calendar/          # Google Calendar + Microsoft Graph event fetching
├── content/           # Content scripts (gcal.ts, outlook.ts) with MutationObserver
├── notes/             # Notes window React app (Tiptap editor, save, auto-save)
├── options/           # Options page React app (accounts, routing rules, settings)
├── popup/             # Browser action popup
├── routing/           # Routing engine (match events to save destinations)
├── styles/            # Tailwind CSS with @theme brand tokens
├── types/             # TypeScript type definitions (single source of truth)
├── upload/            # Upload modules (Google Drive, OneDrive, Dropbox)
└── utils/             # strip-dialin, note-template
```

## Tech Stack

- **React 18** + **TypeScript 5** (strict mode)
- **Vite 5** + **@crxjs/vite-plugin** (Chrome Extension bundling)
- **Tailwind CSS v4** (CSS-first config via `@tailwindcss/vite`)
- **Tiptap v2** (rich-text editor)
- **Turndown** (HTML → Markdown)
- **Vitest** (testing)
- **ESLint 9** + **Prettier 3**
- **Manifest V3** (Chrome Extension)

## License

UNLICENSED — private project.
