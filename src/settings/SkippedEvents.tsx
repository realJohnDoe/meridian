import type { SkippedEvent } from '@/vaultActions'

/**
 * The events a calendar left out because their repeat rule has no form in
 * Meridian's model, each with the rule itself — enough to tell which events
 * are missing and why, without opening the .ics file.
 */
export function SkippedEvents({ events }: { events: readonly SkippedEvent[] }) {
  if (events.length === 0) return null
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        {events.length} {events.length === 1 ? 'event' : 'events'} left out: repeat rule Meridian can’t express
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1">
        {events.map(e => (
          <li key={e.uid}>
            <span className="font-medium">{e.title}</span>{' '}
            <code className="break-all text-muted-foreground">{e.rrule}</code>
          </li>
        ))}
      </ul>
    </details>
  )
}
