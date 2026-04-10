/**
 * OneDrive upload module.
 *
 * Uploads meeting notes to OneDrive via Microsoft Graph API.
 * Supports both the user's own drive and shared drives (Shared with me).
 * Uses the simple PUT endpoint for files under 4 MB.
 */

import type { ConnectedAccount, SavedDestination } from '@/types';
import { getAccessToken } from '@/auth';
import { binaryStringToBlob, isBinaryMimeType } from '@/utils/binary';

/**
 * Upload a file to OneDrive.
 *
 * @param account - The connected Microsoft account to upload to.
 * @param folderPath - The folder path (e.g. "/Meetings/BlackNile" or "/Shared with me/Documents/CoalOpt").
 * @param fileName - The file name.
 * @param content - The file content (Markdown string).
 * @param mimeType - MIME type (default: text/markdown).
 * @param driveId - If uploading to a shared drive, the drive ID. Otherwise uses user's own drive.
 * @param folderId - If uploading to a specific folder by ID (for shared items), the folder item ID.
 * @returns SavedDestination with file ID and URL.
 */
export async function uploadToOneDrive(
  account: ConnectedAccount,
  folderPath: string,
  fileName: string,
  content: string,
  mimeType = 'text/markdown',
  driveId?: string,
  _folderId?: string,
): Promise<SavedDestination> {
  const accessToken = await getAccessToken(account.id);
  const fullPath = `${folderPath}/${fileName}`;

  let url: string;

  if (driveId) {
    // Shared/remote drive — always use path-based upload.
    // This ensures subfolders (like meeting-name folders) are auto-created.
    // OneDrive's PUT-by-path auto-creates intermediate folders.
    const cleanPath = folderPath.replace(/^\/+/, '');
    url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURI(cleanPath)}/${encodeURIComponent(fileName)}:/content`;
  } else {
    // Upload to user's own drive by path
    const normalizedPath = folderPath.startsWith('/')
      ? folderPath
      : `/${folderPath}`;
    url = `https://graph.microsoft.com/v1.0/me/drive/root:${encodeURI(normalizedPath)}/${encodeURIComponent(fileName)}:/content`;
  }

  // For binary content (e.g., .docx), convert binary string to Uint8Array
  const body = isBinaryMimeType(mimeType)
    ? binaryStringToBlob(content)
    : content;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OneDrive upload failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as {
    id: string;
    name: string;
    webUrl?: string;
  };

  return {
    provider: 'microsoft',
    accountId: account.id,
    accountEmail: account.email,
    filePath: fullPath,
    fileId: data.id,
    fileUrl: data.webUrl,
    savedAt: Date.now(),
  };
}
