/**
 * MeetingScribe — Unified Upload API
 *
 * Routes upload requests to the correct provider-specific module based
 * on the ConnectedAccount's provider field.
 */

import type { ConnectedAccount, OAuthProvider, SavedDestination } from '@/types';
import { findAccount } from '@/auth';
import { uploadToGoogleDrive } from './google-drive';
import { uploadToOneDrive } from './onedrive';
import { uploadToDropbox } from './dropbox';

export { uploadToGoogleDrive } from './google-drive';
export { uploadToOneDrive } from './onedrive';
export { uploadToDropbox } from './dropbox';

/**
 * Upload a note to the specified account's cloud storage.
 *
 * @param accountId - The ConnectedAccount.id to upload to.
 * @param folderPath - Destination folder path.
 * @param fileName - File name.
 * @param content - File content (Markdown or HTML).
 * @param mimeType - MIME type (default: text/markdown).
 */
export async function uploadNote(
  accountId: string,
  folderPath: string,
  fileName: string,
  content: string,
  mimeType = 'text/markdown',
  driveId?: string,
  folderId?: string,
): Promise<SavedDestination> {
  const account = await findAccount(accountId);
  if (!account) {
    throw new Error(
      `Account ${accountId} not found. Has it been disconnected?`,
    );
  }

  return uploadToProvider(account, folderPath, fileName, content, mimeType, driveId, folderId);
}

/**
 * Upload using the correct provider module.
 */
async function uploadToProvider(
  account: ConnectedAccount,
  folderPath: string,
  fileName: string,
  content: string,
  mimeType: string,
  driveId?: string,
  folderId?: string,
): Promise<SavedDestination> {
  switch (account.provider) {
    case 'google':
      return uploadToGoogleDrive(account, folderPath, fileName, content, mimeType);
    case 'microsoft':
      return uploadToOneDrive(account, folderPath, fileName, content, mimeType, driveId, folderId);
    case 'dropbox':
      return uploadToDropbox(account, folderPath, fileName, content, mimeType);
  }
}

/**
 * Provider display label utility (shared across UI components).
 */
export function providerLabel(provider: OAuthProvider): string {
  switch (provider) {
    case 'google':
      return 'Google Drive';
    case 'microsoft':
      return 'OneDrive';
    case 'dropbox':
      return 'Dropbox';
  }
}
