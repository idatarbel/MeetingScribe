/**
 * Save button with destination picker, folder path input, and routing rule creation.
 *
 * Flow: Select account → type/browse folder path → Save.
 * "Update Routing Rule" creates a rule that auto-routes future meetings
 * with the same title to the selected account + folder.
 */

import { useState, useEffect } from 'react';
import type { ConnectedAccount, OAuthProvider, ExtensionSettings, RoutingRule, NoteFormat } from '@/types';
import { loadAccounts } from '@/auth';
import { STORAGE_KEYS, defaultSettings } from '@/types';
import { FolderPicker } from '@/components/FolderPicker';

interface SaveButtonProps {
  onSave: (accountId: string, provider: OAuthProvider, folderPath: string, driveId?: string, folderId?: string) => Promise<void>;
  isSaving: boolean;
  lastSavedAt?: number;
  preselectedAccountId?: string;
  preselectedFolderPath?: string;
  meetingTitle: string;
  saveFormat: NoteFormat;
  onFormatChange: (format: NoteFormat) => void;
}

export function SaveButton({
  onSave,
  isSaving,
  lastSavedAt,
  preselectedAccountId,
  preselectedFolderPath,
  meetingTitle,
  saveFormat,
  onFormatChange,
}: SaveButtonProps) {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [folderPath, setFolderPath] = useState(preselectedFolderPath ?? '/MeetingScribe');
  const [showPicker, setShowPicker] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [selectedDriveId, setSelectedDriveId] = useState<string | undefined>();
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>();
  const [ruleMessage, setRuleMessage] = useState<string | null>(null);
  const [ruleLoaded, setRuleLoaded] = useState(false);

  useEffect(() => {
    loadAccounts().then((store) => {
      const all = [
        ...store.google,
        ...store.microsoft,
        ...store.dropbox,
      ];
      setAccounts(all);

      if (preselectedAccountId && all.some((a) => a.id === preselectedAccountId)) {
        setSelectedAccountId(preselectedAccountId);
      } else if (all.length > 0 && all[0]) {
        setSelectedAccountId(all[0].id);
      }
    });
  }, [preselectedAccountId]);

  // Load existing routing rule for this meeting title — only once on mount.
  // Uses substring matching (same as the routing engine):
  //   rule.titleContains is a substring that must appear in the meeting title.
  useEffect(() => {
    if (ruleLoaded) return;
    chrome.storage.local.get(STORAGE_KEYS.SETTINGS).then((result) => {
      const settings = (result[STORAGE_KEYS.SETTINGS] as ExtensionSettings) ?? defaultSettings();
      const titleLower = meetingTitle.toLowerCase();

      // Find the best matching rule: prefer exact match, fall back to substring
      const existingRule = settings.routingRules.find(
        (r) =>
          r.enabled &&
          r.match.titleContains &&
          (titleLower === r.match.titleContains.toLowerCase() ||
            titleLower.includes(r.match.titleContains.toLowerCase()) ||
            r.match.titleContains.toLowerCase().includes(titleLower)),
      );

      if (existingRule) {
        console.log('[MeetingScribe] Routing rule matched:', existingRule.label, '→', existingRule.destination.folderPath);
        setSelectedAccountId(existingRule.destination.accountId);
        setFolderPath(existingRule.destination.folderPath);
        setSelectedDriveId(existingRule.destination.driveId);
        setSelectedFolderId(existingRule.destination.folderId);
      } else {
        console.log('[MeetingScribe] No routing rule matched for:', meetingTitle);
        console.log('[MeetingScribe] Available rules:', settings.routingRules.map((r) => ({
          label: r.label,
          titleContains: r.match.titleContains,
          enabled: r.enabled,
        })));
      }
      setRuleLoaded(true);
    });
  }, [meetingTitle, ruleLoaded]);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  const handleSave = async () => {
    if (!selectedAccount) return;
    await onSave(selectedAccount.id, selectedAccount.provider, folderPath, selectedDriveId, selectedFolderId);
  };

  const handleUpdateRoutingRule = async () => {
    if (!selectedAccount) return;

    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    const settings = (result[STORAGE_KEYS.SETTINGS] as ExtensionSettings) ?? defaultSettings();

    // Check if a rule for this title already exists
    const existingIdx = settings.routingRules.findIndex(
      (r) => r.match.titleContains?.toLowerCase() === meetingTitle.toLowerCase(),
    );

    const rule: RoutingRule = {
      id: existingIdx >= 0
        ? settings.routingRules[existingIdx]?.id ?? crypto.randomUUID()
        : crypto.randomUUID(),
      label: `${meetingTitle} → ${providerLabel(selectedAccount.provider)}`,
      match: { titleContains: meetingTitle },
      destination: {
        provider: selectedAccount.provider,
        accountId: selectedAccount.id,
        folderPath,
        fileNameTemplate: '{date} - Meeting Minutes - {title}',
        format: saveFormat,
        driveId: selectedDriveId,
        folderId: selectedFolderId,
      },
      priority: existingIdx >= 0
        ? settings.routingRules[existingIdx]?.priority ?? settings.routingRules.length
        : settings.routingRules.length,
      enabled: true,
    };

    if (existingIdx >= 0) {
      settings.routingRules[existingIdx] = rule;
    } else {
      settings.routingRules.push(rule);
    }

    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
    setRuleMessage(
      existingIdx >= 0
        ? `Routing rule updated for "${meetingTitle}"`
        : `Routing rule created: "${meetingTitle}" → ${providerLabel(selectedAccount.provider)} ${folderPath}`,
    );
    setTimeout(() => setRuleMessage(null), 4000);
  };

  return (
    <div className="border-t border-surface-bright pt-4 mt-4">
      {/* Destination row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Account selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowPicker(!showPicker)}
            className="text-xs text-on-surface hover:text-brand-600 px-3 py-1.5 rounded-md border border-surface-bright hover:border-brand-300 transition-colors bg-surface-dim"
            title="Change save destination"
          >
            {selectedAccount
              ? `${providerLabel(selectedAccount.provider)} — ${selectedAccount.email}`
              : 'No accounts connected'}
          </button>

          {/* Account picker dropdown */}
          {showPicker && accounts.length > 0 && (
            <div className="absolute bottom-full left-0 mb-1 w-80 bg-surface border border-surface-bright rounded-lg shadow-lg z-50">
              <div className="p-2">
                <p className="text-xs font-medium text-on-surface-muted uppercase tracking-wide mb-2">
                  Save destination
                </p>
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => {
                      setSelectedAccountId(account.id);
                      setShowPicker(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      account.id === selectedAccountId
                        ? 'bg-brand-50 text-brand-700'
                        : 'hover:bg-surface-dim text-on-surface'
                    }`}
                  >
                    <span className="font-medium">
                      {providerLabel(account.provider)}
                    </span>
                    <span className="text-on-surface-muted ml-2">{account.email}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Folder path display + browse button */}
        <button
          type="button"
          onClick={() => setShowFolderBrowser(true)}
          disabled={!selectedAccount}
          className="flex-1 min-w-[180px] flex items-center gap-2 px-3 py-1.5 text-xs border border-surface-bright rounded-md bg-surface-dim text-on-surface hover:border-brand-300 disabled:opacity-50 transition-colors text-left"
          title="Click to browse folders"
        >
          <span role="img" aria-label="folder">📁</span>
          <span className="truncate">{folderPath}</span>
        </button>
      </div>

      {/* Action buttons row */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleUpdateRoutingRule}
            disabled={!selectedAccount}
            className="text-xs px-3 py-1.5 rounded-md border border-brand-300 text-brand-600 hover:bg-brand-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={`Create a routing rule so future "${meetingTitle}" meetings auto-save to this account and folder`}
          >
            Update Routing Rule
          </button>

          {/* Word count slot (passed from parent) */}
        </div>

        <div className="flex items-center gap-2">
          {lastSavedAt && (
            <span className="text-xs text-on-surface-muted">
              Saved {new Date(lastSavedAt).toLocaleTimeString()}
            </span>
          )}

          {/* Format selector */}
          <select
            value={saveFormat}
            onChange={(e) => onFormatChange(e.target.value as NoteFormat)}
            className="text-xs px-2 py-2 border border-surface-bright rounded-md bg-surface text-on-surface"
          >
            <option value="docx">.docx</option>
            <option value="markdown">.md</option>
            <option value="html">.html</option>
          </select>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !selectedAccount}
            className={`px-5 py-2 text-sm font-medium rounded-md transition-colors ${
              isSaving || !selectedAccount
                ? 'bg-surface-bright text-on-surface-muted cursor-not-allowed'
                : 'bg-brand-500 text-white hover:bg-brand-600'
            }`}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Routing rule feedback */}
      {ruleMessage && (
        <p className="mt-2 text-xs text-green-600 font-medium">{ruleMessage}</p>
      )}

      {/* Folder browser modal */}
      {showFolderBrowser && selectedAccount && (
        <FolderPicker
          account={selectedAccount}
          initialPath={folderPath}
          onSelect={(path, folderId, driveId) => {
            setFolderPath(path);
            setSelectedFolderId(folderId);
            setSelectedDriveId(driveId);
            setShowFolderBrowser(false);
          }}
          onCancel={() => setShowFolderBrowser(false)}
        />
      )}
    </div>
  );
}

function providerLabel(provider: OAuthProvider): string {
  switch (provider) {
    case 'google':
      return 'Google Drive';
    case 'microsoft':
      return 'OneDrive';
    case 'dropbox':
      return 'Dropbox';
  }
}
