/**
 * Download calendar event attachments and upload them to the destination folder.
 *
 * Google Calendar attachments are Google Drive files — downloaded via Drive API.
 * Outlook attachments are fetched via Graph API inline content.
 */

import type { EventAttachment, ConnectedAccount } from '@/types';
import { getAccessToken, loadAccounts } from '@/auth';
import { binaryStringToBlob } from '@/utils/binary';

/**
 * Download an attachment and return its content as a Blob.
 */
export async function downloadAttachment(
  attachment: EventAttachment,
  calendarProvider: 'google' | 'microsoft',
): Promise<Blob | null> {
  try {
    if (calendarProvider === 'google') {
      return downloadGoogleDriveFile(attachment);
    }
    if (calendarProvider === 'microsoft' && attachment.contentBase64) {
      return binaryStringToBlob(atob(attachment.contentBase64), attachment.mimeType);
    }
    return null;
  } catch (err) {
    console.error(`[MeetingScribe] Failed to download attachment "${attachment.title}":`, err);
    return null;
  }
}

/**
 * Download a file from Google Drive by fileId.
 * Uses the calendar account's access token (same account that has Drive scope).
 */
async function downloadGoogleDriveFile(attachment: EventAttachment): Promise<Blob | null> {
  if (!attachment.fileId) return null;

  // Find a Google account with Drive scope
  const store = await loadAccounts();
  const googleAccount = store.google.find((a) =>
    a.scopes.some((s) => s.includes('drive')),
  );
  if (!googleAccount) {
    console.warn('[MeetingScribe] No Google account with Drive scope for attachment download');
    return null;
  }

  const accessToken = await getAccessToken(googleAccount.id);
  const url = `https://www.googleapis.com/drive/v3/files/${attachment.fileId}?alt=media`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.error(`[MeetingScribe] Drive download failed (${response.status}) for ${attachment.title}`);
    return null;
  }

  return response.blob();
}

/**
 * Upload a Blob to a destination folder.
 * Handles all three providers.
 */
export async function uploadAttachmentBlob(
  blob: Blob,
  fileName: string,
  destAccount: ConnectedAccount,
  folderPath: string,
  driveId?: string,
  _folderId?: string,
): Promise<void> {
  const accessToken = await getAccessToken(destAccount.id);

  switch (destAccount.provider) {
    case 'google':
      await uploadBlobToGoogleDrive(accessToken, blob, fileName, folderPath);
      break;
    case 'microsoft':
      await uploadBlobToOneDrive(accessToken, blob, fileName, folderPath, driveId);
      break;
    case 'dropbox':
      await uploadBlobToDropbox(accessToken, blob, fileName, folderPath);
      break;
  }
}

async function uploadBlobToGoogleDrive(
  accessToken: string,
  blob: Blob,
  fileName: string,
  folderPath: string,
): Promise<void> {
  // Resolve folder
  const folderId = await resolveGoogleFolder(accessToken, folderPath);

  // Simple media upload
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: fileName, parents: [folderId] }),
  });
  if (!createResp.ok) throw new Error(`Create file failed: ${createResp.status}`);
  const created = (await createResp.json()) as { id: string };

  const uploadResp = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': blob.type || 'application/octet-stream',
      },
      body: blob,
    },
  );
  if (!uploadResp.ok) throw new Error(`Upload content failed: ${uploadResp.status}`);
}

async function resolveGoogleFolder(accessToken: string, path: string): Promise<string> {
  const parts = path.split('/').filter((p) => p.length > 0);
  let parentId = 'root';
  for (const name of parts) {
    const q = encodeURIComponent(
      `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    );
    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!resp.ok) break;
    const data = (await resp.json()) as { files?: Array<{ id: string }> };
    const found = data.files?.[0]?.id;
    if (found) {
      parentId = found;
    } else {
      // Create the folder
      const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        }),
      });
      if (!createResp.ok) break;
      const created = (await createResp.json()) as { id: string };
      parentId = created.id;
    }
  }
  return parentId;
}

async function uploadBlobToOneDrive(
  accessToken: string,
  blob: Blob,
  fileName: string,
  folderPath: string,
  driveId?: string,
): Promise<void> {
  const cleanPath = folderPath.replace(/^\/+/, '');
  const url = driveId
    ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURI(cleanPath)}/${encodeURIComponent(fileName)}:/content`
    : `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURI(cleanPath)}/${encodeURIComponent(fileName)}:/content`;

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': blob.type || 'application/octet-stream',
    },
    body: blob,
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OneDrive attachment upload failed (${resp.status}): ${body}`);
  }
}

async function uploadBlobToDropbox(
  accessToken: string,
  blob: Blob,
  fileName: string,
  folderPath: string,
): Promise<void> {
  const fullPath = folderPath.startsWith('/')
    ? `${folderPath}/${fileName}`
    : `/${folderPath}/${fileName}`;

  const resp = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path: fullPath,
        mode: 'add',
        autorename: true,
        mute: false,
      }),
    },
    body: blob,
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Dropbox attachment upload failed (${resp.status}): ${body}`);
  }
}
