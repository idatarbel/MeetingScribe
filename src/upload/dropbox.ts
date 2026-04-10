/**
 * Dropbox upload module.
 *
 * Uploads meeting notes to Dropbox via the Dropbox HTTP API v2.
 * Uses the /files/upload endpoint for files under 150 MB.
 *
 * API: POST https://content.dropboxapi.com/2/files/upload
 */

import type { ConnectedAccount, SavedDestination } from '@/types';
import { getAccessToken } from '@/auth';
import { binaryStringToBlob, isBinaryMimeType } from '@/utils/binary';

const UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';

/**
 * Upload a file to Dropbox.
 *
 * @param account - The connected Dropbox account to upload to.
 * @param folderPath - The folder path (e.g. "/Meetings/BlackNile").
 * @param fileName - The file name (e.g. "2026-04-10_Standup.md").
 * @param content - The file content (Markdown string).
 * @returns SavedDestination with file metadata.
 */
export async function uploadToDropbox(
  account: ConnectedAccount,
  folderPath: string,
  fileName: string,
  content: string,
  mimeType = 'application/octet-stream',
): Promise<SavedDestination> {
  const accessToken = await getAccessToken(account.id);

  // Normalize path
  const normalizedPath = folderPath.startsWith('/')
    ? folderPath
    : `/${folderPath}`;
  const fullPath = `${normalizedPath}/${fileName}`;

  // Dropbox uses the Dropbox-API-Arg header for metadata, body is the raw file content
  const apiArg = JSON.stringify({
    path: fullPath,
    mode: 'add',           // 'add' = fail if file exists; 'overwrite' = replace
    autorename: true,      // If file exists, auto-rename (e.g. "file (1).md")
    mute: false,           // Show activity in Dropbox notifications
  });

  const response = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArg,
    },
    body: isBinaryMimeType(mimeType ?? 'application/octet-stream')
      ? binaryStringToBlob(content)
      : new TextEncoder().encode(content),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Dropbox upload failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as {
    id: string;
    name: string;
    path_display: string;
    rev: string;
  };

  return {
    provider: 'dropbox',
    accountId: account.id,
    accountEmail: account.email,
    filePath: data.path_display,
    fileId: data.id,
    // Dropbox doesn't return a direct web URL from /files/upload.
    // We'd need a separate /sharing/create_shared_link_with_settings call.
    // For now, construct a best-effort Dropbox web URL.
    fileUrl: `https://www.dropbox.com/home${encodeURI(normalizedPath)}`,
    savedAt: Date.now(),
  };
}
