# MeetingScribe — Project Decisions

> **Purpose:** This file is the durable record of scoping decisions made before scaffolding. A new Claude Code session can read this to pick up exactly where the prior session left off.
>
> **Status:** Phase 1 scaffolding has **NOT** started yet. Six blocking questions were answered on 2026-04-09; the session was closed so the user could rename the repo folder from `ManualMeetingMinutes` to `MeetingScribe`.

---

## Resume Instructions for Next Session

1. User will start a new Claude Code session inside the renamed `MeetingScribe` folder.
2. New session: read this file **first**, then read `TODO.md`.
3. The original spec prompt is long. Ask the user if they want to re-paste it, or work from `TODO.md` + this file as the source of truth.
4. **Next action after confirming:** Phase 5 (OAuth console walk-throughs) was chosen **upfront** — do those walk-throughs BEFORE scaffolding, then proceed to Phase 1.
5. Flag the chicken-and-egg constraint to the user: Google Cloud Console's Chrome Extension OAuth client requires the extension's public key / extension ID, which you only get after at least one unpacked build is loaded in Chrome. Azure's redirect URI requires `chrome.identity.getRedirectURL()` output, also post-build. So the "upfront" walk-throughs will be **partial**: complete everything that doesn't require the extension ID, then pause scaffolding after the first successful unpacked load, circle back to finish Google + Azure, then continue.

---

## Answered Questions (2026-04-09)

### Q1 — Project directory layout
**Decision:** Option **C** — user will rename the repo folder from `ManualMeetingMinutes` to `MeetingScribe` after this session ends. Next session will run inside `MeetingScribe`. Scaffold Vite project directly at the repo root.

### Q2 — Package manager
**Decision:** **npm**. Exclusively. Do not generate `bun.lockb`, `pnpm-lock.yaml`, or `yarn.lock`. Commit only `package-lock.json`.

### Q3 — Markdown export from Tiptap
**Decision:** **turndown** (HTML → Markdown converter). Use `editor.getHTML()` → `turndown.turndown(html)`. One-directional only. Do NOT install `tiptap-markdown`. Re-editing a saved Markdown note will need an HTML round-trip (can be handled later if required; if the save format is Markdown and the file is closed, re-opening the file to edit is out of scope unless user asks).

### Q4 — Tailwind version
**Decision:** **Tailwind v4** (not v3 as the original spec suggested — user explicitly overrode the spec). Use `@tailwindcss/vite` plugin. CSS-first config via `@theme` directive. No `tailwind.config.js`. Caveat to watch for: some Tailwind plugins haven't been updated to v4; if a specific plugin is needed later and isn't v4-compatible, flag it to the user before switching approaches. No known blocking incompatibility with crxjs + Vite 5.

### Q5 — OAuth credentials setup
**Decision:** **Upfront**. Before any scaffolding, the next session should walk the user through Google Cloud Console, Azure App Registration, and Dropbox Developer Console. **IMPORTANT EXCEPTION:** The Chrome Extension OAuth client in Google Cloud and the redirect URI in Azure both require the extension ID / `chrome.identity.getRedirectURL()` output, which only exist after a working unpacked build is loaded in Chrome. The upfront pass should do everything that CAN be done pre-build (create GCP project, enable Calendar + Drive APIs, configure OAuth consent screen metadata, create Azure app registration shell, create Dropbox app shell, copy client IDs / app keys into `.env`), and defer only the post-build steps until the first successful Chrome load.

### Q6 — Vitest installation timing
**Decision:** **Install now (Phase 1)**. Bundle Vitest as a dev dependency in the Phase 1 scaffold so Phase 2 can begin writing tests immediately with no extra install round-trip.

---

## Scoping Addition (2026-04-09, post-Phase-0-kickoff)

### Q7 — Multi-account runtime support
**Decision:** The extension must support **multiple end-user accounts per provider**, connected at runtime, with a **destination picker at save time**. Single developer-owner identity (`danspiegel@gmail.com`) owns the OAuth apps; end-user account sign-ins are independent of developer ownership.

**Implications — deviations from original spec:**
1. **Token storage** changes from `{ google, microsoft, dropbox }` (one token each) to `{ google: ConnectedAccount[], microsoft: ConnectedAccount[], dropbox: ConnectedAccount[] }` where each `ConnectedAccount` carries `{ id, email, displayName, accessToken, refreshToken, expiresAt, scopes }`.
2. **Google auth method** — switch from `chrome.identity.getAuthToken()` to `chrome.identity.launchWebAuthFlow()` + PKCE + refresh tokens. `getAuthToken` is limited to Chrome-profile-signed-in Google accounts; `launchWebAuthFlow` supports ANY Google account. Unifies with Microsoft + Dropbox auth approach.
3. **Microsoft Azure app audience** — `common` endpoint (accepts both personal Microsoft accounts like `@outlook.com`/`@hotmail.com` AND Microsoft 365 work/school accounts like `@blacknile.ai`).
4. **Dropbox app permission type** — "Full Dropbox" access (not "App folder") so the user can save to any folder in any connected Dropbox account.
5. **Calendar sources** — unified multi-source view across all connected Google + Microsoft calendar accounts. UX must remain friendly when only **one** calendar is connected (no noisy "source: X" labels when there's only one source). Currently Dan only plans to connect `danspiegel@gmail.com` Google Calendar for himself; client Sarah Khan will connect `sarah.khan@blacknile.ai` Outlook Calendar. Future users may connect multiple.
6. **Save flow** — destination picker visible at save time, pre-selected by routing rules, overridable before click. Destination = `{ provider, accountId, folderPath }`.
7. **Options page** — "Add account" / list / disconnect per provider instead of single toggle.
8. **Routing rules** — reference a specific `{ provider, accountId, folderPath }` tuple, not just a provider.

**Default destinations Dan will connect at install time (for his personal use):**
- Dropbox: `danspiegel@danspiegelllc.com`
- Google Drive: `danspiegel@gmail.com`
- OneDrive: `dan.spiegel@blacknile.ai`
- Calendar source: `danspiegel@gmail.com` Google Calendar (single)

### Q8 — OAuth consent screen branding
**Decision:**
- App name: `MeetingScribe`
- User support email: `danspiegel@gmail.com`
- Developer contact email: `danspiegel@gmail.com`
- Description: `Take notes on calendar meetings and save them to Google Drive, OneDrive, or Dropbox.`
- **Logo:** `assets/branding/transparent-logo.png` (copied into repo from `C:\Users\dansp\Downloads\Vista Logos\`). SVG + colored variants also copied for flexibility.
- User Type: **External** (required because `gmail.com` is not a Workspace org; enables personal + Workspace users alike)
- Initial distribution: **Testing** mode (up to 100 manual test users); Google OAuth verification deferred until Chrome Web Store publishing.

### Q9 — Azure tenant ownership
**Decision (2026-04-09):** Use existing personal Microsoft account **`danspiegel@hotmail.com`** as the Azure App Registration owner. Personal MSA, not tied to any client, satisfies the "clean developer identity separate from client tenants" criterion. Unblocks Step 2 (Azure) of Phase 0.

### Q10 — Google Cloud project ID
**Decision (2026-04-09):** Project created at `danspiegel@gmail.com` with **Project ID `meetingscribe-492901`**. Use this exact ID wherever GCP resources are referenced.

### Q11 — Google OAuth Web client (Pass A complete)
**Decision (2026-04-09):** OAuth Web application client created on the `meetingscribe-492901` project.
- **Client ID:** `1025955222510-2cd1c2s3f93r26uriv0gtsri0ib5gvjo.apps.googleusercontent.com`
- **Client type:** Web application (chosen because Chrome Extension client type in GCP is a legacy type tied to `chrome.identity.getAuthToken()`, which we're NOT using per Q7 — we're using `launchWebAuthFlow` + PKCE for all three providers)
- **Client name in console:** `MeetingScribe Dev (Web)`
- **Redirect URIs:** none yet — Pass B will add `https://<extension-id>.chromiumapp.org/` once the extension ID exists after first unpacked Chrome build
- **Scopes (configured on Data Access page):** `openid`, `email`, `profile`, `https://www.googleapis.com/auth/calendar.readonly` (sensitive), `https://www.googleapis.com/auth/drive.file` (non-sensitive)
- **Publishing status:** Testing (limited to manually-added test users; up to 100)
- **Test users (Google-only; Microsoft/Dropbox users don't need to be here):** `danspiegel@gmail.com`. Sarah Khan (`@blacknile.ai`) cannot be added here — `@blacknile.ai` is an M365 tenant, not Google — she authenticates via Microsoft Graph, not Google OAuth.
- **Client secret:** stored in `.env` locally (gitignored), NOT in the repo or PROJECT_DECISIONS.md.
- **`.env.example`** written with VITE_GOOGLE_CLIENT_ID pre-populated and scope list; `.env` file creation deferred to Phase 1 scaffolding.
- **`.gitignore`** created to exclude `.env` + standard Node/build/editor artifacts.

**Google Pass A: COMPLETE.** Next: Step 2 — Azure App Registration.

### Q12 — Azure App Registration
**Decision (2026-04-09):** App Registration created under `danspiegel@hotmail.com` personal MSA.
- **Application (client) ID:** `3d88242c-3d5b-47d8-b3c6-21f937815e47`
- **Directory (tenant) ID (dev):** `2fa7943d-2a26-4271-b070-136002c7cd57` (personal MSA default tenant — logged for reference, NOT used at runtime)
- **Runtime tenant:** `common` — allows both personal MS accounts (Outlook.com/Hotmail) AND work/school accounts (M365 like `@blacknile.ai`). This is the key decision that lets Sarah Khan authenticate through the same one app registration as Dan.
- **Supported account types (Azure label):** "All Microsoft account users" = Multitenant + personal MSA
- **Client credentials:** ZERO — MeetingScribe is a public client (Chrome extension can't safely store secrets). We use PKCE in Phase 3 instead.
- **Redirect URI / platform:** NONE in Pass A. Pass B will add a **Single-page application** platform with redirect URI `https://<extension-id>.chromiumapp.org/` once the extension ID exists.
- **API permissions (all Microsoft Graph, all Delegated):** `User.Read`, `Calendars.Read`, `Files.ReadWrite`, `offline_access`, `openid`, `profile`, `email`. All show "Admin consent required: No" — personal MSA users self-consent at sign-in. "Grant admin consent for Default Directory" was NOT clicked (correctly — no-op since real end users sign in from outside the dev tenant).
- **Authentication blade / Platform configuration:** NONE in Pass A. In Pass B, add a **Single-page application** platform with redirect URI `https://<extension-id>.chromiumapp.org/`. Do NOT enable "Allow public client flows" — it's for device-code / native desktop flows, not SPA+PKCE.
- VITE_MICROSOFT_CLIENT_ID populated in `.env.example`.

**Azure Pass A: COMPLETE.** Next: Step 3 — Dropbox Developer Console.

### Q13 — Dropbox app
**Decision (2026-04-09):** Dropbox app created under `danspiegel@danspiegelllc.com` (Dropbox Business individual ownership, no team-admin approval path).
- **App name:** `MeetingScribe`
- **App key:** `fes0gua5thykct3` (populated in `.env.example` as `VITE_DROPBOX_APP_KEY`)
- **App secret:** stored in password manager only, NEVER in repo or PROJECT_DECISIONS.md
- **Permission type (Dropbox's label):** Scoped App (not a typo — "Scoped App" is Dropbox's name for the modern granular-scope model vs deprecated legacy API; orthogonal to Full Dropbox vs App folder)
- **Access type:** Full Dropbox (chosen at creation, permanent, not displayed in UI post-create)
- **OAuth 2 settings:** Allow public clients (Implicit Grant & PKCE) = **Allow** (Dropbox bundles implicit grant + PKCE in one toggle; our code will only use PKCE, never implicit grant). Redirect URIs blank (deferred to Pass B). Implicit grant is technically allowed by config but unused in code.
- **6 Scopes (all "Individual" scopes, no Team scopes):**
  - `account_info.read` — get user email/display name
  - `files.metadata.read` — list folders/files (folder picker)
  - `files.metadata.write` — create folders (folder picker)
  - `files.content.read` — future-proofing for overwrite checks / re-open
  - `files.content.write` — upload meeting notes (core use case)
  - `sharing.write` — post-save "copy share link" feature
- **Development mode:** Dropbox apps start in "Development" mode where only the owner and manually-invited users can connect. Production approval deferred until broad distribution (analogous to Google OAuth verification and Chrome Web Store listing).

**Dropbox Pass A: COMPLETE.**

---

## Phase 0 Pass A — ALL THREE PROVIDERS COMPLETE (2026-04-09)

| Provider | Developer Identity | Client/App ID | Scopes | Pass B TODO |
|---|---|---|---|---|
| Google | `danspiegel@gmail.com` | `1025955222510-2cd1c2s3f93r26uriv0gtsri0ib5gvjo.apps.googleusercontent.com` | `openid email profile calendar.readonly drive.file` | Add `https://<ext-id>.chromiumapp.org/` as Authorized redirect URI on the Web client |
| Microsoft | `danspiegel@hotmail.com` | `3d88242c-3d5b-47d8-b3c6-21f937815e47` | 7 delegated Microsoft Graph (Calendars.Read, Files.ReadWrite, offline_access, User.Read, openid, profile, email) | Add Single-page application platform with redirect URI `https://<ext-id>.chromiumapp.org/` |
| Dropbox | `danspiegel@danspiegelllc.com` | app key `fes0gua5thykct3` | 6 individual scopes (account_info.read, files.{metadata,content}.{read,write}, sharing.write) | Add `https://<ext-id>.chromiumapp.org/` to Redirect URIs in OAuth 2 section |

**Next action:** Phase 1 scaffolding — Vite + crxjs + React 18 + TS + Tailwind v4 + ESLint + Prettier + Vitest + minimal MV3 manifest. First successful build. Load unpacked in Chrome. Capture extension ID. Return to Pass B to finish redirect URIs.

---

## Phase 0 Pass B — COMPLETE (2026-04-10)

**Extension ID:** `fcjkeemghkfclpogdoblpoghakfagabk` (from first unpacked Chrome load of `dist/`)

**Redirect URI added to all three providers:**
```
https://fcjkeemghkfclpogdoblpoghakfagabk.chromiumapp.org/
```

| Provider | Where added | Platform type |
|---|---|---|
| Google | OAuth Web client → Authorized redirect URIs | Web application (supports SPA/PKCE flows) |
| Microsoft | Authentication (Preview) blade → Redirect URI configuration | Single-page application (SPA) |
| Dropbox | Settings → OAuth 2 → Redirect URIs | N/A (Dropbox doesn't distinguish platform types) |

**Phase 0: FULLY COMPLETE.** All OAuth infrastructure is in place. Phase 3 (Auth layer code) can now implement the real `chrome.identity.launchWebAuthFlow()` flows against these live credentials.

---

## Phase 1 Scaffold — COMPLETE (2026-04-10)

**Build system:** Vite 5 + @crxjs/vite-plugin 2.4 + React 18 + TypeScript 5 (strict) + Tailwind v4 (CSS-first via @tailwindcss/vite) + ESLint 9 + Prettier 3 + Vitest 2
**Package manager:** npm only (package-lock.json)
**Manifest:** MV3, minimum Chrome 116, permissions: identity/storage/alarms/notifications, host_permissions for Google/Microsoft/Dropbox API domains, content scripts for Google Calendar + Outlook Web
**Extension pages:** popup (working), options (working), notes (bundled, placeholder), background service worker (registered)
**Tests:** 2 smoke tests passing (Vitest + @testing-library/react)
**Icons:** Placeholder blue squares (16/32/48/128px), to be replaced in Phase 11
**React version:** 18.3 (not 19 — crxjs stability concern)

### Key decisions made during Phase 1
- **Q14 — React 18 over 19:** Per recommendation, crxjs + React 19 has hydration quirks.
- **Q15 — Icons:** Placeholder solid-color PNGs. Real branded icons deferred to Phase 11.
- **Q16 — Min Chrome version:** 116
- **Q17 — Google auth method (code-level):** `chrome.identity.launchWebAuthFlow()` for ALL providers (not `getAuthToken`). Single OAuth client type = Web application. No legacy "Chrome Extension" client type needed.

---

## Recommendations NOT Taken (context for future decisions)

- Q3: Claude recommended `tiptap-markdown` (two-way) + `turndown` (fallback). User chose `turndown` only.
- Q4: Claude recommended sticking with v3 per the spec. User overrode to v4.
- Q5: Claude recommended deferring OAuth work. User chose upfront.

---

## Environment Confirmed

- Node.js: **v20.20.0** (>= 18 required — ✅)
- npm: **10.8.2**
- Git: repo initialized, `main` branch, clean working tree (1 commit: `d98ccca Initial commit`)
- Claude Code version: 2.1.76
- Remote Control: **disabled at account level** (server-side feature flag; local `policy-limits.json` was already adjusted to `allow_remote_control: true`). Skipped for this project — not blocking.

---

## Files Created in This Session

- `.audit-state` — set to `active` (TODO.md auditing on)
- `TODO.md` — task log with Task #1 (Build MeetingScribe) and sub-phases 1a–1l
- `learnings.md` — empty header (no Q&A logged yet)
- `PROJECT_DECISIONS.md` — this file

No code, no scaffolding, no `package.json`, no `manifest.json`. Phase 1 is still `[In Progress]` on TODO.md but the actual work hasn't started.
