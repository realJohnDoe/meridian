import { useState } from 'react'
import { HardDrive, GitBranch, CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import {
  addLocalVault, addIcalVault, startGitHubSignIn, isFolderPickerSupported,
  previewIcalFeed,
} from '@/vaultActions'
import {
  ResponsiveModalTitle,
} from '@/components/primitives/responsive-modal'

type WizardStep = 'source' | 'github' | 'ical'
type Source = 'local' | 'github' | 'ical'

const SOURCE_CARDS: { id: Source; Icon: typeof HardDrive; title: string; desc: string }[] = [
  {
    id:    'github',
    Icon:  GitBranch,
    title: 'GitHub repository',
    desc:  'Sign in with GitHub. Works on any device and browser.',
  },
  {
    id:    'local',
    Icon:  HardDrive,
    title: 'Local folder',
    desc:  'Use a folder on this device. Works in Chrome or Edge, desktop or Android; not available in Safari or Firefox.',
  },
  {
    id:    'ical',
    Icon:  CalendarDays,
    title: 'Calendar subscription',
    desc:  'Paste an iCal address from Google, Outlook, Apple or anywhere else. Read-only — its events appear alongside your own.',
  },
]

interface Props {
  onClose: () => void
  onBack:  () => void
}

const localFolderSupported = isFolderPickerSupported()
const availableSourceCards = localFolderSupported
  ? SOURCE_CARDS
  : SOURCE_CARDS.filter(c => c.id !== 'local')

/** What the validate step learned about a pasted feed URL. */
interface FeedPreview {
  name?:      string
  eventCount: number
}

export function AddVaultWizard({ onClose, onBack }: Props) {
  const [step,      setStep]      = useState<WizardStep>('source')
  const [source,    setSource]    = useState<Source>('github')
  const [signingIn, setSigningIn] = useState(false)

  const [feedUrl,   setFeedUrl]   = useState('')
  const [feedName,  setFeedName]  = useState('')
  const [checking,  setChecking]  = useState(false)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [preview,   setPreview]   = useState<FeedPreview | null>(null)

  async function handleSignIn() {
    setSigningIn(true)
    await startGitHubSignIn() // full-page redirect — component unmounts
  }

  async function handleNext() {
    if (source === 'local') {
      onClose()
      await addLocalVault()
    } else if (source === 'ical') {
      setStep('ical')
    } else {
      setStep('github')
    }
  }

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
      setFeedError(e instanceof Error ? e.message : 'Could not read that calendar.')
    } finally {
      setChecking(false)
    }
  }

  async function handleAddFeed() {
    onClose()
    await addIcalVault(feedUrl.trim(), feedName.trim() || 'Calendar')
  }

  if (step === 'source') {
    return (
      <>
        <ResponsiveModalTitle>Add vault</ResponsiveModalTitle>

        <div className="flex flex-col gap-3 p-4">
          {availableSourceCards.map(({ id, Icon, title, desc }) => (
            <button
              key={id}
              onClick={() => setSource(id)}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                source === id
                  ? 'border-primary bg-primary/8'
                  : 'border-border hover:bg-accent',
              )}
            >
              <Icon className="mt-0.5 size-4.5 shrink-0 stroke-[1.7]" />
              <div>
                <div className="text-sm font-medium leading-snug">{title}</div>
                <div className="mt-1 text-xs text-muted-foreground leading-snug">{desc}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-between px-4 pb-4">
          <Button variant="ghost" onClick={onBack}>Back</Button>
          <Button onClick={handleNext}>
            {source === 'local' ? 'Choose folder' : 'Next'}
          </Button>
        </div>
      </>
    )
  }

  if (step === 'ical') {
    return (
      <>
        <ResponsiveModalTitle>Subscribe to a calendar</ResponsiveModalTitle>

        <div className="flex flex-col gap-3 p-4">
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
            </div>
          )}

          {preview && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input value={feedName} onChange={e => { setFeedName(e.target.value) }} />
            </label>
          )}
        </div>

        <div className="flex justify-between px-4 pb-4">
          <Button variant="ghost" onClick={() => { setStep('source') }} disabled={checking}>Back</Button>
          {preview
            ? <Button onClick={() => void handleAddFeed()}>Add calendar</Button>
            : (
              <Button onClick={() => void handleCheckFeed()} disabled={checking || feedUrl.trim().length === 0}>
                {checking ? 'Checking…' : 'Check calendar'}
              </Button>
            )}
        </div>
      </>
    )
  }

  return (
    <>
      <ResponsiveModalTitle>Connect GitHub repository</ResponsiveModalTitle>

      <div className="flex flex-col gap-3 p-4">
        <Button onClick={handleSignIn} disabled={signingIn}>
          {signingIn ? 'Redirecting to GitHub…' : 'Sign in with GitHub'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Choose which repository to connect after signing in.
        </p>
      </div>

      <div className="flex justify-between px-4 pb-4">
        <Button variant="ghost" onClick={() => { setStep('source') }} disabled={signingIn}>Back</Button>
      </div>
    </>
  )
}
