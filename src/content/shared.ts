/**
 * Shared utilities for content scripts (Google Calendar + Outlook).
 *
 * Both content scripts follow the same pattern:
 * 1. Detect when an event detail view is open (DOM selector or URL)
 * 2. Inject a "Take Notes" button into the event detail UI
 * 3. On click, send a message to the background service worker with event metadata
 * 4. Use MutationObserver to handle SPA navigation (both are SPAs)
 */

/** CSS class prefix to avoid collisions with the host page. */
export const CSS_PREFIX = 'meetingscribe';

/**
 * Create the "Take Notes" button element with consistent styling.
 * The button is styled inline to avoid needing a CSS file injected into the host page.
 */
export function createTakeNotesButton(onClick: () => void, eventId?: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = `${CSS_PREFIX}-take-notes-btn`;
  btn.textContent = '📝 Take Notes';
  btn.title = 'Open MeetingScribe to take notes on this meeting';
  if (eventId) btn.dataset.eventId = eventId;

  // Inline styles to avoid host page CSS conflicts
  Object.assign(btn.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: '500',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#ffffff',
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    lineHeight: '1',
    whiteSpace: 'nowrap',
    transition: 'background-color 0.15s',
  } satisfies Partial<CSSStyleDeclaration>);

  btn.addEventListener('mouseenter', () => {
    btn.style.backgroundColor = '#2563eb';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.backgroundColor = '#3b82f6';
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });

  return btn;
}

/**
 * Check if our button is already injected for a specific event.
 * Returns true only if the button exists AND matches the given event ID.
 */
export function isButtonInjectedForEvent(eventId: string): boolean {
  const btn = document.getElementById(`${CSS_PREFIX}-take-notes-btn`);
  return btn !== null && btn.dataset.eventId === eventId;
}

/**
 * Remove our button if it exists (e.g., when navigating away from an event).
 */
export function removeButton(): void {
  document.getElementById(`${CSS_PREFIX}-take-notes-btn`)?.remove();
}

/**
 * Send a message to the background service worker to open the notes window.
 */
export function sendOpenNotesMessage(eventData: {
  eventId: string;
  provider: 'google' | 'microsoft';
  title: string;
  startTime?: string;
  endTime?: string;
  organizer?: string;
  meetingLink?: string;
  attendeesJson?: string;
}): void {
  try {
    chrome.runtime.sendMessage({
      type: 'OPEN_NOTES',
      payload: eventData,
    }).catch(() => {
      showReloadMessage();
    });
  } catch {
    showReloadMessage();
  }
}

function showReloadMessage(): void {
  // Extension was updated/reloaded — the old content script is stale.
  alert('MeetingScribe was updated. Please reload this page (F5) to reconnect.');
}

/**
 * Create a MutationObserver that watches for DOM changes and calls a callback.
 * Debounced to avoid excessive calls during rapid DOM updates.
 */
export function createDebouncedObserver(
  callback: () => void,
  debounceMs = 300,
): MutationObserver {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(callback, debounceMs);
  });

  return observer;
}
