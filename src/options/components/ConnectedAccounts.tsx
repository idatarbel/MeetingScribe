/**
 * Connected accounts management section.
 * Shows all connected accounts per provider with "Add account" and "Disconnect" actions.
 */

import { useState, useEffect, useCallback } from 'react';
import type { ConnectedAccount, OAuthProvider, ConnectedAccountStore } from '@/types';
import { loadAccounts, connectAccount, disconnectAccount } from '@/auth';
import { emptyAccountStore } from '@/types';

const PROVIDERS: Array<{ key: OAuthProvider; label: string; icon: string }> = [
  { key: 'google', label: 'Google', icon: '🔵' },
  { key: 'microsoft', label: 'Microsoft', icon: '🟦' },
  { key: 'dropbox', label: 'Dropbox', icon: '📦' },
];

export function ConnectedAccounts() {
  const [store, setStore] = useState<ConnectedAccountStore>(emptyAccountStore());
  const [connecting, setConnecting] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const accounts = await loadAccounts();
    setStore(accounts);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleConnect = async (provider: OAuthProvider) => {
    setConnecting(provider);
    setError(null);
    try {
      await connectAccount(provider);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    const confirmed = window.confirm(
      'Disconnect this account? You can re-connect it later.',
    );
    if (!confirmed) return;

    try {
      await disconnectAccount(accountId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
    }
  };

  return (
    <section>
      <h2 className="text-lg font-semibold text-on-surface mb-4">
        Connected Accounts
      </h2>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}

      {PROVIDERS.map(({ key, label, icon }) => (
        <div key={key} className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-on-surface">
              {icon} {label}
            </h3>
            <button
              type="button"
              onClick={() => handleConnect(key)}
              disabled={connecting !== null}
              className="text-xs px-3 py-1.5 rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {connecting === key ? 'Connecting...' : `Add ${label} account`}
            </button>
          </div>

          {store[key].length === 0 ? (
            <p className="text-sm text-on-surface-muted ml-6">
              No {label} accounts connected.
            </p>
          ) : (
            <ul className="space-y-2 ml-6">
              {store[key].map((account: ConnectedAccount) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  onDisconnect={handleDisconnect}
                />
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

function AccountRow({
  account,
  onDisconnect,
}: {
  account: ConnectedAccount;
  onDisconnect: (id: string) => void;
}) {
  const addedDate = new Date(account.addedAt).toLocaleDateString();

  return (
    <li className="flex items-center justify-between p-3 rounded-md bg-surface-dim">
      <div>
        <p className="text-sm font-medium text-on-surface">{account.email}</p>
        <p className="text-xs text-on-surface-muted">
          {account.displayName} &middot; Connected {addedDate}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onDisconnect(account.id)}
        className="text-xs px-2 py-1 rounded-sm text-red-600 hover:bg-red-50 transition-colors"
      >
        Disconnect
      </button>
    </li>
  );
}
