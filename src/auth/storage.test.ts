import {
  loadAccounts,
  loadProviderAccounts,
  findAccount,
  upsertAccount,
  updateTokens,
  removeAccount,
  isTokenExpired,
} from './storage';
import type { ConnectedAccount, ConnectedAccountStore } from '@/types';
import { emptyAccountStore, STORAGE_KEYS } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAccount(overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    id: 'google:test@gmail.com',
    provider: 'google',
    email: 'test@gmail.com',
    displayName: 'Test User',
    accessToken: 'access-token-123',
    refreshToken: 'refresh-token-456',
    expiresAt: Date.now() + 3600_000,
    scopes: ['openid', 'email'],
    addedAt: Date.now(),
    ...overrides,
  };
}

/** In-memory storage backing the chrome.storage.local mock. */
let mockStorage: Record<string, unknown> = {};

beforeEach(() => {
  mockStorage = {};

  // Reset chrome.storage.local mocks to use the in-memory store
  vi.mocked(chrome.storage.local.get).mockImplementation(
    async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (typeof keys === 'string') {
        return { [keys]: mockStorage[keys] };
      }
      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const k of keys) {
          result[k] = mockStorage[k];
        }
        return result;
      }
      return { ...mockStorage };
    },
  );

  vi.mocked(chrome.storage.local.set).mockImplementation(async (items: Record<string, unknown>) => {
    Object.assign(mockStorage, items);
  });

  vi.mocked(chrome.storage.local.remove).mockImplementation(async (keys: string | string[]) => {
    const keyList = typeof keys === 'string' ? [keys] : keys;
    for (const k of keyList) {
      delete mockStorage[k];
    }
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadAccounts', () => {
  it('returns empty store when nothing is saved', async () => {
    const store = await loadAccounts();
    expect(store).toEqual(emptyAccountStore());
  });

  it('returns saved accounts', async () => {
    const saved: ConnectedAccountStore = {
      google: [makeAccount()],
      microsoft: [],
      dropbox: [],
    };
    mockStorage[STORAGE_KEYS.CONNECTED_ACCOUNTS] = saved;

    const store = await loadAccounts();
    expect(store.google).toHaveLength(1);
    expect(store.google[0]?.email).toBe('test@gmail.com');
  });
});

describe('loadProviderAccounts', () => {
  it('returns only accounts for the requested provider', async () => {
    const saved: ConnectedAccountStore = {
      google: [makeAccount()],
      microsoft: [makeAccount({ id: 'microsoft:test@outlook.com', provider: 'microsoft', email: 'test@outlook.com' })],
      dropbox: [],
    };
    mockStorage[STORAGE_KEYS.CONNECTED_ACCOUNTS] = saved;

    const msAccounts = await loadProviderAccounts('microsoft');
    expect(msAccounts).toHaveLength(1);
    expect(msAccounts[0]?.email).toBe('test@outlook.com');
  });
});

describe('findAccount', () => {
  it('finds an account by id across providers', async () => {
    const msAccount = makeAccount({
      id: 'microsoft:test@outlook.com',
      provider: 'microsoft',
      email: 'test@outlook.com',
    });
    const saved: ConnectedAccountStore = {
      google: [],
      microsoft: [msAccount],
      dropbox: [],
    };
    mockStorage[STORAGE_KEYS.CONNECTED_ACCOUNTS] = saved;

    const found = await findAccount('microsoft:test@outlook.com');
    expect(found?.email).toBe('test@outlook.com');
  });

  it('returns undefined for unknown id', async () => {
    const found = await findAccount('google:nonexistent@gmail.com');
    expect(found).toBeUndefined();
  });
});

describe('upsertAccount', () => {
  it('adds a new account', async () => {
    const account = makeAccount();
    await upsertAccount(account);

    const store = await loadAccounts();
    expect(store.google).toHaveLength(1);
    expect(store.google[0]?.id).toBe('google:test@gmail.com');
  });

  it('updates an existing account with the same id', async () => {
    const account = makeAccount();
    await upsertAccount(account);

    const updated = makeAccount({ accessToken: 'new-token' });
    await upsertAccount(updated);

    const store = await loadAccounts();
    expect(store.google).toHaveLength(1);
    expect(store.google[0]?.accessToken).toBe('new-token');
  });

  it('supports multiple accounts for the same provider', async () => {
    await upsertAccount(makeAccount({ id: 'google:a@gmail.com', email: 'a@gmail.com' }));
    await upsertAccount(makeAccount({ id: 'google:b@gmail.com', email: 'b@gmail.com' }));

    const store = await loadAccounts();
    expect(store.google).toHaveLength(2);
  });
});

describe('updateTokens', () => {
  it('updates token fields without changing other account data', async () => {
    const account = makeAccount({ displayName: 'Dan' });
    await upsertAccount(account);

    await updateTokens('google:test@gmail.com', {
      accessToken: 'refreshed-access',
      expiresAt: 999999,
    });

    const found = await findAccount('google:test@gmail.com');
    expect(found?.accessToken).toBe('refreshed-access');
    expect(found?.expiresAt).toBe(999999);
    expect(found?.displayName).toBe('Dan');
    expect(found?.refreshToken).toBe('refresh-token-456'); // unchanged
  });

  it('optionally updates refreshToken', async () => {
    await upsertAccount(makeAccount());

    await updateTokens('google:test@gmail.com', {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: 888888,
    });

    const found = await findAccount('google:test@gmail.com');
    expect(found?.refreshToken).toBe('new-refresh');
  });
});

describe('removeAccount', () => {
  it('removes an account by id', async () => {
    await upsertAccount(makeAccount());
    await removeAccount('google:test@gmail.com');

    const store = await loadAccounts();
    expect(store.google).toHaveLength(0);
  });

  it('does nothing for unknown id', async () => {
    await upsertAccount(makeAccount());
    await removeAccount('google:nonexistent@gmail.com');

    const store = await loadAccounts();
    expect(store.google).toHaveLength(1);
  });
});

describe('isTokenExpired', () => {
  it('returns false when token is fresh', () => {
    const account = makeAccount({ expiresAt: Date.now() + 3600_000 });
    expect(isTokenExpired(account)).toBe(false);
  });

  it('returns true when token is expired', () => {
    const account = makeAccount({ expiresAt: Date.now() - 1000 });
    expect(isTokenExpired(account)).toBe(true);
  });

  it('returns true when token will expire within buffer', () => {
    const account = makeAccount({ expiresAt: Date.now() + 30_000 }); // 30s remaining
    expect(isTokenExpired(account, 60_000)).toBe(true); // 60s buffer
  });

  it('respects custom buffer', () => {
    const account = makeAccount({ expiresAt: Date.now() + 30_000 });
    expect(isTokenExpired(account, 10_000)).toBe(false); // 10s buffer, 30s remaining
  });
});
