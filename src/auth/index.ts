/**
 * MeetingScribe — Auth Manager
 *
 * Unified API for connecting, disconnecting, refreshing, and retrieving
 * accounts across all three OAuth providers.
 */

import type { ConnectedAccount, OAuthProvider } from '@/types';
import {
  loadAccounts,
  loadProviderAccounts,
  findAccount,
  removeAccount,
  isTokenExpired,
} from './storage';
import {
  connectGoogleAccount,
  refreshGoogleToken,
  disconnectGoogleAccount,
} from './providers/google';
import {
  connectMicrosoftAccount,
  refreshMicrosoftToken,
  disconnectMicrosoftAccount,
} from './providers/microsoft';
import {
  connectDropboxAccount,
  refreshDropboxToken,
  disconnectDropboxAccount,
} from './providers/dropbox';

// Re-export storage utilities for convenience
export { loadAccounts, loadProviderAccounts, findAccount, isTokenExpired };

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

/** Launch the interactive sign-in flow for a provider. */
export async function connectAccount(provider: OAuthProvider): Promise<ConnectedAccount> {
  switch (provider) {
    case 'google':
      return connectGoogleAccount();
    case 'microsoft':
      return connectMicrosoftAccount();
    case 'dropbox':
      return connectDropboxAccount();
  }
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

/** Revoke tokens (best-effort) and remove the account from storage. */
export async function disconnectAccount(accountId: string): Promise<void> {
  const account = await findAccount(accountId);
  if (!account) return;

  switch (account.provider) {
    case 'google':
      await disconnectGoogleAccount(account);
      break;
    case 'microsoft':
      await disconnectMicrosoftAccount(account);
      break;
    case 'dropbox':
      await disconnectDropboxAccount(account);
      break;
  }

  await removeAccount(accountId);
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

/** Refresh the access token for an account if it's expired. Returns the account. */
export async function ensureFreshToken(accountId: string): Promise<ConnectedAccount> {
  const account = await findAccount(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found. Has it been disconnected?`);
  }

  if (!isTokenExpired(account)) {
    return account;
  }

  switch (account.provider) {
    case 'google':
      await refreshGoogleToken(account);
      break;
    case 'microsoft':
      await refreshMicrosoftToken(account);
      break;
    case 'dropbox':
      await refreshDropboxToken(account);
      break;
  }

  // Re-read from storage after refresh to get the updated tokens.
  const refreshed = await findAccount(accountId);
  if (!refreshed) {
    throw new Error(`Account ${accountId} disappeared during token refresh.`);
  }
  return refreshed;
}

/**
 * Get a fresh access token for an account — the most common call site.
 * Handles refresh transparently. Returns just the token string.
 */
export async function getAccessToken(accountId: string): Promise<string> {
  const account = await ensureFreshToken(accountId);
  return account.accessToken;
}
