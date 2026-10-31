import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { HardDrive, GitBranch, CalendarDays, BookOpen } from 'lucide-react'
import { Button } from '@/components/primitives/button'
import { cn } from '@/lib/cn'
import { useStore } from '@/store'
import { addLocalVault, addExampleVault, isFolderPickerSupported } from '@/vaultActions'
import IcalStep from './IcalStep'
import GithubStep from './GithubStep'

type WizardStep = 'source' | 'github' | 'ical'
type Source = 'local' | 'github' | 'ical' | 'example'

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

const TUTORIAL_CARD: { id: Source; Icon: typeof HardDrive; title: string; desc: string } = {
  id:    'example',
  Icon:  BookOpen,
  title: 'Tutorial vault',
  desc:  'Sample notes that show how Meridian works. Safe to remove once you have a vault of your own.',
}

/**
 * Adding a vault, on its own screen.
 *
 * It was previously a second `step` of the settings modal, which meant a
 * multi-step flow nested inside a surface already showing another one. As a
 * route it gets the room its source cards want, a real back button, and its
 * own entry in history — so a half-finished iCal subscription survives the
 * back gesture instead of dismissing the whole of Settings.
 */
export default function AddVaultWizard() {
  const navigate = useNavigate()

  const [step,   setStep]   = useState<WizardStep>('source')
  const [source, setSource] = useState<Source>('github')

  // Read from the store rather than taken as a prop: the wizard is now reached
  // by URL, so there is no parent left to compute it.
  const offerTutorial = useStore(s => !s.vaults.some(v => v.kind === 'example'))

  // Probed here rather than at module scope: the settings barrel is imported by
  // tests that never mount this screen, and a top-level `window` probe makes
  // merely importing the module a side effect.
  const available = isFolderPickerSupported() ? SOURCE_CARDS : SOURCE_CARDS.filter(c => c.id !== 'local')
  const sourceCards = offerTutorial ? [...available, TUTORIAL_CARD] : available

  const done = () => void navigate({ to: '/settings' })

  async function handleNext() {
    if (source === 'local') {
      done()
      await addLocalVault()
    } else if (source === 'example') {
      done()
      await addExampleVault()
    } else if (source === 'ical') {
      setStep('ical')
    } else {
      setStep('github')
    }
  }

  if (step === 'ical') return <IcalStep onBack={() => { setStep('source') }} onDone={done} />
  if (step === 'github') return <GithubStep onBack={() => { setStep('source') }} onDone={done} />

    return (
      <div className="flex flex-col gap-5">
        <p className="px-1 text-xs text-muted-foreground">
          Pick where this vault&rsquo;s entries live. You can add more later.
        </p>

        <div className="flex flex-col gap-3">
          {sourceCards.map(({ id, Icon, title, desc }) => (
            <button
              key={id}
              type="button"
              aria-pressed={source === id}
              onClick={() => setSource(id)}
              className={cn(
                'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                source === id
                  ? 'border-primary bg-primary/8'
                  : 'border-border hover:bg-accent',
              )}
            >
              <Icon className="mt-0.5 size-4.5 shrink-0 stroke-[1.7]" />
              <div>
                <div className="text-sm font-medium leading-snug">{title}</div>
                <div className="mt-1 text-xs leading-snug text-muted-foreground">{desc}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <Button onClick={handleNext}>
            {source === 'local' ? 'Choose folder' : source === 'example' ? 'Add' : 'Next'}
          </Button>
        </div>
      </div>
    )
}
