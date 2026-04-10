/**
 * Connected account storage layer.
 *
 * All reads/writes go through chrome.storage.local.
 * The store shape is ConnectedAccountStore: { google: [], microsoft: [], dropbox: [] }.
 */

import type {
  ConnectedAccount,
  ConnectedAccountStore,
  OAuthProvider,
} from '@/types';
import { emptyAccountStore, STORAGE_KEYS } from '@/types';

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Load all connected accounts from chrome.storage.local. */
export async function loadAccounts(): Promise<ConnectedAccountStore> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.CONNECTED_ACCOUNTS);
  const raw = result[STORAGE_KEYS.CONNECTED_ACCOUNTS] as ConnectedAccountStore | undefined;
  return raw ?? emptyAccountStore();
}

/** Load connected accounts for a single provider. */
export async function loadProviderAccounts(
  provider: OAuthProvider,
): Promise<ConnectedAccount[]> {
  const store = await loadAccounts();
  return store[provider];
}

/** Find a specific account by its id (e.g. "google:danspiegel@gmail.com"). */
export async function findAccount(
  accountId: string,
): Promise<ConnectedAccount | undefined> {
  const store = await loadAccounts();
  for (const provider of Object.keys(store) as OAuthProvider[]) {
    const found = store[provider].find((a) => a.id === accountId);
    if (found) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/** Add or update a connected account. Upserts by account.id. */
export async function upsertAccount(account: ConnectedAccount): Promise<void> {
  const store = await loadAccounts();
  const list = store[account.provider];
  const idx = list.findIndex((a) => a.id === account.id);
  if (idx >= 0) {
    list[idx] = account;
  } else {
    list.push(account);
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.CONNECTED_ACCOUNTS]: store });
}

/** Update only the token fields on an existing account (after refresh). */
export async function updateTokens(
  accountId: string,
  tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  },
): Promise<void> {
  const store = await loadAccounts();
  for (const provider of Object.keys(store) as OAuthProvider[]) {
    const account = store[provider].find((a) => a.id === accountId);
    if (account) {
      account.accessToken = tokens.accessToken;
      if (tokens.refreshToken) {
        account.refreshToken = tokens.refreshToken;
      }
      account.expiresAt = tokens.expiresAt;
      await chrome.storage.local.set({ [STORAGE_KEYS.CONNECTED_ACCOUNTS]: store });
      return;
    }
  }
}

/** Remove a connected account by id. */
export async function removeAccount(accountId: string): Promise<void> {
  const store = await loadAccounts();
  for (const provider of Object.keys(store) as OAuthProvider[]) {
    const idx = store[provider].findIndex((a) => a.id === accountId);
    if (idx >= 0) {
      store[provider].splice(idx, 1);
      await chrome.storage.local.set({ [STORAGE_KEYS.CONNECTED_ACCOUNTS]: store });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Token freshness
// ---------------------------------------------------------------------------

/** Check whether an account's access token is expired (or will expire within bufferMs). */
export function isTokenExpired(account: ConnectedAccount, bufferMs = 60_000): boolean {
  return Date.now() + bufferMs >= account.expiresAt;
}
