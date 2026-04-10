/**
 * Word count display for the editor.
 */

interface WordCountProps {
  html: string;
}

export function WordCount({ html }: WordCountProps) {
  const count = countWords(html);
  return (
    <span className="text-xs text-on-surface-muted">
      {count} {count === 1 ? 'word' : 'words'}
    </span>
  );
}

/** Count words in an HTML string by stripping tags and splitting on whitespace. */
export function countWords(html: string): number {
  // Strip HTML tags
  const text = html.replace(/<[^>]*>/g, ' ');
  // Collapse whitespace and split
  const words = text.trim().split(/\s+/);
  // Filter empty strings
  return words.filter((w) => w.length > 0).length;
}
