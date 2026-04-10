export function App() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] bg-surface p-6">
      <h1 className="text-xl font-bold text-on-surface">MeetingScribe</h1>
      <p className="mt-2 text-sm text-on-surface-muted">
        Your meeting notes, organized automatically.
      </p>
      <div className="mt-4 px-3 py-1.5 rounded-md bg-brand-500 text-white text-xs font-medium">
        v0.0.1
      </div>
    </div>
  );
}
