import { fmtISO, fmtT, parseDurationDays, expandRange } from './model/expansion'
import {
  cacheWrite, cacheWriteClean, cacheDelete, cacheGetDirty,
  cacheMarkClean, cacheDirtyCount,
  dirHandleSave, dirHandleLoad, dirHandleClear,
  cacheInit,
} from './cache'
import {
  diskPickDirectory, diskReadAll, diskWrite, diskDelete,
  saveFile, titleToSlug,
} from './fileIO'
import { collapseToYaml } from './model/collapse'
import { parseToStoreItems, parseYamlToStoreItems } from './model/storeItems'
import {
  applyEdit, toggleDone, excludeOccurrence, deleteByFileSlug, deleteFollowing,
  fileSlugItems, findSeries,
} from './model/storeOps'
import type { Occurrence, Repeat, Scheduled, Priority, StoreItem, Roots } from './types'
import { parseWikilinks, resolveWikilink } from './wikilinks'
import { occKind, occIsRecur, isSeries } from './types'
export { occKind, occIsRecur }
import type { EntryState, ItemType } from './components/EntryEditor'
import { useStore } from './store'
import { TODAY } from './constants'

// ── SERIES-DELETE SHEET CONFIG ────────────────────────────────
export type SeriesSheetOption = {
  icon: 'calendar' | 'calendar-range'
  label: string
  sublabel: string
  onClick: () => void
}
export type SeriesSheetConfig = { title: string; options: SeriesSheetOption[] }

// ── STORE ACCESSORS ────────────────────────────────────────────
const getItems      = (): StoreItem[]   => useStore.getState().items
const setItems      = (i: StoreItem[])  => useStore.setState({ items: i })
const getRoots      = (): Roots         => useStore.getState().roots
const setData       = (d: { items: StoreItem[]; roots: Roots }) => useStore.getState().setData(d)
const getPrimary    = ()                => useStore.getState().primaryView
const setPrimary    = (v: string)       => useStore.getState().setPrimaryView(v as any)
const pushOverlayFn = (v: string)       => useStore.getState().pushOverlay(v as any)
const popOverlayFn  = ()               => useStore.getState().popOverlay()
const setCalMonth   = (d: Date)         => useStore.setState({ calMonth: d })
const setDvDate     = (d: Date)         => useStore.setState({ dvDate: d })
const getDirHandle  = ()               => useStore.getState().dirHandle
const setDirHandle  = (h: FileSystemDirectoryHandle | null) => useStore.setState({ dirHandle: h })

// ── ERROR NOTIFICATION ─────────────────────────────────────────
function notify(msg: string): void {
  useStore.setState({ errorNotification: msg });
  setTimeout(() => {
    if (useStore.getState().errorNotification === msg) {
      useStore.setState({ errorNotification: null });
    }
  }, 5000);
}

// ── SEED DATA ─────────────────────────────────────────────────
// Stored as inline YAML strings so they go through the same parseToStoreItems
// path as disk files — no separate Node[] representation needed.
const SEED_YAML: Array<{ id: string; yaml: string }> = [
  { id: 'standup', yaml: `---
title: Weekly Standup
tags: [work]
date: "2026-04-06"
time: "09:00"
duration: 30m
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
defaults:
  done: false
instances:
  - date: "2026-04-13"
    done: true
  - date: "2026-04-14"
    done: true
---

Quick sync. Agenda:
- [[project-alpha]] status
- Blockers
- [[weekly-log]] updates` },

  { id: 'exercise', yaml: `---
title: Exercise
tags: [health]
date: "2026-04-06"
done: false
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo, we, fr]
instances:
  - date: "2026-04-06"
    done: true
---

30 min run or gym. Part of [[health-habits]] tracking.` },

  { id: 'vitamins', yaml: `---
title: Take Vitamins
tags: [health]
date: "2026-05-10"
done: false
repeat:
  type: after_completion
  interval: 1 day
instances:
  - date: "2026-05-10"
    done: true
  - date: "2026-05-11"
    done: true
  - date: "2026-05-12"
    done: true
  - date: "2026-05-13"
    done: true
  - date: "2026-05-14"
    done: false
---` },

  { id: 'monthly-review', yaml: `---
title: Monthly Review
tags: [work]
date: "2026-04-07"
time: "14:00"
duration: 2h
repeat:
  type: schedule
  freq: monthly
  byweekday: [mo]
  bysetpos: 1
instances:
  - date: "2026-04-07"
    done: true
---

## Agenda

- Review [[project-alpha]] milestones
- Budget check
- Team velocity
- Next month planning` },

  { id: 'pay-rent', yaml: `---
title: Pay Rent
tags: [personal]
date: "2026-04-01"
done: false
repeat:
  type: schedule
  freq: monthly
  bymonthday: [1]
instances:
  - date: "2026-04-01"
    done: true
  - date: "2026-05-01"
    done: true
---` },

  { id: 'design-sync', yaml: `---
title: Design sync
tags: [work, design]
date: "2026-04-08"
time: "10:00"
duration: 1h
---` },

  { id: 'review-prs', yaml: `---
title: Review PRs
tags: [work]
date: "2026-04-09"
done: true
---` },

  { id: 'pycon', yaml: `---
title: PyCon 2026
tags: [conference]
date: "2026-04-19"
duration: 3d
---

## PyCon 2026

Sessions:
- Keynote: The Future of Python
- [[async-patterns]] workshop
- Networking dinner` },

  { id: 'keynote-ai', yaml: `---
title: "Keynote: Future of AI"
tags: [conference]
date: "2026-04-20"
time: "10:00"
duration: 2h
---` },

  { id: 'sprint-plan', yaml: `---
title: Sprint Planning
tags: [work]
date: "2026-04-27"
time: "14:00"
duration: 2h
---

## Sprint 12

Capacity: 34 points

- [ ] [[project-alpha]] beta release
- [ ] Recurrence engine tests
- [ ] Design system updates` },

  { id: 'offsite-kick', yaml: `---
title: Team Offsite Kickoff
tags: [work]
date: "2026-05-08"
time: "16:00"
duration: 3h
---` },

  { id: 'write-spec', yaml: `---
title: Write Spec Draft
tags: [project]
date: "2026-05-11"
done: true
---

Draft of [[spec-instance-recurrence]] v0.9 — cover split date/time/timezone fields.` },

  { id: 'standup-113', yaml: `---
title: "1:1 with Alex"
tags: [work]
date: "2026-05-13"
time: "11:00"
duration: 30m
---

Topics:
- Career growth check-in
- [[project-alpha]] concerns
- Upcoming [[team-offsite]] agenda` },

  { id: 'dentist-1', yaml: `---
title: Dentist
tags: [health]
date: "2026-05-13"
time: "14:30"
duration: 1h
---

Annual checkup. Bring insurance card.

Location: Dr. Müller, Friedrichstr. 42` },

  { id: 'sprint-board', yaml: `---
title: Review Sprint Board
tags: [work]
date: "2026-05-13"
done: true
---` },

  { id: 'lecture', yaml: `---
title: Prepare Lecture Notes
tags: [learning]
date: "2026-05-13"
done: false
---

For Thursday's lecture on [[distributed-systems]].

Cover: consensus algorithms, [[raft-protocol]], practical exercises.` },

  { id: 'design-review', yaml: `---
title: Design Review
tags: [work, design]
date: "2026-05-14"
time: "10:00"
duration: 1h
---` },

  { id: 'call-mom', yaml: `---
title: Call Mom
tags: [personal]
date: "2026-05-14"
done: false
---` },

  { id: 'blog-post', yaml: `---
title: Publish Blog Post
tags: [writing]
date: "2026-05-15"
done: false
---

Post about [[spec-instance-recurrence]]. Target: dev.to + HN.

1. The problem with iCalendar
2. A simpler model
3. Examples` },

  { id: 'team-offsite', yaml: `---
title: Team Offsite
tags: [work]
date: "2026-05-16"
duration: 3d
---` },

  { id: 'product-demo', yaml: `---
title: Product Demo
tags: [work]
date: "2026-05-20"
time: "15:00"
duration: 1h
---` },

  { id: 'finish-spec', yaml: `---
title: Finish Recurrence Spec
tags: [project]
date: "2026-05-20"
done: false
---` },

  { id: 'board-pres', yaml: `---
title: Board Presentation
tags: [work]
date: "2026-06-03"
time: "10:00"
duration: 2h
---` },

  { id: 'birthday-emma', yaml: `---
title: "Emma's Birthday 🎂"
tags: [personal]
date: "2026-06-10"
---

Get a gift! Ideas: [[gift-ideas]] or book from her [[reading-list]].` },

  { id: 'dentist-2', yaml: `---
title: Dentist Follow-up
tags: [health]
date: "2026-06-18"
time: "10:30"
duration: 1h
---` },

  { id: 'craft-conf', yaml: `---
title: Craft Conf 2026
tags: [conference]
date: "2026-06-24"
duration: 3d
---` },

  { id: 'beta-launch', yaml: `---
title: Beta Launch
tags: [work, milestone]
date: "2026-07-10"
---

## Launch checklist

- [ ] Feature flags enabled
- [ ] Monitoring alerts set up
- [ ] [[release-notes]] published
- [ ] Team comms sent` },

  { id: 'q3-plan', yaml: `---
title: Q3 Planning
tags: [work]
date: "2026-07-20"
done: false
---` },
]

function loadSeedItems(): { items: StoreItem[]; roots: Roots } {
  const items: StoreItem[] = []
  const roots: Roots = new Map()
  for (const { id, yaml } of SEED_YAML) {
    try {
      const parsed = parseYamlToStoreItems(yaml, id)
      items.push(...parsed.items)
      roots.set(id, parsed.root)
    } catch (e) {
      console.warn('[seed] parse failed for', id, e)
    }
  }
  return { items, roots }
}

export const NOTES_DATA = [
  {title:'Project Alpha',preview:'Core objectives for Q3. Launch by end of July.',date:'May 12',tags:['work'],type:'note'},
  {title:'Reading List',preview:'Books: SICP, TAOCP vol 1.',date:'May 10',tags:['personal'],type:'note'},
  {title:'Spec: Instance Recurrence',preview:'v0.8 — Draft. Human-readable YAML-native recurrence model.',date:'May 13',tags:['project'],type:'note'},
  {title:'Weekly Log',preview:'Week of May 11. Shipped the new parser.',date:'May 11',tags:['work'],type:'note'},
  {title:'Ideas',preview:'Offline-first sync, plugin system, graph view.',date:'May 9',tags:['ideas'],type:'note'},
]

// ── FILE ENTRY HELPERS ─────────────────────────────────────────

/** A flat, file-granular entry for the item picker and search overlay. */
export interface FileEntry {
  fileSlug: string
  title:    string
  tags:     string[]
  topics:   string[]
}

/**
 * One FileEntry per file (deduped by fileSlug), for the chip picker and search bar.
 * Roots map is the primary source; NOTES_DATA fills gaps for demo notes.
 */
export function fileEntries(roots: Roots): FileEntry[] {
  const fromRoots: FileEntry[] = []
  for (const [fileSlug, meta] of roots) {
    fromRoots.push({
      fileSlug,
      title:  meta.title || fileSlug,
      tags:   (meta.tags   as string[]) || [],
      topics: (meta.topics as string[]) || [],
    })
  }
  const slugSet = new Set(fromRoots.map(e => e.fileSlug))
  const fromNotes: FileEntry[] = NOTES_DATA
    .filter(n => !slugSet.has(titleToSlug(n.title)))
    .map(n => ({ fileSlug: titleToSlug(n.title), title: n.title, tags: n.tags ?? [], topics: [] }))
  return [...fromRoots, ...fromNotes]
}

/**
 * Navigate to the right occurrence for a file link.
 *
 * Strategy: pick the **next upcoming** occurrence (jsTime ≥ today); if none,
 * fall back to the **last past** occurrence. Returns `null` for dateless notes.
 */
export function targetOccurrence(fileSlug: string, items: StoreItem[], roots: Roots): Occurrence | null {
  const msDay = 86400000
  const AHEAD = new Date(TODAY.getTime() + 365 * 3 * msDay)
  const BACK  = new Date(TODAY.getTime() - 365 * 3 * msDay)
  const forward = expandRange(items, roots, TODAY, AHEAD).filter(o => o.fileSlug === fileSlug)
  if (forward.length) return forward[0]
  const back = expandRange(items, roots, BACK, TODAY).filter(o => o.fileSlug === fileSlug)
  if (back.length) return back[back.length - 1]
  return null
}

// ── UTILS ──────────────────────────────────────────────────────
export const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
export const addDays = (d: Date, n: number): Date => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
export const fmtLong = (d: Date): string => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
export const fmtShort = (d: Date): string => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// ── NAVIGATION ──────────────────────────────────────────────────
export function pushOverlay(name: 'entry'): void { pushOverlayFn(name) }
export function popOverlay(): void { popOverlayFn() }

export function goToday(): void {
  const primary = getPrimary()
  if (primary === 'day') {
    setDvDate(new Date(TODAY))
  } else if (primary === 'calendar') {
    setCalMonth(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1))
  } else {
    setPrimary('agenda')
    setTimeout(() => {
      const sec = document.querySelector(`.day-section[data-key="${fmtISO(TODAY)}"]`)
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }
}

// ── SHARED OCCURRENCE SORT ────────────────────────────────────
const _prioOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
function _sortKey(o: Occurrence): number {
  const t = !!fmtT(o.time), ev = occKind(o) === 'event'
  return (o.metadata.done ? 8 : 0) + (t ? 0 : 2) + (ev ? 0 : 1)
}
function _prioKey(o: Occurrence): number { return o.metadata.priority ? (_prioOrder[o.metadata.priority] ?? 3) : 3 }
export function sortOccs(arr: Occurrence[]): Occurrence[] {
  return arr.sort((a: Occurrence, b: Occurrence) => {
    const sd = _sortKey(a) - _sortKey(b); if (sd) return sd
    const pd = _prioKey(a) - _prioKey(b); if (pd) return pd
    const td = (a.metadata.jsTime?.getHours() || 0) * 60 + (a.metadata.jsTime?.getMinutes() || 0)
             - (b.metadata.jsTime?.getHours() || 0) * 60 - (b.metadata.jsTime?.getMinutes() || 0)
    if (td) return td
    return (a.metadata.title || '').localeCompare(b.metadata.title || '')
  })
}

export function occState(o: Occurrence): string {
  if (o.metadata.done) return 'done'
  const kind = occKind(o)
  if (kind === 'note') return 'note'
  if (kind === 'task' || o.metadata.done !== undefined) {
    const p = o.metadata.priority
    if (p === 'high') return 'task-p1'
    if (p === 'medium') return 'task-p2'
    if (p === 'low') return 'task-p3'
    return 'task-open'
  }
  if ((parseDurationDays(o.metadata.duration) ?? 0) >= 2) return 'event-future'
  const now = new Date()
  if (o.metadata.jsTime && o.metadata.jsTime < now) {
    // Whole-day events (no time) use day-level comparison — they stay colored
    // until midnight, not until 00:01 AM when jsTime (midnight) < now.
    if (!o.time) {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const eventDay = new Date(o.metadata.jsTime); eventDay.setHours(0, 0, 0, 0)
      if (eventDay >= today) return 'event-future'
    }
    return 'event-past'
  }
  return 'event-future'
}
const _ccBarMap: Record<string, string> = {
  'done': 'done',
  'event-past': 'done',
  'note': 'note',
  'task-open': 'task',
  'task-p1': 'task-p1',
  'task-p2': 'task-p2',
  'task-p3': 'task-p3',
  'event-future': 'event',
}
export function ccBarClass(o: Occurrence): string {
  if ((parseDurationDays(o.metadata.duration) ?? 0) >= 2) return 'multiday'
  return _ccBarMap[occState(o)] ?? 'event'
}

export function openDayViewForDate(date: Date): void {
  setDvDate(date)
  setPrimary('day')
}

// ── ENTRY EDITOR ──────────────────────────────────────────────

export function applyScope(item: Occurrence, scope: string, items?: StoreItem[]): { scheduled: Scheduled | null; repeat: Repeat | null } {
  const allItems = items ?? getItems()
  const parentSeries = item.ownerId
    ? (allItems.find(i => isSeries(i) && i.id === item.ownerId) ?? null)
    : null
  const seriesRepeat = parentSeries && isSeries(parentSeries) ? parentSeries.repeat : null
  const occDate = item.date || null
  const occTime = item.time || null
  const rootDate = (parentSeries && isSeries(parentSeries)) ? parentSeries.date : occDate
  const rootTime = (parentSeries && isSeries(parentSeries)) ? parentSeries.time : occTime
  if (scope === 'single') return { scheduled: occDate ? { date: occDate, time: occTime || '' } : null, repeat: null }
  if (scope === 'future') return { scheduled: occDate ? { date: occDate, time: occTime || '' } : null, repeat: seriesRepeat || null }
  if (scope === 'add') return { scheduled: { date: fmtISO(TODAY), time: occTime || '' }, repeat: null }
  return { scheduled: rootDate ? { date: rootDate, time: (rootTime as string) || '' } : null, repeat: seriesRepeat || null }
}

export function entryFromOccurrence(
  item:          Occurrence,
  editScope:     string,
  bodyTransform: (body: string) => string = b => b,
  items?:        StoreItem[],
): EntryState {
  const m = item.metadata
  const { scheduled, repeat } = applyScope(item, editScope, items)
  const tracked  = m.done !== undefined
  const itemType: ItemType = tracked ? 'task' : scheduled ? 'event' : 'note'
  return {
    item,
    title:     m.title    || '',
    bodyHtml:  bodyTransform(m.body || ''),
    scheduled,
    repeat,
    duration:  m.duration || '',
    tracked,
    itemType,
    done:      m.done     ?? false,
    tags:         [...(m.tags         || [])],
    topics:       [...(m.topics       || [])],
    participants: [...(m.participants || [])],
    priority:     (m.priority || null) as Priority | null,
    editScope,
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildBodyHtml(text: string, roots?: Roots): string {
  const allRoots = roots ?? getRoots()
  const links = parseWikilinks(text)
  if (links.length === 0) return escapeHtml(text).replace(/\n/g, '<br>')

  let result = ''
  let cursor = 0
  for (const wl of links) {
    result += escapeHtml(text.slice(cursor, wl.start)).replace(/\n/g, '<br>')
    const target = resolveWikilink(wl.ref, allRoots)
    const cls = target ? 'wl' : 'wl-broken'
    const safeRef   = escapeHtml(wl.ref)
    const safeLabel = escapeHtml(wl.label ?? wl.ref)
    result += `<span class="${cls}" data-ref="${safeRef}">[[${safeLabel}]]</span>`
    cursor = wl.end
  }
  result += escapeHtml(text.slice(cursor)).replace(/\n/g, '<br>')
  return result
}

export function closeEntry(): void { popOverlayFn() }

// ── MUTATIONS ──────────────────────────────────────────────────

export function saveNode(item: Occurrence | null, editScope: string, fields: any): void {
  const { title } = fields
  if (!title) return

  if (editScope === 'add' && item && !fields.scheduled?.date) {
    notify('Please set a date for the new occurrence.')
    return
  }

  const nextData = applyEdit({ items: getItems(), roots: getRoots() }, item, editScope, {
    title,
    tags:         fields.tags         ?? [],
    topics:       fields.topics       ?? [],
    participants: fields.participants  ?? [],
    body:         fields.body         ?? '',
    tracked:      fields.tracked      ?? false,
    done:         fields.done         ?? false,
    priority:     fields.priority     ?? null,
    scheduled:    fields.scheduled    ?? null,
    duration:     fields.duration     ?? '',
    repeat:       fields.repeat       ?? null,
  })
  setData(nextData)

  // Determine which fileSlug to persist. For a brand-new item the slug is derived
  // from the title — matching applyEdit — so undated tasks/notes are persisted too.
  const fileSlug = item?.fileSlug ?? titleToSlug(title)
  if (fileSlug) writeEntityToCache(fileSlug)
  closeEntry()
}

export function toggleOccDone(o: Occurrence): void {
  const next = toggleDone(getItems(), o)
  o.metadata.done = !o.metadata.done  // optimistic UI
  setItems(next)
  writeEntityToCache(o.fileSlug)
}

export function beginSwipeDelete(o: Occurrence): () => void {
  const items  = getItems()
  const title  = o.metadata.title   // expanded occurrence already carries the file-level title
  let cancelled = false

  if (occIsRecur(o, items)) {
    // Snapshot for undo — capture items before mutation.
    const snapshot = items
    const next = excludeOccurrence(items, o)

    showDeleteToast(title,
      () => { writeEntityToCache(o.fileSlug) },
      () => { cancelled = true; setItems(snapshot) },
    )
    return () => { if (!cancelled) setItems(next) }
  } else {
    const snapshot = items
    showDeleteToast(title,
      () => { deleteFileFromDisk(o.fileSlug) },
      () => {
        cancelled = true
        if (!getItems().find(i => i.id === o.id)) setItems(snapshot)
      },
    )
    return () => {
      if (!cancelled) {
        const nextRoots = new Map(getRoots()); nextRoots.delete(o.fileSlug)
        setData({ items: deleteByFileSlug(getItems(), o.fileSlug), roots: nextRoots })
      }
    }
  }
}

export function deleteNode(
  item: Occurrence | null,
  onShowSeries?: (config: SeriesSheetConfig) => void,
  onHideSeries?: () => void,
  onConfirmSingle?: (title: string, onConfirm: () => void) => void,
): void {
  if (!item) return
  const items    = getItems()
  const series   = findSeries(items, item)
  const slugItems = fileSlugItems(items, item.fileSlug)
  // Are there any other non-excluded occurrences besides this one?
  // Expanded occurrences carry a fresh random id (see expansion.ts / collectUndated),
  // so the standalone being deleted never matches by id — identify self by
  // (no ownerId, same date) the way upsertOverride does, otherwise it counts itself.
  const isSelf = (i: any) =>
    i.id === item.id || (!i.ownerId && !item.ownerId && i.date === item.date)
  const hasSiblings = slugItems.some(
    i => !isSeries(i) && !isSelf(i) && !(i as any).excluded,
  )
  const isRecurring = !!item.ownerId
  const isScheduled = series?.repeat?.type === 'schedule'
  const title = item.metadata.title   // expanded occurrence already carries the file-level title

  function hideSheet() { onHideSeries?.() }

  function excludeThis() {
    if (!item) return
    setItems(excludeOccurrence(getItems(), item))
    writeEntityToCache(item.fileSlug)
    hideSheet(); closeEntry()
  }
  function deleteAll() {
    if (!item) return
    const nextRoots = new Map(getRoots()); nextRoots.delete(item.fileSlug)
    setData({ items: deleteByFileSlug(getItems(), item.fileSlug), roots: nextRoots })
    deleteFileFromDisk(item.fileSlug)
    hideSheet(); closeEntry()
  }
  function deleteFuture() {
    if (!item) return
    setItems(deleteFollowing(getItems(), item))
    writeEntityToCache(item.fileSlug)
    hideSheet(); closeEntry()
  }

  // Non-recurring, single occurrence.
  if (!isRecurring && !hasSiblings) {
    const doDelete = () => {
      const nextRoots = new Map(getRoots()); nextRoots.delete(item.fileSlug)
      setData({ items: deleteByFileSlug(getItems(), item.fileSlug), roots: nextRoots })
      deleteFileFromDisk(item.fileSlug); closeEntry()
    }
    if (onConfirmSingle) { onConfirmSingle(title, doDelete); return }
    doDelete()
    return
  }

  const options: SeriesSheetOption[] = [
    { icon: 'calendar', label: 'This occurrence', sublabel: 'Remove only this occurrence', onClick: excludeThis },
  ]
  if (isScheduled) {
    options.push({ icon: 'calendar-range', label: 'This and all following', sublabel: 'Remove this and all future occurrences', onClick: deleteFuture })
    options.push({ icon: 'calendar-range', label: 'All occurrences', sublabel: 'Remove all occurrences', onClick: deleteAll })
  } else {
    options.push({ icon: 'calendar-range', label: 'All occurrences', sublabel: 'Remove all occurrences', onClick: deleteAll })
  }

  onShowSeries?.({ title: `Delete "${title}"`, options })
}

// ── UNDO TOAST MANAGER ───────────────────────────────────────
let _toastTimer: ReturnType<typeof setTimeout> | null = null
let _pendingCommit: (() => void) | null = null
const TOAST_MS = 4000

function showDeleteToast(title: string, commitFn: () => void, undoFn: () => void): void {
  if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null }
  if (_pendingCommit) { _pendingCommit(); _pendingCommit = null }

  _pendingCommit = commitFn
  useStore.setState({
    toast: {
      title,
      onUndo: () => {
        clearTimeout(_toastTimer!); _toastTimer = null
        _pendingCommit = null
        undoFn()
        useStore.setState({ toast: null })
      },
    },
  })
  _toastTimer = setTimeout(() => {
    _toastTimer = null
    if (_pendingCommit) { _pendingCommit(); _pendingCommit = null }
    useStore.setState({ toast: null })
  }, TOAST_MS)
}

// ── STORAGE ───────────────────────────────────────────────────

let _pendingDirHandle: FileSystemDirectoryHandle | null = null

function fileSlugToPath(fileSlug: string): string {
  return fileSlug + '.md'
}

async function writeEntityToCache(fileSlug: string): Promise<void> {
  try {
    const slugItems = fileSlugItems(getItems(), fileSlug)
    if (slugItems.length === 0) { await deleteFileFromDisk(fileSlug); return }
    const root = getRoots().get(fileSlug)
    const frontmatter = collapseToYaml(slugItems, root)
    const body = root?.body ?? ''
    const content = saveFile(frontmatter, body)
    const path = fileSlugToPath(fileSlug)
    await cacheWrite(path, content)
    updateSyncUI()
  } catch (e) {
    console.error('[storage] writeEntityToCache failed:', e)
  }
}

async function deleteFileFromDisk(fileSlug: string): Promise<void> {
  try {
    const path = fileSlugToPath(fileSlug)
    const dh   = getDirHandle()
    await cacheDelete(path)
    if (dh) await diskDelete(dh, path)
    updateSyncUI()
  } catch (e) {
    console.error('[storage] deleteFileFromDisk failed:', e)
  }
}

export async function syncToDirectory(): Promise<void> {
  try {
    const dh = getDirHandle()
    if (!dh) { notify('No vault folder connected. Click the folder icon first.'); return }
    const dirty = await cacheGetDirty()
    if (!dirty.length) { updateSyncUI(); return }
    for (const f of dirty) {
      await diskWrite(dh, f.path, f.content)
      await cacheMarkClean(f.path)
    }
    useStore.setState({ syncDirtyCount: 0, syncFlash: true })
    setTimeout(() => useStore.setState({ syncFlash: false }), 800)
  } catch (e) {
    console.error('[storage] sync failed:', e)
    notify('Sync failed: ' + ((e as Error).message || (e as Error).name))
  }
}

async function loadFilesFromDisk(): Promise<void> {
  const dh = getDirHandle()
  if (!dh) return
  const files = await diskReadAll(dh)
  const loaded: StoreItem[] = []
  const roots: Roots = new Map()
  for (const { path, content } of files) {
    await cacheWriteClean(path, content)
    try {
      const parsed = parseToStoreItems(path, content)
      loaded.push(...parsed.items)
      const slug = path.replace(/\.(md|yaml|yml)$/, '')
      roots.set(slug, parsed.root)
    } catch (e) { console.warn('[storage] parse failed for', path, e) }
  }
  setData({ items: loaded, roots })
  updateSyncUI()
  setTimeout(() => goToday(), 100)
}

export async function pickDirectory(): Promise<void> {
  try {
    await cacheInit()
    const h = await diskPickDirectory()
    setDirHandle(h)
    await dirHandleSave(h)
    useStore.setState({ pendingDirReconnect: null })
    _pendingDirHandle = null
    await loadFilesFromDisk()
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    console.error('[storage] pickDirectory failed:', e)
    notify((e as Error).message || 'Could not connect vault')
  }
}

export async function tryRestoreDirectory(): Promise<void> {
  try {
    await cacheInit()
    const h = await dirHandleLoad()
    if (!h) { setData(loadSeedItems()); return }
    const perm = await h.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') {
      setDirHandle(h)
      await loadFilesFromDisk()
    } else if (perm === 'prompt') {
      _pendingDirHandle = h
      useStore.setState({ pendingDirReconnect: h.name })
    } else {
      await dirHandleClear()
      setData(loadSeedItems())
    }
  } catch (e) {
    console.warn('[storage] tryRestoreDirectory failed:', e)
    setData(loadSeedItems())
  }
}

export async function reconnectDirectory(): Promise<void> {
  if (!_pendingDirHandle) return
  try {
    const perm = await _pendingDirHandle.requestPermission({ mode: 'readwrite' })
    if (perm === 'granted') {
      setDirHandle(_pendingDirHandle)
      useStore.setState({ pendingDirReconnect: null })
      _pendingDirHandle = null
      await loadFilesFromDisk()
    } else {
      await dirHandleClear()
      useStore.setState({ pendingDirReconnect: null })
      _pendingDirHandle = null
    }
  } catch (e) {
    console.error('[storage] reconnectDirectory failed:', e)
    notify((e as Error).message || 'Could not reconnect vault')
  }
}

function updateSyncUI(): void {
  cacheDirtyCount().then(n => {
    useStore.setState({ syncDirtyCount: n })
  }).catch(() => {})
}

// ── INIT ──────────────────────────────────────────────────────
export function initApp(): void {
  // Items stay empty until tryRestoreDirectory() resolves.
}
