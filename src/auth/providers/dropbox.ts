/**
 * Dropbox OAuth 2.0 via chrome.identity.launchWebAuthFlow + PKCE.
 *
 * Endpoints:
 *   Auth:  https://www.dropbox.com/oauth2/authorize
 *   Token: https://api.dropboxapi.com/oauth2/token
 *   User:  https://api.dropboxapi.com/2/users/get_current_account
 *   Revoke: https://api.dropboxapi.com/2/auth/token/revoke
 *
 * Scopes: account_info.read files.metadata.read files.metadata.write
 *         files.content.read files.content.write sharing.write
 */

import type { ConnectedAccount } from '@/types';
import { generateCodeVerifier, generateCodeChallenge } from '../pkce';
import { upsertAccount, updateTokens } from '../storage';

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const USERINFO_URL = 'https://api.dropboxapi.com/2/users/get_current_account';
const REVOKE_URL = 'https://api.dropboxapi.com/2/auth/token/revoke';

function getAppKey(): string {
  const key = import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined;
  if (!key) throw new Error('VITE_DROPBOX_APP_KEY is not set in .env');
  return key;
}

function getRedirectUrl(): string {
  return chrome.identity.getRedirectURL();
}

// ---------------------------------------------------------------------------
// Authorization Code Flow + PKCE
// ---------------------------------------------------------------------------

/** Launch the interactive Dropbox sign-in flow. Returns the new ConnectedAccount. */
export async function connectDropboxAccount(): Promise<ConnectedAccount> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const redirectUrl = getRedirectUrl();

  const params = new URLSearchParams({
    client_id: getAppKey(),
    redirect_uri: redirectUrl,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',  // request a refresh_token
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });

  if (!responseUrl) {
    throw new Error('Dropbox sign-in was cancelled or failed.');
  }

  const code = new URL(responseUrl).searchParams.get('code');
  if (!code) {
    const error = new URL(responseUrl).searchParams.get('error_description');
    throw new Error(`Dropbox auth error: ${error ?? 'no authorization code returned'}`);
  }

  // Exchange the code for tokens
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getAppKey(),
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUrl,
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(`Dropbox token exchange failed (${tokenResponse.status}): ${body}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    uid: string;
    account_id: string;
  };

  // Fetch user profile
  const profile = await fetchDropboxProfile(tokenData.access_token);

  const account: ConnectedAccount = {
    id: `dropbox:${profile.email}`,
    provider: 'dropbox',
    email: profile.email,
    displayName: profile.displayName,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? '',
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    scopes: [
      'account_info.read',
      'files.metadata.read',
      'files.metadata.write',
      'files.content.read',
      'files.content.write',
      'sharing.write',
    ],
    addedAt: Date.now(),
  };

  await upsertAccount(account);
  return account;
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

/** Refresh an expired Dropbox access token using the stored refresh_token. */
export async function refreshDropboxToken(account: ConnectedAccount): Promise<void> {
  if (!account.refreshToken) {
    throw new Error(
      `Cannot refresh Dropbox account ${account.email}: no refresh_token stored. ` +
      'Disconnect and re-connect the account.',
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getAppKey(),
      refresh_token: account.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Dropbox token refresh failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
  };

  await updateTokens(account.id, {
    accessToken: data.access_token,
    // Dropbox does NOT rotate the refresh_token on each refresh.
    expiresAt: Date.now() + data.expires_in * 1000,
  });
}

// ---------------------------------------------------------------------------
// Disconnect (revoke)
// ---------------------------------------------------------------------------

/** Revoke the Dropbox tokens. */
export async function disconnectDropboxAccount(account: ConnectedAccount): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
      },
      body: null,
    });
  } catch {
    console.warn(`[MeetingScribe] Dropbox token revocation failed for ${account.email}`);
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

interface DropboxProfile {
  email: string;
  displayName: string;
}

async function fetchDropboxProfile(accessToken: string): Promise<DropboxProfile> {
  // Dropbox /2/users/get_current_account expects a POST with no body.
  // Must NOT send Content-Type header when body is empty/null.
  const response = await fetch(USERINFO_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Dropbox profile (${response.status})`);
  }

  const data = (await response.json()) as {
    email: string;
    name?: {
      display_name?: string;
      given_name?: string;
      surname?: string;
    };
  };

  return {
    email: data.email,
    displayName: data.name?.display_name ?? data.email,
  };
}
