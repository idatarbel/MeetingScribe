/**
 * Notes Template editor — lets users customize the default template
 * that appears when opening Take Notes on a new meeting.
 *
 * Uses the same Tiptap editor as the notes window.
 * Changes are saved to chrome.storage.local and used by all new meetings.
 */

import { useState, useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import CodeBlock from '@tiptap/extension-code-block';
import Placeholder from '@tiptap/extension-placeholder';
import type { ExtensionSettings } from '@/types';
import { STORAGE_KEYS, defaultSettings } from '@/types';

const DEFAULT_TEMPLATE = `<h2>Agenda</h2>
<ul><li></li></ul>
<h2>Notes</h2>
<p></p>
<h2>Action Items</h2>
<ul><li></li></ul>`;

export function NotesTemplate() {
  const [saved, setSaved] = useState(false);
  const [templateHtml, setTemplateHtml] = useState(DEFAULT_TEMPLATE);
  const [loaded, setLoaded] = useState(false);

  // Load saved template
  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS.SETTINGS).then((result) => {
      const settings = (result[STORAGE_KEYS.SETTINGS] as ExtensionSettings) ?? defaultSettings();
      if (settings.noteTemplate) {
        setTemplateHtml(settings.noteTemplate);
      }
      setLoaded(true);
    });
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Link.configure({ openOnClick: false }),
      CodeBlock,
      Placeholder.configure({ placeholder: 'Design your meeting notes template...' }),
    ],
    content: templateHtml,
    onUpdate: ({ editor: ed }) => {
      setTemplateHtml(ed.getHTML());
      setSaved(false);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-[300px] focus:outline-none p-4 text-on-surface',
      },
    },
  });

  // Update editor when template loads from storage
  useEffect(() => {
    if (editor && loaded && !editor.isDestroyed) {
      const current = editor.getHTML();
      if (current !== templateHtml) {
        editor.commands.setContent(templateHtml);
      }
    }
  }, [editor, loaded, templateHtml]);

  const handleSave = useCallback(async () => {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    const settings = (result[STORAGE_KEYS.SETTINGS] as ExtensionSettings) ?? defaultSettings();
    settings.noteTemplate = templateHtml;
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }, [templateHtml]);

  const handleReset = useCallback(() => {
    setTemplateHtml(DEFAULT_TEMPLATE);
    editor?.commands.setContent(DEFAULT_TEMPLATE);
    setSaved(false);
  }, [editor]);

  const toggleBold = useCallback(() => { editor?.chain().focus().toggleBold().run(); }, [editor]);
  const toggleItalic = useCallback(() => { editor?.chain().focus().toggleItalic().run(); }, [editor]);
  const toggleH2 = useCallback(() => { editor?.chain().focus().toggleHeading({ level: 2 }).run(); }, [editor]);
  const toggleH3 = useCallback(() => { editor?.chain().focus().toggleHeading({ level: 3 }).run(); }, [editor]);
  const toggleBullet = useCallback(() => { editor?.chain().focus().toggleBulletList().run(); }, [editor]);
  const toggleOrdered = useCallback(() => { editor?.chain().focus().toggleOrderedList().run(); }, [editor]);
  const insertHr = useCallback(() => { editor?.chain().focus().setHorizontalRule().run(); }, [editor]);

  if (!editor) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold text-on-surface mb-2">Notes Template</h2>
      <p className="text-sm text-on-surface-muted mb-4">
        Customize the default template for new meeting notes. Changes apply to all new meetings
        opened after saving. Existing notes are not affected.
      </p>

      {/* Toolbar */}
      <div className="border border-surface-bright rounded-t-lg">
        <div className="flex flex-wrap gap-1 p-2 border-b border-surface-bright bg-surface-dim">
          <TBtn onClick={toggleBold} active={editor.isActive('bold')} title="Bold"><strong>B</strong></TBtn>
          <TBtn onClick={toggleItalic} active={editor.isActive('italic')} title="Italic"><em>I</em></TBtn>
          <span className="w-px h-6 bg-surface-bright self-center mx-1" />
          <TBtn onClick={toggleH2} active={editor.isActive('heading', { level: 2 })} title="Heading 2">H2</TBtn>
          <TBtn onClick={toggleH3} active={editor.isActive('heading', { level: 3 })} title="Heading 3">H3</TBtn>
          <span className="w-px h-6 bg-surface-bright self-center mx-1" />
          <TBtn onClick={toggleBullet} active={editor.isActive('bulletList')} title="Bullet List">&bull;</TBtn>
          <TBtn onClick={toggleOrdered} active={editor.isActive('orderedList')} title="Numbered List">1.</TBtn>
          <TBtn onClick={insertHr} active={false} title="Horizontal Rule">&mdash;</TBtn>
        </div>

        {/* Editor */}
        <EditorContent editor={editor} />
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 text-sm font-medium rounded-md bg-brand-500 text-white hover:bg-brand-600 transition-colors"
        >
          Save Template
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="px-4 py-2 text-sm rounded-md border border-surface-bright text-on-surface hover:bg-surface-dim transition-colors"
        >
          Reset to Default
        </button>
        {saved && (
          <span className="text-sm text-green-600 font-medium">Template saved!</span>
        )}
      </div>

      <p className="mt-3 text-xs text-on-surface-muted">
        Tip: Use H2 headings for section titles (Agenda, Notes, Action Items).
        Add bullet lists for items. The template is used as the starting content
        when no existing notes are found in the cloud.
      </p>
    </section>
  );
}

function TBtn({ onClick, active, title, children }: {
  onClick: () => void; active: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`px-2 py-1 text-xs rounded-sm font-medium transition-colors ${
        active ? 'bg-brand-500 text-white' : 'bg-surface text-on-surface-muted hover:bg-surface-bright hover:text-on-surface'
      }`}
    >{children}</button>
  );
}
