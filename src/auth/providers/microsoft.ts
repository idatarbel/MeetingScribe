/**
 * Microsoft OAuth 2.0 via chrome.identity.launchWebAuthFlow + PKCE.
 *
 * Endpoints (using "common" tenant for multi-tenant + personal MSA):
 *   Auth:  https://login.microsoftonline.com/common/oauth2/v2.0/authorize
 *   Token: https://login.microsoftonline.com/common/oauth2/v2.0/token
 *   User:  https://graph.microsoft.com/v1.0/me
 *
 * Scopes: openid profile email offline_access User.Read Calendars.Read Files.ReadWrite
 */

import type { ConnectedAccount } from '@/types';
import { generateCodeVerifier, generateCodeChallenge } from '../pkce';
import { upsertAccount, updateTokens } from '../storage';

function getTenant(): string {
  return (import.meta.env.VITE_MICROSOFT_TENANT as string | undefined) ?? 'common';
}

const AUTH_URL = () =>
  `https://login.microsoftonline.com/${getTenant()}/oauth2/v2.0/authorize`;
const TOKEN_URL = () =>
  `https://login.microsoftonline.com/${getTenant()}/oauth2/v2.0/token`;
const USERINFO_URL = 'https://graph.microsoft.com/v1.0/me';

function getClientId(): string {
  const id = import.meta.env.VITE_MICROSOFT_CLIENT_ID as string | undefined;
  if (!id) throw new Error('VITE_MICROSOFT_CLIENT_ID is not set in .env');
  return id;
}

function getRedirectUrl(): string {
  return chrome.identity.getRedirectURL();
}

function getScopes(): string {
  return (
    (import.meta.env.VITE_MICROSOFT_OAUTH_SCOPES as string | undefined) ??
    'openid profile email offline_access User.Read Calendars.Read Files.ReadWrite'
  );
}

// ---------------------------------------------------------------------------
// Authorization Code Flow + PKCE
// ---------------------------------------------------------------------------

/** Launch the interactive Microsoft sign-in flow. Returns the new ConnectedAccount. */
export async function connectMicrosoftAccount(): Promise<ConnectedAccount> {
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
    response_mode: 'query',
    prompt: 'select_account',  // let user pick which MS account to connect
  });

  const authUrl = `${AUTH_URL()}?${params.toString()}`;

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });

  if (!responseUrl) {
    throw new Error('Microsoft sign-in was cancelled or failed.');
  }

  const responseParams = new URL(responseUrl).searchParams;
  const code = responseParams.get('code');
  if (!code) {
    const error = responseParams.get('error');
    const errorDesc = responseParams.get('error_description');
    throw new Error(
      `Microsoft auth error: ${error ?? 'no authorization code returned'}` +
      (errorDesc ? ` — ${errorDesc}` : ''),
    );
  }

  // Exchange the code for tokens
  const tokenResponse = await fetch(TOKEN_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getClientId(),
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUrl,
      scope: getScopes(),
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(`Microsoft token exchange failed (${tokenResponse.status}): ${body}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
    id_token?: string;
  };

  // Fetch user profile via Microsoft Graph
  const profile = await fetchMicrosoftProfile(tokenData.access_token);

  const account: ConnectedAccount = {
    id: `microsoft:${profile.email}`,
    provider: 'microsoft',
    email: profile.email,
    displayName: profile.displayName,
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

/** Refresh an expired Microsoft access token using the stored refresh_token. */
export async function refreshMicrosoftToken(account: ConnectedAccount): Promise<void> {
  if (!account.refreshToken) {
    throw new Error(
      `Cannot refresh Microsoft account ${account.email}: no refresh_token stored. ` +
      'Disconnect and re-connect the account.',
    );
  }

  const response = await fetch(TOKEN_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getClientId(),
      refresh_token: account.refreshToken,
      grant_type: 'refresh_token',
      scope: getScopes(),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Microsoft token refresh failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  await updateTokens(account.id, {
    accessToken: data.access_token,
    // Microsoft may rotate the refresh_token on each refresh.
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

/**
 * Microsoft doesn't have a simple token revocation endpoint for public clients.
 * The best we can do is remove the account from local storage.
 * The user can manually revoke via https://account.live.com/consent/Manage
 */
export async function disconnectMicrosoftAccount(_account: ConnectedAccount): Promise<void> {
  // No-op for revocation — storage removal is handled by the caller.
  // The access token will expire naturally (~1 hour).
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

interface MicrosoftProfile {
  email: string;
  displayName: string;
}

async function fetchMicrosoftProfile(accessToken: string): Promise<MicrosoftProfile> {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Microsoft profile (${response.status})`);
  }

  const data = (await response.json()) as {
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
  };

  // Microsoft Graph returns mail for work accounts, userPrincipalName for personal.
  const email = data.mail ?? data.userPrincipalName ?? 'unknown@microsoft.com';

  return {
    email,
    displayName: data.displayName ?? email,
  };
}
