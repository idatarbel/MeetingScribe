/**
 * Convert a binary string (from atob) to a Blob for upload.
 * Uses Blob instead of Uint8Array because TypeScript's fetch BodyInit
 * doesn't always include Uint8Array in all type configurations.
 */
export function binaryStringToBlob(binaryStr: string, mimeType?: string): Blob {
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Check if a MIME type represents binary content.
 */
export function isBinaryMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith('application/vnd.') ||
    mimeType.startsWith('application/octet') ||
    mimeType.startsWith('image/')
  );
}
