import { useTheme } from 'next-themes'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { THEMES, SWATCH_CLASSES } from './themes'

/**
 * The theme picker, on a screen of its own.
 *
 * It earns the screen: ten preview cards are the tallest control in Settings,
 * and they are only meaningful at a size where the swatches read. Inlined,
 * they had to be folded behind a collapsible that was shut by default — which
 * is the same as not showing them, at the cost of a control that hid them.
 */
export default function AppearanceSettings() {
  const { theme, setTheme, systemTheme } = useTheme()
  const activeTheme = theme ?? 'system'
  // The System card has no class of its own, so it previews whichever of the
  // branded pair the OS currently resolves to — the swatches render from the
  // card's own theme class, so without this it would inherit the active
  // theme's colors and misrepresent what picking it would do.
  const systemClass = systemTheme === 'light' ? 'meridian-light' : 'meridian'

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5 px-1">
        <h2 className="text-sm font-semibold text-foreground">Theme</h2>
        <p className="text-xs text-muted-foreground">
          Each card previews itself — the dots are event, high and low priority, task and note.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {THEMES.map(({ id, label, className }) => {
          const active = activeTheme === id
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => setTheme(id)}
              className={cn(
                'flex flex-col gap-3 rounded-xl border p-3.5 text-left text-sm font-medium transition-colors',
                'bg-background text-foreground',
                className ?? systemClass,
                active ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-muted-foreground',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">{label}</span>
                {active && <Check className="size-4 shrink-0 stroke-[2.2] text-primary" />}
              </span>
              <span className="flex gap-1.5">
                {SWATCH_CLASSES.map(swatchClass => (
                  <span key={swatchClass} className={cn('block size-3 rounded-full', swatchClass)} />
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
