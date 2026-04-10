/**
 * Google OAuth 2.0 via chrome.identity.launchWebAuthFlow + PKCE.
 *
 * Endpoints:
 *   Auth:  https://accounts.google.com/o/oauth2/v2/auth
 *   Token: https://oauth2.googleapis.com/token
 *   User:  https://www.googleapis.com/oauth2/v3/userinfo
 *   Revoke: https://oauth2.googleapis.com/revoke
 *
 * Scopes configured in .env.example:
 *   openid email profile
 *   https://www.googleapis.com/auth/calendar.readonly
 *   https://www.googleapis.com/auth/drive.file
 */

import type { ConnectedAccount } from '@/types';
import { generateCodeVerifier, generateCodeChallenge } from '../pkce';
import { upsertAccount, updateTokens } from '../storage';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

function getClientId(): string {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!id) throw new Error('VITE_GOOGLE_CLIENT_ID is not set in .env');
  return id;
}

function getClientSecret(): string {
  const secret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string | undefined;
  if (!secret) throw new Error('VITE_GOOGLE_CLIENT_SECRET is not set in .env');
  return secret;
}

function getRedirectUrl(): string {
  return chrome.identity.getRedirectURL();
}

function getScopes(): string {
  return (
    (import.meta.env.VITE_GOOGLE_OAUTH_SCOPES as string | undefined) ??
    'openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.file'
  );
}

// ---------------------------------------------------------------------------
// Authorization Code Flow + PKCE
// ---------------------------------------------------------------------------

/** Launch the interactive Google sign-in flow. Returns the new ConnectedAccount. */
export async function connectGoogleAccount(): Promise<ConnectedAccount> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const redirectUrl = getRedirectUrl();

  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: redirectUrl,
    response_type: 'code',
    scope: getScopes(),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',       // request a refresh_token
    prompt: 'consent',            // force consent to always get refresh_token
    include_granted_scopes: 'true',
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });

  if (!responseUrl) {
    throw new Error('Google sign-in was cancelled or failed.');
  }

  const code = new URL(responseUrl).searchParams.get('code');
  if (!code) {
    const error = new URL(responseUrl).searchParams.get('error');
    throw new Error(`Google auth error: ${error ?? 'no authorization code returned'}`);
  }

  // Exchange the code for tokens
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUrl,
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(`Google token exchange failed (${tokenResponse.status}): ${body}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  if (!tokenData.refresh_token) {
    console.warn(
      '[MeetingScribe] Google did not return a refresh_token. ' +
      'This can happen if the user has already granted consent. ' +
      'Token refresh will not work until the user revokes and re-connects.',
    );
  }

  // Fetch user profile
  const profile = await fetchGoogleProfile(tokenData.access_token);

  const account: ConnectedAccount = {
    id: `google:${profile.email}`,
    provider: 'google',
    email: profile.email,
    displayName: profile.name,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? '',
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    scopes: tokenData.scope.split(' '),
    addedAt: Date.now(),
  };

  await upsertAccount(account);
  return account;
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

/** Refresh an expired Google access token using the stored refresh_token. */
export async function refreshGoogleToken(account: ConnectedAccount): Promise<void> {
  if (!account.refreshToken) {
    throw new Error(
      `Cannot refresh Google account ${account.email}: no refresh_token stored. ` +
      'Disconnect and re-connect the account.',
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      refresh_token: account.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google token refresh failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  await updateTokens(account.id, {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
}

// ---------------------------------------------------------------------------
// Disconnect (revoke)
// ---------------------------------------------------------------------------

/** Revoke the Google tokens and remove the account from storage. */
export async function disconnectGoogleAccount(account: ConnectedAccount): Promise<void> {
  // Best-effort revoke — don't throw if it fails (token may already be invalid).
  try {
    await fetch(`${REVOKE_URL}?token=${account.refreshToken || account.accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    console.warn(`[MeetingScribe] Google token revocation failed for ${account.email}`);
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google profile (${response.status})`);
  }

  const data = (await response.json()) as {
    email?: string;
    name?: string;
    picture?: string;
  };

  return {
    email: data.email ?? 'unknown@google.com',
    name: data.name ?? data.email ?? 'Google User',
    picture: data.picture,
  };
}
