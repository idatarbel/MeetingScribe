# Learnings Log

<!-- Questions asked by the user and their answers. Maintained by Claude Code. -->

- [X] Q: What's the difference between who owns the Chrome extension (developer identity) and which Google/Microsoft/Dropbox accounts it can save to at runtime?
  A: These are completely independent concepts.
  **(1) Developer/owner identity** — One email that creates the Google Cloud project, Azure app registration, and Dropbox app. Owns the OAuth client credentials. For MeetingScribe this is `danspiegel@gmail.com`, permanently. Think "landlord of the building."
  **(2) End-user account sign-ins** — At runtime, the user clicks "Connect Google Drive" and signs in with ANY Google account. This produces a token stored in `chrome.storage.local`. Can be done multiple times with multiple accounts. Think "tenants in the building — many, and they change."
  The same developer-owned OAuth app can produce tokens for any number of end-user accounts. Dan's `danspiegel@gmail.com` ownership does NOT restrict the extension to only save to `danspiegel@gmail.com`'s Google Drive — it can save to any Google Drive account that signs in at runtime.

- [X] Q: Should the extension support multiple accounts per provider (e.g. two Dropbox accounts, three Google Drive accounts) with a picker at save time?
  A: Yes. The extension supports N accounts per provider. Destination picker at save time lets the user toggle which account + folder to save this particular note to. Routing rules pre-select a default but are overridable. See PROJECT_DECISIONS.md Q7 for architectural implications (token storage shape change, Google auth method switch from `getAuthToken` to `launchWebAuthFlow`, Azure `common` tenant, Dropbox "Full Dropbox" permission, unified calendar source view).

- [X] Q: If I only want to connect one calendar (my `danspiegel@gmail.com` Google Calendar), does the multi-calendar-source design make the UX noisy?
  A: Build multi-source capability, but make the UX collapse gracefully: when only one calendar source is connected, hide "source: X" labels and treat the calendar list as flat. Add "source" labeling only when 2+ calendar accounts are connected. Logged as a Phase 4 / Phase 7 UX requirement in TODO.md.

- [X] Q: Can I add a non-Google email like `sarah.khan@blacknile.ai` to the Google OAuth consent screen's test users list?
  A: No. Google's test user field only accepts email addresses associated with active Google accounts (gmail.com, Google Workspace, or Cloud Identity). This is actually fine and expected — **Google test users only matter for the Google OAuth flow**. A user who will only authenticate via Microsoft (Outlook/OneDrive) or Dropbox never touches Google's consent screen, so they don't need to be in Google's test user list. Sarah Khan is a Microsoft 365 user (`@blacknile.ai` is an M365 tenant), so she'll grant MeetingScribe access via Azure App Registration's consent flow, not Google's. For Google, only list users who will actually click "Sign in with Google" during testing.

- [ ] Q: Why do we need the Chrome Extension OAuth client (Google) and the Azure redirect URI to be deferred until after a Chrome build exists?
  A: *(pending — will answer during the Pass B walk-through after first unpacked build)*
