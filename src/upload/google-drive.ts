/**
 * Google Drive upload module.
 *
 * Uploads meeting notes as a file to Google Drive using the Files v3 API
 * with multipart upload (metadata + content in a single request).
 *
 * API: POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
 */

import type { ConnectedAccount, SavedDestination } from '@/types';
import { getAccessToken } from '@/auth';
import { binaryStringToBlob, isBinaryMimeType } from '@/utils/binary';

const DRIVE_UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

/**
 * Upload a file to Google Drive.
 *
 * @param account - The connected Google account to upload to.
 * @param folderPath - The folder path (e.g. "/Meetings/BlackNile").
 * @param fileName - The file name (e.g. "2026-04-10_Standup.md").
 * @param content - The file content (Markdown string).
 * @param mimeType - MIME type of the content (default: text/markdown).
 * @returns SavedDestination with file ID and URL.
 */
export async function uploadToGoogleDrive(
  account: ConnectedAccount,
  folderPath: string,
  fileName: string,
  content: string,
  mimeType = 'text/markdown',
): Promise<SavedDestination> {
  const accessToken = await getAccessToken(account.id);

  // Resolve (or create) the folder path
  const folderId = await resolveOrCreateFolder(accessToken, folderPath);

  let response: Response;

  if (isBinaryMimeType(mimeType)) {
    // For binary content: two-step upload — create metadata first, then upload content
    // Step 1: Create empty file with metadata
    const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: fileName,
        mimeType,
        parents: [folderId],
      }),
    });

    if (!createResponse.ok) {
      const errorBody = await createResponse.text();
      throw new Error(`Google Drive file create failed (${createResponse.status}): ${errorBody}`);
    }

    const created = (await createResponse.json()) as { id: string };

    // Step 2: Upload content to the created file
    const binaryBody = binaryStringToBlob(content);
    response = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': mimeType,
        },
        body: binaryBody,
      },
    );
  } else {
    // For text content: single multipart upload
    const boundary = `meetingscribe-${Date.now()}`;
    const metadata = {
      name: fileName,
      mimeType,
      parents: [folderId],
    };

    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');

    response = await fetch(DRIVE_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Drive upload failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as {
    id: string;
    name: string;
    webViewLink?: string;
  };

  return {
    provider: 'google',
    accountId: account.id,
    accountEmail: account.email,
    filePath: `${folderPath}/${fileName}`,
    fileId: data.id,
    fileUrl: data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`,
    savedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Folder resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a folder path like "/Meetings/BlackNile" to a Drive folder ID.
 * Creates missing folders along the path.
 */
async function resolveOrCreateFolder(
  accessToken: string,
  path: string,
): Promise<string> {
  const parts = path.split('/').filter((p) => p.length > 0);
  let parentId = 'root';

  for (const folderName of parts) {
    const existing = await findFolder(accessToken, folderName, parentId);
    if (existing) {
      parentId = existing;
    } else {
      parentId = await createFolder(accessToken, folderName, parentId);
    }
  }

  return parentId;
}

async function findFolder(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { files?: Array<{ id: string }> };
  return data.files?.[0]?.id ?? null;
}

async function createFolder(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<string> {
  const response = await fetch('https://www.googleapis.com/drive/v3/files', {
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

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to create Google Drive folder "${name}" (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}
