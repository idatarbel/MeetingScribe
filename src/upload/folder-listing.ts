/**
 * Folder listing API for all three providers.
 * Used by the FolderPicker component to browse cloud storage folders.
 */

import type { ConnectedAccount } from '@/types';
import { getAccessToken } from '@/auth';

export interface FolderEntry {
  id: string;
  name: string;
  path: string;
  hasChildren: boolean;
  /** For OneDrive shared items — the remote drive ID needed for navigation and upload. */
  driveId?: string;
}

/**
 * List child folders at a given path/id for the specified account.
 * Returns only folders, not files.
 */
export async function listFolders(
  account: ConnectedAccount,
  parentId?: string,
): Promise<FolderEntry[]> {
  switch (account.provider) {
    case 'google':
      return listGoogleDriveFolders(account, parentId ?? 'root');
    case 'microsoft':
      return listOneDriveFolders(account, parentId);
    case 'dropbox':
      return listDropboxFolders(account, parentId ?? '');
  }
}

// ---------------------------------------------------------------------------
// Google Drive
// ---------------------------------------------------------------------------

async function listGoogleDriveFolders(
  account: ConnectedAccount,
  parentId: string,
): Promise<FolderEntry[]> {
  const accessToken = await getAccessToken(account.id);
  const q = encodeURIComponent(
    `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=name&pageSize=100`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Google Drive folder listing failed (${response.status})`);
  }

  const data = (await response.json()) as {
    files?: Array<{ id: string; name: string }>;
  };

  return (data.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    path: f.name, // Google Drive doesn't have path-based addressing; we use IDs
    hasChildren: true, // We don't know until we drill in; assume yes
  }));
}

// ---------------------------------------------------------------------------
// OneDrive (Microsoft Graph)
// ---------------------------------------------------------------------------

/**
 * OneDrive folder listing supports three modes:
 * 1. parentId = undefined → show root folders + a virtual "Shared with me" entry
 * 2. parentId = "__shared__" → list items shared with the user
 * 3. parentId = "driveId:itemId" → navigate into a shared drive's subfolder
 * 4. parentId = regular item ID → navigate within user's own drive
 */
async function listOneDriveFolders(
  account: ConnectedAccount,
  parentId?: string,
): Promise<FolderEntry[]> {
  const accessToken = await getAccessToken(account.id);

  // Mode 1: Root → show own folders + "Shared with me" virtual entry
  if (!parentId) {
    const ownFolders = await listOneDriveChildren(accessToken);
    const sharedEntry: FolderEntry = {
      id: '__shared__',
      name: 'Shared with me',
      path: '/Shared with me',
      hasChildren: true,
    };
    return [sharedEntry, ...ownFolders];
  }

  // Mode 2: List shared items
  if (parentId === '__shared__') {
    return listOneDriveSharedWithMe(accessToken);
  }

  // Mode 3: Shared drive subfolder (format: "driveId:itemId")
  if (parentId.includes(':')) {
    const [driveId, itemId] = parentId.split(':');
    return listOneDriveDriveChildren(accessToken, driveId!, itemId!);
  }

  // Mode 4: Own drive subfolder
  return listOneDriveChildren(accessToken, parentId);
}

async function listOneDriveChildren(
  accessToken: string,
  parentId?: string,
): Promise<FolderEntry[]> {
  const basePath = parentId
    ? `https://graph.microsoft.com/v1.0/me/drive/items/${parentId}/children`
    : 'https://graph.microsoft.com/v1.0/me/drive/root/children';

  const url = `${basePath}?$filter=folder ne null&$select=id,name,folder,parentReference&$orderby=name&$top=100`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`OneDrive folder listing failed (${response.status})`);
  }

  const data = (await response.json()) as {
    value?: Array<{
      id: string;
      name: string;
      folder?: { childCount: number };
      parentReference?: { path?: string; driveId?: string };
    }>;
  };

  return (data.value ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    path: item.parentReference?.path
      ? `${item.parentReference.path.replace(/\/drive\/root:/, '')}/${item.name}`
      : `/${item.name}`,
    hasChildren: (item.folder?.childCount ?? 0) > 0,
  }));
}

async function listOneDriveSharedWithMe(
  accessToken: string,
): Promise<FolderEntry[]> {
  // Don't use $select — personal OneDrive accounts return shared items
  // with varying structures. Fetch all fields to properly detect folders.
  const url =
    'https://graph.microsoft.com/v1.0/me/drive/sharedWithMe?$top=200';

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('[MeetingScribe] sharedWithMe failed:', response.status, body);
    throw new Error(`OneDrive shared items listing failed (${response.status})`);
  }

  const data = (await response.json()) as {
    value?: Array<{
      id: string;
      name: string;
      folder?: { childCount: number };
      file?: { mimeType: string };
      remoteItem?: {
        id: string;
        name: string;
        parentReference?: { driveId?: string };
        folder?: { childCount: number };
        file?: { mimeType: string };
        shared?: { owner?: { user?: { displayName?: string } } };
      };
    }>;
  };

  // Collect unique remote drives from shared items. Each represents
  // another user's OneDrive that we may have access to browse.
  const driveMap = new Map<string, { driveId: string; ownerName: string }>();

  for (const item of data.value ?? []) {
    const remote = item.remoteItem;
    const driveId = remote?.parentReference?.driveId;
    if (driveId && !driveMap.has(driveId)) {
      const ownerName = remote?.shared?.owner?.user?.displayName ?? 'Unknown';
      driveMap.set(driveId, { driveId, ownerName });
    }
  }

  // Return one virtual folder per unique shared drive,
  // so the user can browse the remote drive's folder tree.
  const entries: FolderEntry[] = [];
  for (const [driveId, info] of driveMap) {
    entries.push({
      id: `${driveId}:root`,
      name: `${info.ownerName}'s OneDrive`,
      path: `/Shared with me/${info.ownerName}'s OneDrive`,
      hasChildren: true,
      driveId,
    });
  }

  // Also include any directly shared folders (not just files)
  for (const item of data.value ?? []) {
    const isFolder = item.folder || item.remoteItem?.folder;
    if (!isFolder) continue;
    const remote = item.remoteItem;
    const driveId = remote?.parentReference?.driveId;
    const itemId = remote?.id ?? item.id;
    entries.push({
      id: driveId ? `${driveId}:${itemId}` : item.id,
      name: item.name,
      path: `/Shared with me/${item.name}`,
      hasChildren: true,
      driveId,
    });
  }

  return entries;
}

async function listOneDriveDriveChildren(
  accessToken: string,
  driveId: string,
  itemId: string,
): Promise<FolderEntry[]> {
  // If itemId is "root", list the drive's root children
  const itemPath = itemId === 'root' ? 'root' : `items/${itemId}`;
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/${itemPath}/children?$filter=folder ne null&$select=id,name,folder,parentReference&$orderby=name&$top=100`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`OneDrive shared folder listing failed (${response.status})`);
  }

  const data = (await response.json()) as {
    value?: Array<{
      id: string;
      name: string;
      folder?: { childCount: number };
      parentReference?: { path?: string; driveId?: string };
    }>;
  };

  return (data.value ?? []).map((item) => ({
    id: `${driveId}:${item.id}`,
    name: item.name,
    path: item.parentReference?.path
      ? `${item.parentReference.path.replace(/\/drive\/root:/, '').replace(/\/drives\/[^/]+\/root:/, '')}/${item.name}`
      : `/${item.name}`,
    hasChildren: (item.folder?.childCount ?? 0) > 0,
    driveId,
  }));
}

// ---------------------------------------------------------------------------
// Dropbox
// ---------------------------------------------------------------------------

async function listDropboxFolders(
  account: ConnectedAccount,
  path: string,
): Promise<FolderEntry[]> {
  const accessToken = await getAccessToken(account.id);
  const dropboxPath = path === '' || path === '/' ? '' : path;

  const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: dropboxPath,
      recursive: false,
      include_deleted: false,
      include_has_explicit_shared_members: false,
      include_mounted_folders: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Dropbox folder listing failed (${response.status})`);
  }

  const data = (await response.json()) as {
    entries: Array<{
      '.tag': string;
      id: string;
      name: string;
      path_display: string;
    }>;
  };

  return data.entries
    .filter((e) => e['.tag'] === 'folder')
    .map((e) => ({
      id: e.id,
      name: e.name,
      path: e.path_display,
      hasChildren: true,
    }));
}

// ---------------------------------------------------------------------------
// Navigate by path (for shared OneDrive drives where root listing is empty)
// ---------------------------------------------------------------------------

/**
 * List folders at a specific path on a remote OneDrive drive.
 * Used when the user types a path in the folder picker.
 */
export async function listFoldersByPath(
  account: ConnectedAccount,
  path: string,
  driveId?: string,
): Promise<FolderEntry[]> {
  if (account.provider !== 'microsoft' || !driveId) {
    // For Google/Dropbox, fall through to normal listing using path
    return listFolders(account, path);
  }

  const accessToken = await getAccessToken(account.id);
  const cleanPath = path.replace(/^\/+|\/+$/g, ''); // strip leading/trailing slashes

  const url = cleanPath
    ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURI(cleanPath)}:/children?$filter=folder ne null&$select=id,name,folder,parentReference&$orderby=name&$top=100`
    : `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children?$filter=folder ne null&$select=id,name,folder,parentReference&$orderby=name&$top=100`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OneDrive path listing failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    value?: Array<{
      id: string;
      name: string;
      folder?: { childCount: number };
      parentReference?: { path?: string; driveId?: string };
    }>;
  };

  return (data.value ?? []).map((item) => ({
    id: `${driveId}:${item.id}`,
    name: item.name,
    path: cleanPath ? `/${cleanPath}/${item.name}` : `/${item.name}`,
    hasChildren: (item.folder?.childCount ?? 0) > 0,
    driveId,
  }));
}

// ---------------------------------------------------------------------------
// Create folder
// ---------------------------------------------------------------------------

export async function createFolder(
  account: ConnectedAccount,
  parentId: string | undefined,
  folderName: string,
): Promise<FolderEntry> {
  switch (account.provider) {
    case 'google':
      return createGoogleDriveFolder(account, parentId ?? 'root', folderName);
    case 'microsoft':
      return createOneDriveFolder(account, parentId, folderName);
    case 'dropbox':
      return createDropboxFolder(account, parentId ?? '', folderName);
  }
}

async function createGoogleDriveFolder(
  account: ConnectedAccount,
  parentId: string,
  name: string,
): Promise<FolderEntry> {
  const accessToken = await getAccessToken(account.id);
  const response = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });

  if (!response.ok) throw new Error(`Failed to create Google Drive folder (${response.status})`);
  const data = (await response.json()) as { id: string; name: string };
  return { id: data.id, name: data.name, path: data.name, hasChildren: false };
}

async function createOneDriveFolder(
  account: ConnectedAccount,
  parentId: string | undefined,
  name: string,
): Promise<FolderEntry> {
  const accessToken = await getAccessToken(account.id);

  let url: string;
  let returnDriveId: string | undefined;

  if (parentId?.includes(':')) {
    // Shared drive: parentId is "driveId:itemId"
    const [driveId, itemId] = parentId.split(':');
    returnDriveId = driveId;
    const itemPath = itemId === 'root' ? 'root' : `items/${itemId}`;
    url = `https://graph.microsoft.com/v1.0/drives/${driveId}/${itemPath}/children`;
  } else if (parentId) {
    // Own drive, specific folder
    url = `https://graph.microsoft.com/v1.0/me/drive/items/${parentId}/children`;
  } else {
    // Own drive, root
    url = 'https://graph.microsoft.com/v1.0/me/drive/root/children';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'rename',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create OneDrive folder (${response.status}): ${body}`);
  }
  const data = (await response.json()) as { id: string; name: string };
  const newId = returnDriveId ? `${returnDriveId}:${data.id}` : data.id;
  return { id: newId, name: data.name, path: `/${data.name}`, hasChildren: false, driveId: returnDriveId };
}

async function createDropboxFolder(
  account: ConnectedAccount,
  parentPath: string,
  name: string,
): Promise<FolderEntry> {
  const accessToken = await getAccessToken(account.id);
  const fullPath = parentPath === '' || parentPath === '/'
    ? `/${name}`
    : `${parentPath}/${name}`;

  const response = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: fullPath, autorename: false }),
  });

  if (!response.ok) throw new Error(`Failed to create Dropbox folder (${response.status})`);
  const data = (await response.json()) as {
    metadata: { id: string; name: string; path_display: string };
  };
  return {
    id: data.metadata.id,
    name: data.metadata.name,
    path: data.metadata.path_display,
    hasChildren: false,
  };
}
