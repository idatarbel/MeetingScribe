/**
 * Routing rules CRUD management.
 * Lists rules in priority order with add, edit, delete, and reorder controls.
 */

import { useState, useEffect } from 'react';
import { FolderPicker } from '@/components/FolderPicker';
import type {
  RoutingRule,
  ExtensionSettings,
  RoutingMatch,
  RoutingDestination,
  OAuthProvider,
  ConnectedAccount,
} from '@/types';
import { STORAGE_KEYS, defaultSettings } from '@/types';
import { loadAccounts } from '@/auth';

export function RoutingRules() {
  const [settings, setSettings] = useState<ExtensionSettings>(defaultSettings());
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [editingRule, setEditingRule] = useState<RoutingRule | null>(null);

  const saveSettings = async (newSettings: ExtensionSettings) => {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: newSettings });
    setSettings(newSettings);
  };

  useEffect(() => {
    let cancelled = false;
    chrome.storage.local.get(STORAGE_KEYS.SETTINGS).then((result) => {
      if (cancelled) return;
      const s = (result[STORAGE_KEYS.SETTINGS] as ExtensionSettings) ?? defaultSettings();
      setSettings(s);
    });
    loadAccounts().then((store) => {
      if (cancelled) return;
      setAccounts([...store.google, ...store.microsoft, ...store.dropbox]);
    });
    return () => { cancelled = true; };
  }, []);

  const addRule = () => {
    const newRule: RoutingRule = {
      id: crypto.randomUUID(),
      label: 'New Rule',
      match: {},
      destination: {
        provider: 'google',
        accountId: accounts[0]?.id ?? '',
        folderPath: '/MeetingScribe',
        fileNameTemplate: '{date}_{title}',
        format: 'markdown',
      },
      priority: settings.routingRules.length,
      enabled: true,
    };
    setEditingRule(newRule);
  };

  const saveRule = (rule: RoutingRule) => {
    const rules = [...settings.routingRules];
    const idx = rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) {
      rules[idx] = rule;
    } else {
      rules.push(rule);
    }
    saveSettings({ ...settings, routingRules: rules });
    setEditingRule(null);
  };

  const deleteRule = (ruleId: string) => {
    const rules = settings.routingRules.filter((r) => r.id !== ruleId);
    saveSettings({ ...settings, routingRules: rules });
  };

  const moveRule = (ruleId: string, direction: 'up' | 'down') => {
    const rules = [...settings.routingRules];
    const idx = rules.findIndex((r) => r.id === ruleId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rules.length) return;
    const a = rules[idx];
    const b = rules[swapIdx];
    if (a === undefined || b === undefined) return;
    rules[idx] = b;
    rules[swapIdx] = a;
    // Re-assign priorities
    rules.forEach((r, i) => { r.priority = i; });
    saveSettings({ ...settings, routingRules: rules });
  };

  const toggleRule = (ruleId: string) => {
    const rules = settings.routingRules.map((r) =>
      r.id === ruleId ? { ...r, enabled: !r.enabled } : r,
    );
    saveSettings({ ...settings, routingRules: rules });
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-on-surface">Routing Rules</h2>
        <button
          type="button"
          onClick={addRule}
          className="text-xs px-3 py-1.5 rounded-md bg-brand-500 text-white hover:bg-brand-600 transition-colors"
        >
          + Add Rule
        </button>
      </div>

      <p className="text-sm text-on-surface-muted mb-4">
        Rules are evaluated top-to-bottom. The first matching rule determines where notes
        are saved. Drag to reorder.
      </p>

      {settings.routingRules.length === 0 ? (
        <p className="text-sm text-on-surface-muted italic">
          No routing rules configured. Notes will use the default destination.
        </p>
      ) : (
        <ul className="space-y-2">
          {settings.routingRules.map((rule, idx) => (
            <li
              key={rule.id}
              className={`flex items-center gap-3 p-3 rounded-md border ${
                rule.enabled
                  ? 'border-surface-bright bg-surface-dim'
                  : 'border-surface-bright bg-surface opacity-50'
              }`}
            >
              {/* Priority arrows */}
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => moveRule(rule.id, 'up')}
                  disabled={idx === 0}
                  className="text-xs px-1 text-on-surface-muted hover:text-on-surface disabled:opacity-30"
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => moveRule(rule.id, 'down')}
                  disabled={idx === settings.routingRules.length - 1}
                  className="text-xs px-1 text-on-surface-muted hover:text-on-surface disabled:opacity-30"
                  title="Move down"
                >
                  ▼
                </button>
              </div>

              {/* Rule info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-on-surface truncate">
                  {rule.label}
                </p>
                <p className="text-xs text-on-surface-muted truncate">
                  {describeMatch(rule.match)} → {describeDestination(rule.destination, accounts)}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleRule(rule.id)}
                  className="text-xs px-2 py-1 rounded-sm border border-surface-bright hover:bg-surface-bright"
                  title={rule.enabled ? 'Disable' : 'Enable'}
                >
                  {rule.enabled ? 'On' : 'Off'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingRule(rule)}
                  className="text-xs px-2 py-1 rounded-sm text-brand-600 hover:bg-brand-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => deleteRule(rule.id)}
                  className="text-xs px-2 py-1 rounded-sm text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Rule editor modal */}
      {editingRule && (
        <RuleEditor
          rule={editingRule}
          accounts={accounts}
          onSave={saveRule}
          onCancel={() => setEditingRule(null)}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rule Editor
// ---------------------------------------------------------------------------

function RuleEditor({
  rule,
  accounts,
  onSave,
  onCancel,
}: {
  rule: RoutingRule;
  accounts: ConnectedAccount[];
  onSave: (rule: RoutingRule) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(rule.label);
  const [match, setMatch] = useState<RoutingMatch>(rule.match);
  const [dest, setDest] = useState<RoutingDestination>(rule.destination);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  const handleSave = () => {
    onSave({
      ...rule,
      label,
      match,
      destination: dest,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface rounded-lg shadow-xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-on-surface mb-4">
          {rule.priority === undefined ? 'Add' : 'Edit'} Routing Rule
        </h3>

        {/* Label */}
        <Field label="Rule Name">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-surface-bright rounded-md bg-surface text-on-surface"
            placeholder="e.g., Black Nile meetings → OneDrive"
          />
        </Field>

        {/* Match conditions */}
        <fieldset className="mt-4 border border-surface-bright rounded-md p-4">
          <legend className="text-xs font-medium text-on-surface-muted px-2">
            Match Conditions (all must match)
          </legend>

          <Field label="Title contains">
            <input
              type="text"
              value={match.titleContains ?? ''}
              onChange={(e) =>
                setMatch({ ...match, titleContains: e.target.value || undefined })
              }
              className="w-full px-3 py-2 text-sm border border-surface-bright rounded-md bg-surface text-on-surface"
              placeholder="e.g., standup"
            />
          </Field>

          <Field label="Calendar account email">
            <input
              type="text"
              value={match.calendarAccountEmail ?? ''}
              onChange={(e) =>
                setMatch({ ...match, calendarAccountEmail: e.target.value || undefined })
              }
              className="w-full px-3 py-2 text-sm border border-surface-bright rounded-md bg-surface text-on-surface"
              placeholder="e.g., danspiegel@gmail.com"
            />
          </Field>

          <Field label="Attendee email">
            <input
              type="text"
              value={match.attendeeEmail ?? ''}
              onChange={(e) =>
                setMatch({ ...match, attendeeEmail: e.target.value || undefined })
              }
              className="w-full px-3 py-2 text-sm border border-surface-bright rounded-md bg-surface text-on-surface"
              placeholder="e.g., sarah.khan@blacknile.ai"
            />
          </Field>

          <Field label="Organizer email">
            <input
              type="text"
              value={match.organizerEmail ?? ''}
              onChange={(e) =>
                setMatch({ ...match, organizerEmail: e.target.value || undefined })
              }
              className="w-full px-3 py-2 text-sm border border-surface-bright rounded-md bg-surface text-on-surface"
              placeholder="e.g., boss@company.com"
            />
          </Field>
        </fieldset>

        {/* Destination */}
        <fieldset className="mt-4 border border-surface-bright rounded-md p-4">
          <legend className="text-xs font-medium text-on-surface-muted px-2">
            Save Destination
          </legend>

          <Field label="Account">
            <select
              value={dest.accountId}
              onChange={(e) => {
                const acct = accounts.find((a) => a.id === e.target.value);
                if (acct) {
                  setDest({ ...dest, accountId: acct.id, provider: acct.provider });
                }
              }}
              className="w-full px-3 py-2 text-sm border border-surface-bright rounded-md bg-surface text-on-surface"
            >
              {accounts.length === 0 && (
                <option value="">No accounts connected</option>
              )}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {providerLabel(a.provider)} — {a.email}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Folder path">
            <button
              type="button"
              onClick={() => setShowFolderBrowser(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm border border-surface-bright rounded-md bg-surface-dim text-on-surface hover:border-brand-300 transition-colors text-left"
              title="Click to browse folders"
            >
              <span role="img" aria-label="folder">📁</span>
              <span className="truncate">{dest.folderPath || '/MeetingScribe'}</span>
            </button>
          </Field>

          <Field label="File name template">
            <input
              type="text"
              value={dest.fileNameTemplate}
              onChange={(e) => setDest({ ...dest, fileNameTemplate: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-surface-bright rounded-md bg-surface text-on-surface"
              placeholder="{date}_{title}"
            />
          </Field>

          <Field label="Format">
            <select
              value={dest.format}
              onChange={(e) =>
                setDest({ ...dest, format: e.target.value as 'markdown' | 'html' })
              }
              className="w-full px-3 py-2 text-sm border border-surface-bright rounded-md bg-surface text-on-surface"
            >
              <option value="docx">Word (.docx)</option>
              <option value="markdown">Markdown (.md)</option>
              <option value="html">HTML (.html)</option>
            </select>
          </Field>
        </fieldset>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-md border border-surface-bright text-on-surface hover:bg-surface-dim"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 text-sm rounded-md bg-brand-500 text-white hover:bg-brand-600"
          >
            Save Rule
          </button>
        </div>

        {/* Folder browser modal */}
        {showFolderBrowser && (() => {
          const selectedAcct = accounts.find((a) => a.id === dest.accountId);
          if (!selectedAcct) return null;
          return (
            <FolderPicker
              account={selectedAcct}
              initialPath={dest.folderPath}
              onSelect={(path) => {
                setDest({ ...dest, folderPath: path });
                setShowFolderBrowser(false);
              }}
              onCancel={() => setShowFolderBrowser(false)}
            />
          );
        })()}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <label className="block text-xs font-medium text-on-surface-muted mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function describeMatch(match: RoutingMatch): string {
  const parts: string[] = [];
  if (match.titleContains) parts.push(`title ~ "${match.titleContains}"`);
  if (match.calendarAccountEmail) parts.push(`from ${match.calendarAccountEmail}`);
  if (match.attendeeEmail) parts.push(`with ${match.attendeeEmail}`);
  if (match.organizerEmail) parts.push(`by ${match.organizerEmail}`);
  if (match.calendarProvider) parts.push(`on ${match.calendarProvider}`);
  if (match.calendarName) parts.push(`cal: ${match.calendarName}`);
  return parts.length > 0 ? parts.join(' & ') : 'All meetings';
}

function describeDestination(
  dest: RoutingDestination,
  accounts: ConnectedAccount[],
): string {
  const acct = accounts.find((a) => a.id === dest.accountId);
  const label = acct ? `${providerLabel(acct.provider)} (${acct.email})` : dest.accountId;
  return `${label} ${dest.folderPath}`;
}

function providerLabel(provider: OAuthProvider): string {
  switch (provider) {
    case 'google': return 'Google Drive';
    case 'microsoft': return 'OneDrive';
    case 'dropbox': return 'Dropbox';
  }
}
