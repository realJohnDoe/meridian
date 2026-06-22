import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useStore } from '@/store'
import { isTourDone, markTourDone } from './tourState'
import { Button } from '@/components/ui/button'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

interface Step {
  title: string
  body: string
  /** CSS selector for the highlight ring, or null for a free-floating popover. */
  target: string | null
  before?: () => Promise<void> | void
  /** Condition checked on each relevant state change to auto-advance. */
  autoAdvance?: 'route-changed' | 'editor-opened'
}

interface TargetRect { top: number; left: number; width: number; height: number }

interface Props {
  setSidebarOpen: (open: boolean) => void
  /** Navigate to the Agenda root (closes editor, clears search params). */
  navigateHome: () => void
  /** Deep-link the second tutorial entry in the editor. */
  openTourEntry: () => void
}

export default function CoachTour({ setSidebarOpen, navigateHome, openTourEntry }: Props) {
  const activeVaultId = useStore(s => s.activeVaultId)
  const pathname = useRouterState({ select: s => s.location.pathname })
  const editorParam = useRouterState({
    select: s => (s.location.search as Record<string, string | undefined>).editor,
  })

  const [active, setActive] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<TargetRect | null>(null)
  const [ready, setReady] = useState(false)

  const stepIndexRef = useRef(stepIndex)
  stepIndexRef.current = stepIndex

  const steps = useMemo<Step[]>(() => [
    {
      title: 'Welcome to Meridian',
      body: 'Meridian keeps your notes, events, and tasks as plain Markdown files in a folder you own. Let\'s take a quick look around.',
      target: '#mainTop',
      before: async () => {
        setSidebarOpen(false)
        navigateHome()
        await sleep(100)
      },
    },
    {
      title: 'Your Agenda',
      body: 'Dated events and tasks appear here, sorted by day. Scroll to travel through time — undated notes are reachable via the search bar.',
      target: '[data-tour="main-content"]',
      before: async () => {
        navigateHome()
        await sleep(100)
      },
    },
    {
      title: 'Switch views',
      body: 'Tap Agenda, Month, or Day to change how you see your calendar. Try switching — or tap Next to continue.',
      target: '[data-tour="nav-group"]',
      before: async () => {
        setSidebarOpen(true)
        await sleep(350)
      },
      autoAdvance: 'route-changed',
    },
    {
      title: 'Open an item',
      body: 'Tap any card to read or edit it. Each item opens an editor right here in the app.',
      target: '[data-tour="entry-card"]',
      before: async () => {
        setSidebarOpen(false)
        navigateHome()
        await sleep(200)
      },
      autoAdvance: 'editor-opened',
    },
    {
      title: 'The editor',
      body: 'Set the date, time, priority, tags, and body here. Type [[ to link another note. In your own vault, changes save automatically — this sandbox is read-only.',
      target: null,
      before: async () => {
        openTourEntry()
        await sleep(200)
      },
    },
    {
      title: 'Search & create',
      body: 'Type in the search bar to find any note, event, or task. Tap + to create something new. Try typing something — or tap Next.',
      target: '[data-tour="search-bar"]',
      before: async () => {
        navigateHome()
        await sleep(150)
      },
    },
    {
      title: 'Make it yours',
      body: 'This example vault is read-only. Tap Manage vaults to add a local folder — your notes stay as plain Markdown files you own, with no lock-in.',
      target: '[data-tour="manage-vaults"]',
      before: async () => {
        navigateHome()
        setSidebarOpen(true)
        await sleep(350)
      },
    },
  ], [setSidebarOpen, navigateHome, openTourEntry])

  // Start tour once on example vault (never again after Skip/Done)
  useEffect(() => {
    if (activeVaultId === 'example' && !isTourDone()) {
      setActive(true)
    }
  }, [activeVaultId])

  const advance = useCallback(() => {
    setStepIndex(i => i + 1)
    setReady(false)
  }, [])

  const back = useCallback(() => {
    setStepIndex(i => Math.max(0, i - 1))
    setReady(false)
  }, [])

  const dismiss = useCallback(() => {
    markTourDone()
    setActive(false)
    setSidebarOpen(false)
    navigateHome()
  }, [setSidebarOpen, navigateHome])

  // Run before() and measure target whenever step changes
  useEffect(() => {
    if (!active) return
    const currentStep = stepIndex
    setReady(false)
    setRect(null)

    const step = steps[currentStep]
    ;(async () => {
      await step.before?.()
      if (stepIndexRef.current !== currentStep) return
      await sleep(80)
      if (step.target) {
        const el = document.querySelector(step.target)
        if (el) {
          const r = el.getBoundingClientRect()
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
        }
      }
      setReady(true)
    })()

    const onResize = () => {
      if (!step.target) return
      const el = document.querySelector(step.target)
      if (el) {
        const r = el.getBoundingClientRect()
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [active, stepIndex, steps])

  // Auto-advance: user switched to a different view
  useEffect(() => {
    if (!active || !ready) return
    if (steps[stepIndex]?.autoAdvance === 'route-changed' && pathname !== '/') advance()
  }, [active, ready, pathname, stepIndex, steps, advance])

  // Auto-advance: user opened an entry in the editor
  useEffect(() => {
    if (!active || !ready) return
    if (steps[stepIndex]?.autoAdvance === 'editor-opened' && editorParam) advance()
  }, [active, ready, editorParam, stepIndex, steps, advance])

  if (!active) return null

  const step = steps[stepIndex]
  const isLast = stepIndex === steps.length - 1

  // ── Popover positioning ──────────────────────────────────────
  const W = 320
  const GAP = 10
  const SIDE = 16
  const POPOVER_H_EST = 210

  let popoverStyle: React.CSSProperties

  if (!rect) {
    popoverStyle = {
      position: 'fixed',
      bottom: 96,
      left: '50%',
      transform: 'translateX(-50%)',
      width: W,
      maxWidth: `calc(100vw - ${SIDE * 2}px)`,
    }
  } else {
    const bottom = rect.top + rect.height
    const centerX = rect.left + rect.width / 2
    const leftX = Math.max(SIDE, Math.min(centerX - W / 2, window.innerWidth - W - SIDE))
    if (bottom + GAP + POPOVER_H_EST < window.innerHeight) {
      popoverStyle = { position: 'fixed', top: bottom + GAP, left: leftX, width: W }
    } else if (rect.top - GAP - POPOVER_H_EST > 0) {
      popoverStyle = { position: 'fixed', bottom: window.innerHeight - rect.top + GAP, left: leftX, width: W }
    } else {
      popoverStyle = {
        position: 'fixed',
        bottom: 96,
        left: '50%',
        transform: 'translateX(-50%)',
        width: W,
        maxWidth: `calc(100vw - ${SIDE * 2}px)`,
      }
    }
  }

  return (
    <>
      {/* Popover card */}
      <div
        role="dialog"
        aria-label={`Tour: ${step.title}`}
        style={{ ...popoverStyle, zIndex: 9002 }}
        className="bg-card border border-border rounded-xl shadow-2xl p-4 flex flex-col gap-3"
      >
        {/* Header row */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            {stepIndex + 1} / {steps.length}
          </span>
          <button
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={dismiss}
            aria-label="Skip tour"
          >
            Skip
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-semibold text-foreground leading-snug">{step.title}</p>
          <p className="text-[13px] text-muted-foreground leading-relaxed">{step.body}</p>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-[13px] text-muted-foreground"
            onClick={back}
            disabled={stepIndex === 0}
          >
            ← Back
          </Button>
          <Button
            variant="brand"
            size="sm"
            className="h-8 px-4 text-[13px]"
            onClick={isLast ? dismiss : advance}
          >
            {isLast ? 'Done' : 'Next →'}
          </Button>
        </div>
      </div>
    </>
  )
}
