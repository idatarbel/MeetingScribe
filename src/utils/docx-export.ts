/**
 * Convert Tiptap HTML to a real OOXML .docx file using the `docx` library.
 *
 * Produces a valid .docx that Word Online, Google Docs, and desktop Word
 * can all open and edit natively.
 */

import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  // AlignmentType removed — no longer used after HR fix
  Packer,
  ExternalHyperlink,
  ImageRun,
} from 'docx';

/**
 * Convert HTML content to a .docx ArrayBuffer.
 */
/**
 * Convert HTML content to a base64-encoded .docx string.
 * Uses Packer.toBase64String() which works in both browser and Node.js.
 */
export async function htmlToDocxBase64(html: string, title: string): Promise<string> {
  const children = parseHtmlToDocxElements(html);

  const doc = new Document({
    creator: 'MeetingScribe',
    title,
    description: `Meeting notes: ${title}`,
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,    // 1 inch in twips
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children,
      },
    ],
  });

  // toBase64String works in both browser and Node.js
  return Packer.toBase64String(doc);
}

// ---------------------------------------------------------------------------
// HTML → docx element parser
// ---------------------------------------------------------------------------

function parseHtmlToDocxElements(html: string): Paragraph[] {
  // Use DOMParser to parse the HTML string
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const elements: Paragraph[] = [];

  for (const node of doc.body.childNodes) {
    const paras = nodeToDocxParagraphs(node);
    elements.push(...paras);
  }

  // If no content was generated, add an empty paragraph
  if (elements.length === 0) {
    elements.push(new Paragraph({}));
  }

  return elements;
}

function nodeToDocxParagraphs(node: Node): Paragraph[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (!text.trim()) return [];
    return [new Paragraph({ children: [new TextRun(text)] })];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case 'h1':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: inlineChildren(el),
          spacing: { before: 240, after: 120 },
        }),
      ];
    case 'h2':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: inlineChildren(el),
          spacing: { before: 200, after: 80 },
        }),
      ];
    case 'h3':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: inlineChildren(el),
          spacing: { before: 160, after: 60 },
        }),
      ];
    case 'p':
      return [
        new Paragraph({
          children: inlineChildren(el),
          spacing: { before: 60, after: 60 },
        }),
      ];
    case 'ul':
      return listItems(el, false);
    case 'ol':
      return listItems(el, true);
    case 'hr':
      return [
        new Paragraph({
          children: [],
          spacing: { before: 200, after: 200 },
          border: {
            bottom: { style: 'single' as const, size: 6, color: 'cccccc', space: 1 },
          },
        }),
      ];
    case 'pre':
      return [
        new Paragraph({
          children: [
            new TextRun({
              text: el.textContent ?? '',
              font: 'Consolas',
              size: 20,
            }),
          ],
          spacing: { before: 100, after: 100 },
        }),
      ];
    case 'blockquote': {
      const paras: Paragraph[] = [];
      for (const child of el.childNodes) {
        const childParas = nodeToDocxParagraphs(child);
        for (const p of childParas) {
          paras.push(p);
        }
      }
      return paras;
    }
    case 'img':
      return handleImage(el);
    case 'br':
      return [new Paragraph({})];
    case 'div':
    case 'section':
    case 'article':
    case 'main': {
      // Block containers — recurse into children
      const result: Paragraph[] = [];
      for (const child of el.childNodes) {
        result.push(...nodeToDocxParagraphs(child));
      }
      return result;
    }
    default: {
      // Unknown block element — treat as paragraph
      const children = inlineChildren(el);
      if (children.length === 0) return [];
      return [new Paragraph({ children })];
    }
  }
}

function inlineChildren(el: HTMLElement): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];

  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text) {
        runs.push(new TextRun({ text }));
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement;
      const childTag = childEl.tagName.toLowerCase();

      switch (childTag) {
        case 'strong':
        case 'b':
          runs.push(
            ...flatTextRuns(childEl, { bold: true }),
          );
          break;
        case 'em':
        case 'i':
          runs.push(
            ...flatTextRuns(childEl, { italics: true }),
          );
          break;
        case 'code':
          runs.push(
            new TextRun({
              text: childEl.textContent ?? '',
              font: 'Consolas',
              size: 20,
            }),
          );
          break;
        case 'a': {
          const href = childEl.getAttribute('href') ?? '';
          const linkText = childEl.textContent ?? href;
          runs.push(
            new ExternalHyperlink({
              link: href,
              children: [
                new TextRun({
                  text: linkText,
                  color: '3B82F6',
                  underline: { type: 'single' },
                }),
              ],
            }),
          );
          break;
        }
        case 'br':
          runs.push(new TextRun({ break: 1 }));
          break;
        default:
          // Unknown inline — just extract text
          runs.push(new TextRun({ text: childEl.textContent ?? '' }));
          break;
      }
    }
  }

  return runs;
}

function flatTextRuns(
  el: HTMLElement,
  style: { bold?: boolean; italics?: boolean },
): TextRun[] {
  const text = el.textContent ?? '';
  if (!text) return [];
  return [new TextRun({ text, ...style })];
}

function listItems(listEl: HTMLElement, _ordered: boolean): Paragraph[] {
  const items: Paragraph[] = [];
  const lis = listEl.querySelectorAll(':scope > li');

  for (const li of lis) {
    const text = li.textContent ?? '';
    items.push(
      new Paragraph({
        children: [
          new TextRun({ text: `\u2022  ${text}` }), // bullet character
        ],
        indent: { left: 720 }, // 0.5 inch indent
        spacing: { before: 40, after: 40 },
      }),
    );
  }

  return items;
}

function handleImage(el: HTMLElement): Paragraph[] {
  const src = el.getAttribute('src') ?? '';

  // Base64 images — extract and embed
  if (src.startsWith('data:image/')) {
    try {
      const [header, b64Data] = src.split(',');
      if (!b64Data || !header) return [];

      const binaryStr = atob(b64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Default size — scale based on typical page width
      const width = Math.min(
        parseInt(el.getAttribute('width') ?? '500', 10),
        500,
      );
      const height = parseInt(el.getAttribute('height') ?? '300', 10);

      return [
        new Paragraph({
          children: [
            new ImageRun({
              data: bytes,
              transformation: { width, height },
              type: 'png',
            }),
          ],
          spacing: { before: 100, after: 100 },
        }),
      ];
    } catch {
      return [
        new Paragraph({
          children: [new TextRun({ text: '[Image]', italics: true, color: '999999' })],
        }),
      ];
    }
  }

  // External URL images — can't embed, show as link
  return [
    new Paragraph({
      children: [
        new ExternalHyperlink({
          link: src,
          children: [
            new TextRun({
              text: `[Image: ${src}]`,
              color: '3B82F6',
              underline: { type: 'single' },
            }),
          ],
        }),
      ],
    }),
  ];
}
