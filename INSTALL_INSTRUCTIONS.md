# MeetingScribe — Installation Instructions

## What is MeetingScribe?

MeetingScribe is a Chrome browser extension that lets you take meeting notes directly from Google Calendar or Outlook Web. Notes are saved to your cloud storage (Google Drive, OneDrive, or Dropbox) as Word documents (.docx).

---

## Step 1: Install the Extension

1. **Unzip** `MeetingScribe-install.zip` to a folder on your computer (e.g., `C:\MeetingScribe` or `~/MeetingScribe`). Remember where you put it.

2. Open **Google Chrome** and go to: `chrome://extensions/`

3. Turn on **Developer mode** (toggle in the top-right corner)

4. Click **"Load unpacked"**

5. Navigate to the folder where you unzipped the files and select it. Choose the folder that contains `manifest.json` directly (if you see a `dist` subfolder, select `dist`).

6. MeetingScribe should now appear in your extensions list with a blue square icon.

7. Click the **puzzle piece** icon in Chrome's toolbar → click the **pin** icon next to MeetingScribe to keep it visible.

---

## Step 2: Connect Your Accounts

1. **Right-click** the MeetingScribe icon in Chrome's toolbar → click **Options** (or click the icon → the popup → look for a settings link).

2. On the **Accounts** tab, connect the accounts you want to use:

### Google Account (for Google Calendar + Google Drive)
- Click **"Add Google account"**
- Sign in with your Google account
- Grant the requested permissions (Calendar read, Drive access)
- **Note:** You must be added as a test user by the extension owner (Dan Spiegel) before you can connect. If you see "This app isn't verified" or "Access blocked," contact Dan to add your email as a test user.

### Microsoft Account (for Outlook Calendar + OneDrive)
- Click **"Add Microsoft account"**
- Sign in with your Microsoft work/school account (e.g., `you@company.com`) or personal account
- Grant the requested permissions (Calendar read, OneDrive write)

### Dropbox Account
- Click **"Add Dropbox account"**
- Sign in with your Dropbox account
- Grant the requested permissions

You can connect **multiple accounts** of each type.

---

## Step 3: Set Up Routing Rules (Optional)

Routing rules tell MeetingScribe where to save notes automatically.

1. Go to **Options → Routing Rules** tab
2. Click **"+ Add Rule"**
3. Set a title match (e.g., "Black Nile" to match all Black Nile meetings)
4. Choose the destination account and browse to a folder using the folder picker
5. Click **Save Rule**

When you open Take Notes on a matching meeting, the destination will be pre-selected.

---

## Step 4: Taking Notes

### From Google Calendar:
1. Open [Google Calendar](https://calendar.google.com) in Chrome
2. Click on any meeting/event
3. Look for the blue **"📝 Take Notes"** button in the event popup
4. Click it — a notes window opens with meeting details pre-filled
5. Type your notes in the Agenda / Notes / Action Items sections
6. Choose your save destination and click **Save**

### From Outlook Web:
1. Open [Outlook Calendar](https://outlook.office.com/calendar) in Chrome (or `outlook.cloud.microsoft`)
2. Click on any meeting/event
3. Look for the blue **"📝 Take Notes"** button (appears at the top of the screen)
4. Click it — same notes window opens
5. Type your notes and Save

---

## What Gets Saved

When you click Save, MeetingScribe creates a folder for each meeting containing:

- **`.docx` file** — The meeting minutes document (opens in Word, Word Online, or Google Docs)
- **`.lock` file** — MeetingScribe's internal file for round-tripping content. **Do not edit or delete this file.** It allows MeetingScribe to reload your notes when you re-open the meeting.

If the meeting has attachments, those are also saved to the same folder.

---

## Troubleshooting

### "This app isn't verified" when connecting Google
Contact Dan Spiegel to add your Google email as a test user in the Google Cloud Console.

### Take Notes button doesn't appear
- Make sure you **reloaded the calendar page** (F5) after installing the extension
- The button only appears when you click on an event to open its detail popup

### "Extension context invalidated" error
The extension was updated since the page was loaded. Press F5 to reload the page.

### Notes from one meeting show up in another
Go to **Options → General → Clear All Drafts**, then try again.

---

## Important Notes

- MeetingScribe has **no backend server**. All data flows directly between your browser and your cloud storage providers.
- **No analytics or tracking** — nothing is collected or sent anywhere.
- OAuth tokens are stored locally in Chrome's extension storage on your machine.
- The `.docx` template can be customized in **Options → Doc Template**.
- The notes template (Agenda/Notes/Action Items) can be customized in **Options → Notes Template**.
