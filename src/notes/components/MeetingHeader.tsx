/**
 * Meeting metadata header shown above the editor.
 * Displays title, date/time, attendees, and conferencing link.
 */

interface MeetingHeaderProps {
  title: string;
  startTime?: string;
  endTime?: string;
  organizer?: string;
  attendees?: Array<{ name?: string; email: string }>;
  meetingLink?: string;
}

export function MeetingHeader({
  title,
  startTime,
  endTime,
  organizer,
  attendees,
  meetingLink,
}: MeetingHeaderProps) {
  const dateStr = formatTimeRange(startTime, endTime);

  return (
    <div className="border-b border-surface-bright pb-4 mb-4">
      <h1 className="text-xl font-bold text-on-surface">{title}</h1>

      {dateStr && (
        <p className="mt-1 text-sm text-on-surface-muted">{dateStr}</p>
      )}

      {organizer && (
        <p className="mt-1 text-sm text-on-surface-muted">
          <span className="font-medium">Organizer:</span> {organizer}
        </p>
      )}

      {meetingLink && (
        <p className="mt-1 text-sm">
          <a
            href={meetingLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-500 hover:text-brand-600 underline"
          >
            Join Meeting
          </a>
        </p>
      )}

      {attendees && attendees.length > 0 && (() => {
        // Deduplicate by email (API may return organizer as both organizer + attendee)
        const seen = new Set<string>();
        const unique = attendees.filter((a) => {
          const key = a.email.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return (
        <div className="mt-2">
          <p className="text-xs font-medium text-on-surface-muted uppercase tracking-wide">
            Attendees ({unique.length})
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {unique.map((a) => (
              <span
                key={a.email}
                className="inline-block px-2 py-0.5 text-xs bg-surface-bright text-on-surface-muted rounded-sm"
                title={a.email}
              >
                {a.name ?? a.email}
              </span>
            ))}
          </div>
        </div>
        );
      })()}
    </div>
  );
}

function formatTimeRange(start?: string, end?: string): string | null {
  if (!start) return null;

  const startDate = new Date(start);
  const datePart = startDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const startTime = startDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  if (!end) return `${datePart} at ${startTime}`;

  const endDate = new Date(end);
  const endTime = endDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `${datePart}, ${startTime} – ${endTime}`;
}
