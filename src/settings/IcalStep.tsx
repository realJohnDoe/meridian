import { useState } from 'react'
import { Button } from '@/components/primitives/button'
import { Input } from '@/components/ui/input'
import { addIcalVault, previewIcalFeed, type SkippedEvent } from '@/vaultActions'
import { SkippedEvents } from './SkippedEvents'

/** What the validate step learned about a pasted feed URL. */
interface FeedPreview {
  name?:      string
  eventCount: number
  skipped:    SkippedEvent[]
}

/** The calendar-subscription step of the add-vault wizard. */
export default function IcalStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [feedUrl,   setFeedUrl]   = useState('')
  const [feedName,  setFeedName]  = useState('')
  const [checking,  setChecking]  = useState(false)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [preview,   setPreview]   = useState<FeedPreview | null>(null)

  /**
   * Fetch the feed and show what it holds *before* the vault is created. A
   * mistyped secret address is otherwise indistinguishable from an empty
   * calendar, and the fix — remove the vault, re-add it — is far more work than
   * correcting the field here.
   */
  async function handleCheckFeed() {
    setChecking(true)
    setFeedError(null)
    setPreview(null)
    try {
      const result = await previewIcalFeed(feedUrl.trim())
      setPreview(result)
      // Seed the name from X-WR-CALNAME, but leave it editable: it is also what
      // the vault's id (and therefore its entry URLs) is derived from.
      setFeedName(current => current.trim().length > 0 ? current : result.name ?? 'Calendar')
    } catch (e) {
      setFeedError(e instanceof TypeError ? "Couldn't reach that address — check it's an iCal (.ics) link." : e instanceof Error ? e.message : 'Could not read that calendar.')
    }
    setChecking(false)
  }

  async function handleAddFeed() {
    onDone()
    await addIcalVault(feedUrl.trim(), feedName.trim() || 'Calendar')
  }

    return (
      <div className="flex flex-col gap-4">
        <h2 className="px-1 text-sm font-semibold text-foreground">Subscribe to a calendar</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Calendar address</span>
          <Input
            value={feedUrl}
            onChange={e => { setFeedUrl(e.target.value); setPreview(null); setFeedError(null) }}
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          In Google Calendar this is <em>Settings → Integrate calendar → Secret address in iCal
          format</em>; in Outlook, <em>Publish a calendar → ICS</em>. Treat it like a password —
          anyone with the link can read the calendar.
        </p>
        <p className="text-xs text-muted-foreground">
          Meridian fetches the calendar through its own server, because calendar providers
          don&rsquo;t allow browsers to read these addresses directly. The address and its events
          pass through that server; nothing is stored there.
        </p>

        {feedError && <p className="text-xs text-destructive">{feedError}</p>}

        {preview && (
          <div className="rounded-lg border border-border p-3 text-xs">
            <p className="font-medium">{preview.name ?? 'Calendar'}</p>
            <p className="text-muted-foreground">
              {preview.eventCount} {preview.eventCount === 1 ? 'event' : 'events'} found
            </p>
            <SkippedEvents events={preview.skipped} />
          </div>
        )}

        {preview && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input value={feedName} onChange={e => { setFeedName(e.target.value) }} />
          </label>
        )}

        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack} disabled={checking}>Back</Button>
          {preview
            ? <Button onClick={() => void handleAddFeed()}>Add calendar</Button>
            : (
              <Button onClick={() => void handleCheckFeed()} disabled={checking || feedUrl.trim().length === 0}>
                {checking ? 'Checking…' : 'Check calendar'}
              </Button>
            )}
        </div>
      </div>
    )
}
