/**
 * Renders a results JSON from stress.mjs as markdown tables.
 *
 *   node scripts/perf/table.mjs scripts/perf/results/<file>.json [more.json …]
 *
 * Several files may be passed — a `--flat` run is usually a second file, and
 * the file/occurrence comparison only reads once both shapes are in one table.
 */
import { readFileSync } from 'node:fs'

const runs = process.argv.slice(2).flatMap(f => JSON.parse(readFileSync(f, 'utf8')))
if (runs.length === 0) { console.error('usage: node scripts/perf/table.mjs <results.json> …'); process.exit(1) }

const n = v => (v === null || v === undefined ? '—' : typeof v === 'number' ? String(v) : v)
const row = cells => `| ${cells.join(' | ')} |`
const sep = cols => `|${' --- |'.repeat(cols)}`

function table(title, header, rows) {
  console.log(`\n### ${title}\n`)
  console.log(row(header))
  console.log(sep(header.length))
  for (const r of rows) console.log(row(r))
}

const label = r => `${r.shape}/${r.count}`
const pl = r => r.pipeline?.result ?? {}
const ui = r => r.ui ?? {}
const dx = r => r.dexie?.result ?? {}
const ms = v => (v && typeof v.median === 'number' ? v.median : v && typeof v.cold === 'number' ? v.cold : null)

table('Vault shape', ['vault', 'files', 'store items', 'occurrences (agenda window)', 'agenda rows', 'occ/file', 'bytes'],
  runs.map(r => [label(r), n(pl(r).files), n(pl(r).storeItems), n(pl(r).occurrencesInAgendaWindow), n(pl(r).agendaRows),
    pl(r).files ? (pl(r).occurrencesInAgendaWindow / pl(r).files).toFixed(1) : '—',
    pl(r).bytes ? (pl(r).bytes / 1e6).toFixed(2) + ' MB' : '—']))

table('Pipeline stages (ms, median)', ['vault', 'parse', 'deriveViews', 'backlinks', 'expand (agenda)', 'agendaSections', 'rankByQuery', 'toggle recompute', 'fileOccurrenceMap'],
  runs.map(r => [label(r), n(ms(pl(r).parse)), n(ms(pl(r).deriveViews)), n(ms(pl(r).backlinks)), n(ms(pl(r).expandAgendaWindow)),
    n(ms(pl(r).agendaSections)), n(ms(pl(r).rankByQuery)), n(ms(pl(r).toggleRecompute)), n(ms(pl(r).fileOccurrenceMap))]))

table('UI flows (ms to painted effect)', ['vault', 'vault paint', 'blocking (load)', 'toggle', 'scroll p95 frame', 'janky frames /30', '→ month', '→ day', '→ agenda', 'search', 'open entry', 'keystroke p50'],
  runs.map(r => {
    const u = ui(r)
    const f = k => (u[k]?.ms ?? u[k]?.error ?? u[k]?.skipped ?? null)
    return [label(r), n(u.coldStart?.vaultPaintMs), n(u.coldStart?.blockingMs), n(f('toggle')),
      n(u.scroll?.p95), n(u.scroll?.janky), n(f('toMonth')), n(f('toDay')), n(f('toAgenda')),
      n(f('search')), n(f('openEntry')), n(u.typing?.p50)]
  }))

table('Memory (MB of JS heap) and Dexie', ['vault', 'heap after load', 'heap after flows', 'DOM nodes', 'dexie write', 'dexie readAll', 'dirty scan', 'IDB usage', 'quota'],
  runs.map(r => [label(r), n(ui(r).afterLoad?.heapUsedMB), n(ui(r).afterFlows?.heapUsedMB), n(ui(r).afterLoad?.nodes),
    n(dx(r).writeMs), n(dx(r).readAllMs), n(dx(r).dirtyScanMs), n(dx(r).usageMB), n(dx(r).quotaMB)]))

const problems = runs.flatMap(r => [
  ...(r.ui?.error ? [`${label(r)} ui: ${r.ui.error}`] : []),
  ...(r.pipeline?.error ? [`${label(r)} pipeline: ${r.pipeline.error}`] : []),
  ...(r.dexie?.error ? [`${label(r)} dexie: ${r.dexie.error}`] : []),
  ...Object.entries(r.ui ?? {}).filter(([, v]) => v && v.error).map(([k, v]) => `${label(r)} ui.${k}: ${v.error}`),
  ...(r.ui?.crashes?.length ? [`${label(r)} crashes: ${r.ui.crashes.join('; ')}`] : []),
])
if (problems.length) { console.log('\n### Failures\n'); for (const p of problems) console.log(`- ${p}`) }
