/**
 * Document Templates — upload .docx templates with {placeholders}
 * that MeetingScribe merges meeting data into when saving.
 */

import { useState, useEffect, useRef } from 'react';
import type { ExtensionSettings } from '@/types';
import { STORAGE_KEYS, defaultSettings } from '@/types';
import { TEMPLATE_PLACEHOLDERS } from '@/utils/docx-template';

export function DocumentTemplates() {
  const [settings, setSettings] = useState<ExtensionSettings>(defaultSettings());
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS.SETTINGS).then((result) => {
      const s = (result[STORAGE_KEYS.SETTINGS] as ExtensionSettings) ?? defaultSettings();
      setSettings(s);
    });
  }, []);

  const saveSettings = async (updated: ExtensionSettings) => {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: updated });
    setSettings(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.docx')) {
      setError('Please upload a .docx file. Other formats are not supported.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Template file must be under 10 MB.');
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      const base64 = btoa(binary);

      await saveSettings({
        ...settings,
        docxTemplateBase64: base64,
        docxTemplateName: file.name,
      });
      setError(null);
    } catch (err) {
      setError(`Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // Reset file input so the same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveTemplate = async () => {
    await saveSettings({
      ...settings,
      docxTemplateBase64: '',
      docxTemplateName: '',
    });
    setError(null);
  };

  const hasTemplate = !!settings.docxTemplateBase64;

  return (
    <section>
      <h2 className="text-lg font-semibold text-on-surface mb-2">
        Document Template
      </h2>
      <p className="text-sm text-on-surface-muted mb-4">
        Upload a .docx template with {'{placeholders}'} that MeetingScribe will replace
        with meeting data when saving. If no template is uploaded, MeetingScribe
        generates documents using its built-in format.
      </p>

      {/* Current template status */}
      <div className="p-4 rounded-lg border border-surface-bright bg-surface-dim mb-4">
        {hasTemplate ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-on-surface">
                Current template: {settings.docxTemplateName}
              </p>
              <p className="text-xs text-on-surface-muted mt-1">
                {Math.round(settings.docxTemplateBase64.length * 0.75 / 1024)} KB
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs px-3 py-1.5 rounded-md bg-brand-500 text-white hover:bg-brand-600 transition-colors"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={handleRemoveTemplate}
                className="text-xs px-3 py-1.5 rounded-md border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
              >
                Revert to Default
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-on-surface-muted mb-3">
              No custom template uploaded. Using MeetingScribe's built-in format.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 text-sm font-medium rounded-md bg-brand-500 text-white hover:bg-brand-600 transition-colors"
            >
              Upload .docx Template
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".docx"
        onChange={handleFileUpload}
        className="hidden"
      />

      {error && (
        <div className="mb-4 p-3 rounded-md bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}

      {saved && (
        <p className="mb-4 text-sm text-green-600 font-medium">Template saved!</p>
      )}

      {/* Placeholder reference */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-on-surface mb-2">
          Available Placeholders
        </h3>
        <p className="text-xs text-on-surface-muted mb-3">
          Use these placeholders in your .docx template. MeetingScribe will replace
          them with actual meeting data when saving.
        </p>
        <div className="border border-surface-bright rounded-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-dim">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-on-surface">Placeholder</th>
                <th className="text-left px-3 py-2 font-medium text-on-surface">Description</th>
              </tr>
            </thead>
            <tbody>
              {TEMPLATE_PLACEHOLDERS.map((p) => (
                <tr key={p.name} className="border-t border-surface-bright">
                  <td className="px-3 py-1.5 font-mono text-brand-600">{p.name}</td>
                  <td className="px-3 py-1.5 text-on-surface-muted">{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* How to create a template */}
      <div className="mt-6 p-4 rounded-lg border border-surface-bright bg-surface-dim">
        <h3 className="text-sm font-semibold text-on-surface mb-2">
          How to Create a Template
        </h3>
        <ol className="text-xs text-on-surface-muted space-y-1 list-decimal list-inside">
          <li>Open Microsoft Word and create a new document</li>
          <li>Add your company header, logo, footer, and any boilerplate text</li>
          <li>Where meeting data should appear, type the placeholder (e.g., <code className="bg-surface px-1 rounded">{'{meetingTitle}'}</code>)</li>
          <li>Save as .docx and upload here</li>
          <li>MeetingScribe will merge meeting data into your template on every save</li>
        </ol>
      </div>
    </section>
  );
}
