import { useState } from 'react'
import { HardDrive, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { addLocalVault, startGitHubSignIn, isFolderPickerSupported } from '@/vaultActions'
import {
  ResponsiveModalTitle,
} from '@/components/primitives/responsive-modal'

type WizardStep = 'source' | 'github'
type Source = 'local' | 'github'

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
]

interface Props {
  onClose: () => void
  onBack:  () => void
}

const localFolderSupported = isFolderPickerSupported()
const availableSourceCards = localFolderSupported
  ? SOURCE_CARDS
  : SOURCE_CARDS.filter(c => c.id !== 'local')

export function AddVaultWizard({ onClose, onBack }: Props) {
  const [step,      setStep]      = useState<WizardStep>('source')
  const [source,    setSource]    = useState<Source>('github')
  const [signingIn, setSigningIn] = useState(false)

  async function handleSignIn() {
    setSigningIn(true)
    await startGitHubSignIn() // full-page redirect — component unmounts
  }

  async function handleNext() {
    if (source === 'local') {
      onClose()
      await addLocalVault()
    } else {
      setStep('github')
    }
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
        <Button variant="ghost" onClick={() => setStep('source')} disabled={signingIn}>Back</Button>
      </div>
    </>
  )
}
