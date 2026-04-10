/**
 * Folder browser modal — looks like a simplified File Explorer.
 *
 * Features:
 * - Click folders to navigate into them
 * - Breadcrumb navigation to go back up
 * - "New Folder" button to create folders inline
 * - "Select This Folder" button to confirm selection
 */

import { useState, useEffect, useCallback } from 'react';
import type { ConnectedAccount } from '@/types';
import {
  listFolders,
  listFoldersByPath,
  createFolder,
  type FolderEntry,
} from '@/upload/folder-listing';

interface FolderPickerProps {
  account: ConnectedAccount;
  initialPath?: string;
  onSelect: (path: string, folderId?: string, driveId?: string) => void;
  onCancel: () => void;
}

interface BreadcrumbItem {
  name: string;
  id?: string;
  path: string;
  driveId?: string;
}

export function FolderPicker({
  account,
  initialPath,
  onSelect,
  onCancel,
}: FolderPickerProps) {
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { name: providerRootName(account.provider), path: '/' },
  ]);
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  const [currentPath, setCurrentPath] = useState(initialPath ?? '/');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualPath, setManualPath] = useState('');

  const loadFolder = useCallback(
    async (parentId?: string) => {
      setLoading(true);
      setError(null);
      try {
        const items = await listFolders(account, parentId);
        setFolders(items);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load folders');
        setFolders([]);
      } finally {
        setLoading(false);
      }
    },
    [account],
  );

  useEffect(() => {
    void loadFolder(currentId);
  }, [currentId, loadFolder]);

  const navigateInto = (folder: FolderEntry) => {
    // Always build path incrementally by appending folder name to current path.
    // Don't rely on folder.path from the API — it can be incomplete for shared drives.
    const newPath = currentPath === '/'
      ? `/${folder.name}`
      : `${currentPath}/${folder.name}`;

    setBreadcrumbs((prev) => [
      ...prev,
      { name: folder.name, id: folder.id, path: newPath, driveId: folder.driveId },
    ]);
    setCurrentId(account.provider === 'dropbox' ? undefined : folder.id);
    setCurrentPath(newPath);

    // For Dropbox, we pass the path instead of ID
    if (account.provider === 'dropbox') {
      void loadDropboxByPath(folder.path);
    }
  };

  const loadDropboxByPath = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const items = await listFolders(account, path);
      setFolders(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load folders');
    } finally {
      setLoading(false);
    }
  };

  const navigateTo = (index: number) => {
    const target = breadcrumbs[index];
    if (!target) return;
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
    setCurrentPath(target.path);

    if (account.provider === 'dropbox') {
      void loadDropboxByPath(target.path === '/' ? '' : target.path);
    } else {
      setCurrentId(target.id);
    }
  };

  const handleGoToPath = async (path: string) => {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    const driveId = [...breadcrumbs].reverse().find((b) => b.driveId)?.driveId;
    try {
      const items = await listFoldersByPath(account, path, driveId);
      setFolders(items);
      setCurrentPath(path.startsWith('/') ? path : `/${path}`);
      // Build breadcrumbs from the typed path
      const parts = path.split('/').filter((p) => p.length > 0);
      const newBreadcrumbs: BreadcrumbItem[] = [
        { name: providerRootName(account.provider), path: '/', driveId },
      ];
      let accumPath = '';
      for (const part of parts) {
        accumPath += `/${part}`;
        newBreadcrumbs.push({ name: part, path: accumPath, driveId });
      }
      setBreadcrumbs(newBreadcrumbs);
      setShowManualInput(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to navigate to path');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreating(true);
    try {
      const parentForCreate =
        account.provider === 'dropbox'
          ? (currentPath === '/' ? '' : currentPath)
          : currentId;
      const created = await createFolder(account, parentForCreate, newFolderName.trim());
      setFolders((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewFolderName('');
      setShowNewFolder(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface rounded-lg shadow-xl w-full max-w-md flex flex-col" style={{ height: '480px' }}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-surface-bright">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-on-surface">
              Choose folder — {providerLabel(account.provider)}
            </h3>
            <button
              type="button"
              onClick={onCancel}
              className="text-on-surface-muted hover:text-on-surface text-lg leading-none"
            >
              &times;
            </button>
          </div>

          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 mt-2 text-xs text-on-surface-muted overflow-x-auto">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1 shrink-0">
                {i > 0 && <span className="text-on-surface-muted">/</span>}
                <button
                  type="button"
                  onClick={() => navigateTo(i)}
                  className={`hover:text-brand-600 hover:underline ${
                    i === breadcrumbs.length - 1 ? 'font-medium text-on-surface' : ''
                  }`}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-on-surface-muted">Loading folders...</p>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-md bg-red-50 text-red-700 text-sm">
              {error}
            </div>
          )}

          {!loading && !error && folders.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-on-surface-muted italic">
                No subfolders. You can create one or select this folder.
              </p>
            </div>
          )}

          {!loading &&
            folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => navigateInto(folder)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-left hover:bg-surface-dim transition-colors group"
              >
                <span className="text-lg" role="img" aria-label="folder">
                  📁
                </span>
                <span className="text-on-surface group-hover:text-brand-600 truncate">
                  {folder.name}
                </span>
              </button>
            ))}

          {/* New folder inline input */}
          {showNewFolder && (
            <div className="flex items-center gap-2 px-3 py-2 mt-1">
              <span className="text-lg">📁</span>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateFolder();
                  if (e.key === 'Escape') {
                    setShowNewFolder(false);
                    setNewFolderName('');
                  }
                }}
                placeholder="New folder name"
                className="flex-1 px-2 py-1 text-sm border border-brand-300 rounded-md bg-surface text-on-surface focus:outline-none focus:ring-1 focus:ring-brand-400"
                autoFocus
                disabled={creating}
              />
              <button
                type="button"
                onClick={() => void handleCreateFolder()}
                disabled={creating || !newFolderName.trim()}
                className="text-xs px-2 py-1 rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {creating ? '...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewFolder(false);
                  setNewFolderName('');
                }}
                className="text-xs px-2 py-1 text-on-surface-muted hover:text-on-surface"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-surface-bright space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowNewFolder(true)}
                disabled={showNewFolder}
                className="text-xs px-3 py-1.5 rounded-md border border-surface-bright text-on-surface hover:bg-surface-dim disabled:opacity-50 transition-colors"
              >
                + New Folder
              </button>
              <button
                type="button"
                onClick={() => setShowManualInput((v) => !v)}
                className="text-xs px-3 py-1.5 rounded-md border border-surface-bright text-on-surface-muted hover:bg-surface-dim transition-colors"
              >
                {showManualInput ? 'Browse' : 'Type path'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                const lastBreadcrumb = breadcrumbs[breadcrumbs.length - 1];
                const driveId = [...breadcrumbs].reverse().find((b) => b.driveId)?.driveId;
                // Only use manualPath if the manual input is actively showing;
                // otherwise use currentPath which tracks navigation clicks.
                const selectedPath = showManualInput && manualPath ? manualPath : currentPath;
                onSelect(selectedPath, lastBreadcrumb?.id, driveId);
              }}
              className="px-4 py-1.5 text-sm font-medium rounded-md bg-brand-500 text-white hover:bg-brand-600 transition-colors"
            >
              Select This Folder
            </button>
          </div>

          {showManualInput ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleGoToPath(manualPath);
                }}
                placeholder="Type path, e.g. /Documents/CoalOpt"
                className="flex-1 px-3 py-1.5 text-xs border border-surface-bright rounded-md bg-surface text-on-surface"
                autoFocus
              />
              <button
                type="button"
                onClick={() => void handleGoToPath(manualPath)}
                disabled={!manualPath.trim()}
                className="text-xs px-3 py-1.5 rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 transition-colors"
              >
                Go
              </button>
            </div>
          ) : (
            <div className="text-xs text-on-surface-muted truncate" title={currentPath}>
              {currentPath}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function providerLabel(provider: string): string {
  switch (provider) {
    case 'google': return 'Google Drive';
    case 'microsoft': return 'OneDrive';
    case 'dropbox': return 'Dropbox';
    default: return provider;
  }
}

function providerRootName(provider: string): string {
  switch (provider) {
    case 'google': return 'My Drive';
    case 'microsoft': return 'OneDrive';
    case 'dropbox': return 'Dropbox';
    default: return 'Root';
  }
}
