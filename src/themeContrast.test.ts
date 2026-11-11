/**
 * APCA contrast of the text/surface pairs the UI actually paints, in every
 * theme, read straight from index.css.
 *
 * APCA (the perceptual model drafted for WCAG 3) rather than WCAG 2's ratio,
 * which misjudges saturated fills and dark themes. Even so, a number is not
 * the judge of a palette — the eye is — so this enforces only APCA's absolute
 * floor for text, and otherwise snapshots every pair's |Lc| next to its
 * recommended target. Retuning a color changes the snapshot; `vitest -u` and
 * the snapshot diff then shows, per theme, exactly which pairs gained or lost
 * contrast and whether one crossed its target, for review alongside the
 * screenshots.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { converter, parse, type Oklab, type Rgb } from 'culori'
import { APCAcontrast, sRGBtoY } from 'apca-w3'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Every flat block whose selector list a theme on <html> matches: @theme,
// :root, or the theme's own class. Same specificity, so source order decides.
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel = '', body = '']) => ({
  sel: (sel.split(';').pop() ?? '').trim().split(/\s*,\s*/),
  decls: [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k = '', v = '']) => [k, v.trim()] as const),
}))
// The shared alias block lists every theme class (see its comment in index.css).
const THEMES = blocks.find(b => b.sel.includes(':root') && b.sel.length > 5)!.sel
  .filter(s => s.startsWith('.')).map(s => s.slice(1))

function themeVars(theme: string): Map<string, string> {
  const vars = new Map<string, string>()
  for (const b of blocks) {
    if (b.sel.some(s => s.startsWith('@theme') || s === ':root' || s === `.${theme}`)) {
      for (const [k, v] of b.decls) vars.set(k, v)
    }
  }
  return vars
}

const toOklab = converter('oklab')
const toRgb = converter('rgb')

function resolve(value: string, vars: Map<string, string>): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => { const v = vars.get(name); if (v === undefined) throw new Error(`undefined ${name}`); return resolve(v, vars) })
}

/** Splits on top-level commas only (color-mix arguments contain parens). */
function args(s: string): string[] {
  const out: string[] = []; let depth = 0; let cur = ''
  for (const ch of s) {
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    if (ch === '(') depth++
    if (ch === ')') depth--
    cur += ch
  }
  return [...out, cur.trim()]
}

/** A resolved CSS color, with color-mix(in oklab, …) evaluated per spec (premultiplied). */
function color(value: string): Oklab {
  const mix = /^color-mix\(\s*in oklab\s*,(.*)\)$/s.exec(value)
  if (!mix) {
    const c = toOklab(parse(value))
    if (!c) throw new Error(`unparseable color: ${value}`)
    return { ...c, alpha: c.alpha ?? 1 }
  }
  const [a, b] = args(mix[1] ?? '').map(arg => {
    const m = /^(.*?)\s+([\d.]+)%$/s.exec(arg)
    return { c: color(m?.[1] ?? arg), p: m ? Number(m[2]) / 100 : undefined }
  })
  if (!a || !b) throw new Error(`color-mix needs two colors: ${value}`)
  const pa = a.p ?? (b.p === undefined ? 0.5 : 1 - b.p)
  const pb = b.p ?? 1 - pa
  const [wa, wb] = [pa * a.c.alpha!, pb * b.c.alpha!]
  const alpha = wa + wb
  const lerp = (x: number, y: number) => alpha === 0 ? 0 : (x * wa + y * wb) / alpha
  return { mode: 'oklab', l: lerp(a.c.l, b.c.l), a: lerp(a.c.a, b.c.a), b: lerp(a.c.b, b.c.b), alpha }
}

/** Composites `top` over an opaque `under` in sRGB, as the browser does. */
function over(top: Oklab, under: Oklab): Rgb {
  const [t, u] = [toRgb(top), toRgb(under)]
  const al = top.alpha ?? 1
  const ch = (x: number, y: number) => Math.min(1, Math.max(0, x * al + y * (1 - al)))
  return { mode: 'rgb', r: ch(t.r, u.r), g: ch(t.g, u.g), b: ch(t.b, u.b) }
}

const y = (c: Rgb) => sRGBtoY([c.r, c.g, c.b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255)))

/** |Lc| of text token on surface token(s), layered bottom → top. */
function lc(theme: string, text: string, ...surfaces: string[]): number {
  const vars = themeVars(theme)
  const get = (t: string) => color(resolve(`var(--color-${t})`, vars))
  const bg = surfaces.reduce<Rgb | undefined>((under, s) => over(get(s), under ? toOklab(under) : get(s)), undefined)!
  return Math.abs(Math.round(Number(APCAcontrast(y(over(get(text), toOklab(bg))), y(bg)))))
}

/**
 * APCA Bronze levels (|Lc|) by role. TARGET is what APCA recommends for the
 * size and weight each role renders at; it is reported, not enforced.
 * ABSOLUTE_FLOOR is APCA's minimum for any text at all, and is enforced.
 */
const TARGET = {
  body:   75, // body text, 14px regular: Lc 75 minimum, 90 preferred
  accent: 60, // primary-colored text (links, row actions) at 12–14px
  button: 60, // 12–14px medium on a solid fill: buttons, solid chips
  chip:   60, // ~11px medium on a tinted chip
  muted:  45, // de-emphasized labels, weekdays, placeholders at 12px
}
const ABSOLUTE_FLOOR = 30

/** Pairs under ABSOLUTE_FLOOR today, pinned at their current |Lc|: may improve, not drop. */
const KNOWN_BELOW_FLOOR: Record<string, number> = {}

type Role = keyof typeof TARGET
type Pair = { role: Role; text: string; on: string[] }

const HUES = ['event', 'task', 'note', 'priority-1', 'priority-2', 'priority-3']
const PAIRS: Pair[] = [
  ...['background', 'card', 'popover'].map(s => ({ role: 'body' as const, text: 'foreground', on: [s] })),
  ...['background', 'card'].map(s => ({ role: 'body' as const, text: 'secondary-foreground', on: [s] })),
  { role: 'body', text: 'sidebar-foreground', on: ['sidebar'] },
  { role: 'body', text: 'accent-foreground', on: ['accent'] },
  ...['background', 'card', 'muted', 'sidebar'].map(s => ({ role: 'muted' as const, text: 'muted-foreground', on: [s] })),
  { role: 'accent', text: 'primary-text', on: ['background'] },
  { role: 'accent', text: 'primary-text', on: ['card', 'state-subtle'] },
  { role: 'accent', text: 'primary-text', on: ['secondary'] },
  { role: 'button', text: 'primary-foreground', on: ['primary'] },
  { role: 'button', text: 'destructive-foreground', on: ['destructive'] },
  { role: 'button', text: 'warning-foreground', on: ['warning'] },
  ...HUES.map(h => ({ role: 'button' as const, text: `${h}-foreground`, on: [h] })),
  ...[...HUES, 'primary', 'warning'].map(h => ({ role: 'chip' as const, text: 'chip-tint-foreground', on: ['card', `${h}-tint`] })),
]

const rows = THEMES.flatMap(theme => PAIRS.map(p => ({
  key: `${theme}: ${p.text} on ${p.on.join(' + ')}`,
  lc: lc(theme, p.text, ...p.on),
  target: TARGET[p.role],
})))

describe('theme contrast (APCA)', () => {
  it('every pair clears the absolute floor', () => {
    expect(rows.filter(r => r.lc < (KNOWN_BELOW_FLOOR[r.key] ?? ABSOLUTE_FLOOR)).map(r => `${r.key}: ${r.lc}`)).toEqual([])
  })

  it('pins no pair that now clears the floor', () => {
    const cleared = rows.filter(r => r.key in KNOWN_BELOW_FLOOR && r.lc >= ABSOLUTE_FLOOR).map(r => r.key)
    expect(cleared, 'remove these from KNOWN_BELOW_FLOOR').toEqual([])
  })

  it('matches the reviewed contrast table', async () => {
    const table = rows.map(r => `${String(r.lc).padStart(3)}  ${r.lc < r.target ? `below ${r.target}` : `ok ${r.target}   `}  ${r.key}`).join('\n')
    await expect(table + '\n').toMatchFileSnapshot('./__snapshots__/themeContrast.txt')
  })
})
