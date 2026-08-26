/**
 * The selectable themes, in the order the picker shows them.
 *
 * Preview cards render with the theme's own CSS class so `bg-*`/`text-*`
 * utilities resolve to that theme's actual tokens — no color values are
 * duplicated here. Meridian also needs its own class (not just relying on
 * `:root`) because `:root` alone gets overridden globally whenever another
 * theme is active on `<html>`.
 *
 * `System` leads, then our own pair, then the borrowed editor palettes
 * alphabetically — so the two themes that are actually Meridian's are not
 * buried mid-list between Dracula and Rosé Pine.
 *
 * The ids must stay in step with `THEME_CLASS` in `routes/__root.tsx`, which
 * is what actually maps an id to the class on `<html>`; `routes/__root.test.tsx`
 * asserts the two lists agree rather than deriving one from the other, since
 * importing the root route here would drag the whole app shell into the
 * settings chunk.
 */
export interface ThemeChoice {
  id:    string
  label: string
  /** The class that paints this theme's tokens. `system` has none — it
   *  previews whichever of the branded pair the OS currently resolves to. */
  className?: string
}

export const THEMES: ThemeChoice[] = [
  { id: 'system',            label: 'System' },
  { id: 'meridian',          label: 'Meridian Dark',    className: 'meridian' },
  { id: 'meridian-light',    label: 'Meridian Light',   className: 'meridian-light' },
  { id: 'catppuccin-latte',  label: 'Catppuccin Latte', className: 'catppuccin-latte' },
  { id: 'catppuccin-mocha',  label: 'Catppuccin Mocha', className: 'catppuccin-mocha' },
  { id: 'dracula',           label: 'Dracula',          className: 'dracula' },
  { id: 'rose-pine-dawn',    label: 'Rosé Pine Dawn',   className: 'rose-pine-dawn' },
  { id: 'solarized-dark',    label: 'Solarized Dark',   className: 'solarized-dark' },
  { id: 'solarized-light',   label: 'Solarized Light',  className: 'solarized-light' },
  { id: 'tokyo-night',       label: 'Tokyo Night',      className: 'tokyo-night' },
]

/** The five most identity-defining domain tokens, previewed as swatches. */
export const SWATCH_CLASSES = ['bg-event', 'bg-priority-1', 'bg-priority-3', 'bg-task', 'bg-note']

/** The label shown for `theme` on the Appearance row, falling back to System. */
export function themeLabel(themeId: string | undefined): string {
  return THEMES.find(t => t.id === (themeId ?? 'system'))?.label ?? 'System'
}
