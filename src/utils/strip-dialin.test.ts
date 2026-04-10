import { extractDialIn, stripDialInFromDescription } from './strip-dialin';

describe('extractDialIn', () => {
  it('returns undefined for empty input', () => {
    expect(extractDialIn()).toBeUndefined();
    expect(extractDialIn('', '')).toBeUndefined();
  });

  it('detects Zoom URLs', () => {
    const result = extractDialIn(
      'Join our meeting: https://us02web.zoom.us/j/123456789?pwd=abc',
    );
    expect(result?.platform).toBe('zoom');
    expect(result?.url).toContain('zoom.us');
  });

  it('detects Google Meet URLs', () => {
    const result = extractDialIn(undefined, 'https://meet.google.com/abc-defg-hij');
    expect(result?.platform).toBe('meet');
    expect(result?.url).toContain('meet.google.com');
  });

  it('detects Microsoft Teams URLs', () => {
    const result = extractDialIn(
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc',
    );
    expect(result?.platform).toBe('teams');
  });

  it('detects WebEx URLs', () => {
    const result = extractDialIn('https://company.webex.com/meet/john.doe');
    expect(result?.platform).toBe('webex');
  });

  it('detects SIP URIs', () => {
    const result = extractDialIn('sip:123456@sip.example.com');
    expect(result?.platform).toBe('other');
    expect(result?.url).toContain('sip:');
  });

  it('detects phone numbers near dial-in keywords', () => {
    const result = extractDialIn('Dial in: +1 (555) 123-4567, PIN: 12345');
    expect(result?.platform).toBe('other');
    expect(result?.raw).toContain('555');
  });

  it('ignores phone numbers without dial-in context', () => {
    const result = extractDialIn('Contact John at 555-123-4567 for questions');
    expect(result).toBeUndefined();
  });

  it('prefers conferencing URLs in description over location', () => {
    const result = extractDialIn(
      'https://meet.google.com/xyz-abc-def',
      'Conference Room B',
    );
    expect(result?.platform).toBe('meet');
  });
});

describe('stripDialInFromDescription', () => {
  it('removes Zoom URLs from description', () => {
    const input = 'Discussion topics\nhttps://us02web.zoom.us/j/123\nPlease review docs';
    const cleaned = stripDialInFromDescription(input);
    expect(cleaned).not.toContain('zoom.us');
    expect(cleaned).toContain('Discussion topics');
    expect(cleaned).toContain('Please review docs');
  });

  it('removes Google Meet URLs', () => {
    const input = 'Standup call\nhttps://meet.google.com/abc-def-ghi\n';
    const cleaned = stripDialInFromDescription(input);
    expect(cleaned).not.toContain('meet.google.com');
    expect(cleaned).toContain('Standup call');
  });

  it('returns clean text when no conferencing info present', () => {
    const input = 'Just a regular description';
    expect(stripDialInFromDescription(input)).toBe(input);
  });

  it('collapses excess whitespace after stripping', () => {
    const input = 'Line 1\n\n\n\n\nLine 2';
    const cleaned = stripDialInFromDescription(input);
    expect(cleaned).toBe('Line 1\n\nLine 2');
  });
});
