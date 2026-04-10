/**
 * Strip dial-in / conferencing information from calendar event text.
 *
 * Detects Zoom, Google Meet, Microsoft Teams, WebEx, and generic SIP/tel: URIs
 * in event descriptions and locations. Returns structured DialInInfo.
 */

import type { DialInInfo } from '@/types';

/** Known conferencing URL patterns. */
const CONFERENCE_PATTERNS: Array<{
  platform: DialInInfo['platform'];
  regex: RegExp;
}> = [
  { platform: 'zoom', regex: /https?:\/\/[\w.-]*zoom\.us\/[jw]\/\S+/i },
  { platform: 'meet', regex: /https?:\/\/meet\.google\.com\/[\w-]+/i },
  { platform: 'teams', regex: /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/\S+/i },
  { platform: 'webex', regex: /https?:\/\/[\w.-]*\.webex\.com\/\S+/i },
];

/** Generic dial-in patterns (phone numbers, SIP URIs). */
const PHONE_PATTERN = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;
const SIP_PATTERN = /sip:\S+/i;
const TEL_PATTERN = /tel:\S+/i;

/**
 * Extract dial-in / conferencing info from event description and location.
 * Returns undefined if no conferencing info is found.
 */
export function extractDialIn(
  description?: string,
  location?: string,
): DialInInfo | undefined {
  const combined = [description ?? '', location ?? ''].join(' ');
  if (!combined.trim()) return undefined;

  // Check for known conferencing platforms first
  for (const { platform, regex } of CONFERENCE_PATTERNS) {
    const match = combined.match(regex);
    if (match) {
      return {
        raw: match[0],
        platform,
        url: match[0],
      };
    }
  }

  // Check for SIP / tel URIs
  const sipMatch = combined.match(SIP_PATTERN) ?? combined.match(TEL_PATTERN);
  if (sipMatch) {
    return {
      raw: sipMatch[0],
      platform: 'other',
      url: sipMatch[0],
    };
  }

  // Check for phone numbers (only if they look like conference dial-ins)
  // Heuristic: phone number near words like "dial", "join", "call", "pin", "passcode"
  const hasDialKeyword = /\b(dial|join|call|pin|passcode|access\s*code|conference)\b/i.test(
    combined,
  );
  if (hasDialKeyword) {
    const phones = combined.match(PHONE_PATTERN);
    if (phones && phones.length > 0) {
      return {
        raw: phones[0],
        platform: 'other',
      };
    }
  }

  return undefined;
}

/**
 * Remove dial-in / conferencing boilerplate from a description string.
 * Returns the cleaned description with conferencing blocks stripped.
 */
export function stripDialInFromDescription(description: string): string {
  let cleaned = description;

  // Remove entire conferencing blocks (Zoom, Meet, Teams, WebEx)
  // These typically appear as multi-line blocks with URLs and phone numbers.
  // Pattern: lines containing conferencing URLs and surrounding context.
  for (const { regex } of CONFERENCE_PATTERNS) {
    cleaned = cleaned.replace(regex, '');
  }

  // Remove common conferencing boilerplate lines
  const boilerplatePatterns = [
    /[-─]{3,}[\s\S]*?(?:join|dial|call)[\s\S]*?[-─]{3,}/gi,
    /(?:join|dial in)[\s\S]*?(?:meeting\s*id|passcode|pin)[\s\S]*?\n/gi,
    /(?:one\s*tap\s*mobile|find\s*your\s*local\s*number).*\n?/gi,
  ];

  for (const pattern of boilerplatePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Collapse excess whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}
