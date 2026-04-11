/**
 * Cloud-based meeting notes persistence.
 *
 * On open: check the destination folder for an existing .md file and load it.
 * On save: write both .md (editable source) and .docx (presentation copy),
 *          overwriting if files already exist.
 *
 * File naming convention (consistent across attendees):
 *   {YYYY-MM-DD HHmm} - Meeting Minutes - {title}.md
 *   {YYYY-MM-DD HHmm} - Meeting Minutes - {title}.docx
 *
 * Multiple attendees saving to the same folder will overwrite the same files.
 * Last save wins. On re-open, the latest cloud version is loaded.
 */

import type { ConnectedAccount } from '@/types';
import { getAccessToken } from '@/auth';
// Cloud note loading utilities — no binary conversion needed (loading .md text files)

// ---------------------------------------------------------------------------
// Find existing notes file in a cloud folder
// ---------------------------------------------------------------------------

/**
 * Search for an existing .md meeting notes file in the destination folder.
 * Returns the file content as a string if found, null if not.
 */
export async function loadExistingNotes(
  account: ConnectedAccount,
  folderPath: string,
  meetingBaseName: string,
  driveId?: string,
): Promise<string | null> {
  const mdFileName = `${meetingBaseName}.md`;

  switch (account.provider) {
    case 'google':
      return loadFromGoogleDrive(account, folderPath, mdFileName);
    case 'microsoft':
      return loadFromOneDrive(account, folderPath, mdFileName, driveId);
    case 'dropbox':
      return loadFromDropbox(account, folderPath, mdFileName);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Google Drive
// ---------------------------------------------------------------------------

async function loadFromGoogleDrive(
  account: ConnectedAccount,
  folderPath: string,
  fileName: string,
): Promise<string | null> {
  try {
    const accessToken = await getAccessToken(account.id);

    // Resolve the folder to find the file
    console.log(`[MeetingScribe] Google Drive: resolving folder "${folderPath}"`);
    const folderId = await resolveGoogleFolder(accessToken, folderPath);
    if (!folderId) {
      console.log('[MeetingScribe] Google Drive: folder not found');
      return null;
    }
    console.log(`[MeetingScribe] Google Drive: folder resolved to ${folderId}`);

    // Search for the file by name — escape single quotes in filename
    const escapedName = fileName.replace(/'/g, "\\'");
    const q = encodeURIComponent(
      `name='${escapedName}' and '${folderId}' in parents and trashed=false`,
    );
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`;
    const searchResp = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!searchResp.ok) {
      console.log(`[MeetingScribe] Google Drive: file search failed (${searchResp.status})`);
      return null;
    }

    const searchData = (await searchResp.json()) as { files?: Array<{ id: string }> };
    const fileId = searchData.files?.[0]?.id;
    if (!fileId) return null;

    // Download the file content
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const downloadResp = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!downloadResp.ok) return null;

    return downloadResp.text();
  } catch (err) {
    console.error('[MeetingScribe] Failed to load from Google Drive:', err);
    return null;
  }
}

async function resolveGoogleFolder(accessToken: string, path: string): Promise<string | null> {
  const parts = path.split('/').filter((p) => p.length > 0);
  let parentId = 'root';
  for (const name of parts) {
    const escapedName = name.replace(/'/g, "\\'");
    const q = encodeURIComponent(
      `name='${escapedName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    );
    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!resp.ok) {
      console.log(`[MeetingScribe] Google Drive: folder lookup failed for "${name}" (${resp.status})`);
      return null;
    }
    const data = (await resp.json()) as { files?: Array<{ id: string }> };
    const found = data.files?.[0]?.id;
    if (!found) {
      console.log(`[MeetingScribe] Google Drive: folder "${name}" not found in parent ${parentId}`);
      return null;
    }
    parentId = found;
  }
  return parentId;
}

// ---------------------------------------------------------------------------
// OneDrive
// ---------------------------------------------------------------------------

async function loadFromOneDrive(
  account: ConnectedAccount,
  folderPath: string,
  fileName: string,
  driveId?: string,
): Promise<string | null> {
  try {
    const accessToken = await getAccessToken(account.id);
    const cleanPath = folderPath.replace(/^\/+/, '');
    const encodedPath = encodeURI(`${cleanPath}/${fileName}`);

    const url = driveId
      ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedPath}:/content`
      : `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/content`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (resp.status === 404) return null; // file doesn't exist yet
    if (!resp.ok) return null;

    return resp.text();
  } catch (err) {
    console.error('[MeetingScribe] Failed to load from OneDrive:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dropbox
// ---------------------------------------------------------------------------

async function loadFromDropbox(
  account: ConnectedAccount,
  folderPath: string,
  fileName: string,
): Promise<string | null> {
  try {
    const accessToken = await getAccessToken(account.id);
    const fullPath = folderPath.startsWith('/')
      ? `${folderPath}/${fileName}`
      : `/${folderPath}/${fileName}`;

    const resp = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: fullPath }),
      },
    });

    if (resp.status === 409) return null; // file not found
    if (!resp.ok) return null;

    return resp.text();
  } catch (err) {
    console.error('[MeetingScribe] Failed to load from Dropbox:', err);
    return null;
  }
}
