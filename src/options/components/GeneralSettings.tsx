/**
 * General settings panel for auto-save, calendar polling, reminders, and note format.
 */

import { useState, useEffect } from 'react';
import type { ExtensionSettings } from '@/types';
import { STORAGE_KEYS, defaultSettings } from '@/types';

export function GeneralSettings() {
  const [settings, setSettings] = useState<ExtensionSettings>(defaultSettings());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    chrome.storage.local.get(STORAGE_KEYS.SETTINGS).then((result) => {
      if (cancelled) return;
      const s = (result[STORAGE_KEYS.SETTINGS] as ExtensionSettings) ?? defaultSettings();
      setSettings(s);
    });
    return () => { cancelled = true; };
  }, []);

  const save = async (updated: ExtensionSettings) => {
    setSettings(updated);
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: updated });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <section>
      <h2 className="text-lg font-semibold text-on-surface mb-4">General Settings</h2>

      {/* Auto-save */}
      <Field label="Auto-save draft interval (seconds)">
        <input
          type="number"
          min={0}
          max={300}
          value={settings.autoSaveIntervalSec}
          onChange={(e) =>
            save({ ...settings, autoSaveIntervalSec: Number(e.target.value) })
          }
          className="w-24 px-3 py-2 text-sm border border-surface-bright rounded-md bg-surface text-on-surface"
        />
        <p className="text-xs text-on-surface-muted mt-1">
          Set to 0 to disable auto-save. Default: 30 seconds.
        </p>
      </Field>

      {/* Calendar polling */}
      <Field label="Calendar polling">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-on-surface">
            <input
              type="checkbox"
              checked={settings.calendarPollingEnabled}
              onChange={(e) =>
                save({ ...settings, calendarPollingEnabled: e.target.checked })
              }
              className="rounded"
            />
            Enable periodic calendar polling
          </label>
        </div>
      </Field>

      {settings.calendarPollingEnabled && (
        <Field label="Polling interval (minutes)">
          <input
            type="number"
            min={1}
            max={60}
            value={settings.calendarPollingIntervalMin}
            onChange={(e) =>
              save({
                ...settings,
                calendarPollingIntervalMin: Number(e.target.value),
              })
            }
            className="w-24 px-3 py-2 text-sm border border-surface-bright rounded-md bg-surface text-on-surface"
          />
          <p className="text-xs text-on-surface-muted mt-1">
            How often to check for upcoming meetings. Default: 10 minutes.
          </p>
        </Field>
      )}

      {/* Reminder */}
      <Field label="Meeting reminder (minutes before start)">
        <input
          type="number"
          min={0}
          max={60}
          value={settings.reminderMinutesBefore}
          onChange={(e) =>
            save({
              ...settings,
              reminderMinutesBefore: Number(e.target.value),
            })
          }
          className="w-24 px-3 py-2 text-sm border border-surface-bright rounded-md bg-surface text-on-surface"
        />
        <p className="text-xs text-on-surface-muted mt-1">
          Show a notification this many minutes before a meeting. Set to 0 to disable. Default: 5.
        </p>
      </Field>

      {/* Default note format */}
      <Field label="Default note format">
        <select
          value={settings.defaultNoteFormat}
          onChange={(e) =>
            save({
              ...settings,
              defaultNoteFormat: e.target.value as 'markdown' | 'html',
            })
          }
          className="w-40 px-3 py-2 text-sm border border-surface-bright rounded-md bg-surface text-on-surface"
        >
          <option value="docx">Word (.docx)</option>
          <option value="markdown">Markdown (.md)</option>
          <option value="html">HTML (.html)</option>
        </select>
      </Field>

      {/* Data management */}
      <div className="mt-8 pt-6 border-t border-surface-bright">
        <h3 className="text-sm font-medium text-on-surface mb-3">Data Management</h3>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              await chrome.storage.local.remove('drafts');
              alert('All drafts cleared.');
            }}
            className="text-xs px-3 py-1.5 rounded-md border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
          >
            Clear All Drafts
          </button>
          <button
            type="button"
            onClick={async () => {
              await chrome.storage.local.remove('cachedEvents');
              alert('Calendar cache cleared. Next poll will fetch fresh data.');
            }}
            className="text-xs px-3 py-1.5 rounded-md border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
          >
            Clear Calendar Cache
          </button>
        </div>
      </div>

      {/* Save confirmation */}
      {saved && (
        <p className="mt-4 text-sm text-green-600 font-medium">Settings saved.</p>
      )}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <label className="block text-sm font-medium text-on-surface mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
