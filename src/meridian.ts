import { fmtISO, fmtT, nodeDateTime, parseDateString } from './model/expansion'
import {
  cacheWrite, cacheWriteClean, cacheDelete, cacheGetDirty,
  cacheMarkClean, cacheDirtyCount,
  dirHandleSave, dirHandleLoad, dirHandleClear,
  cacheInit,
} from './cache'
import {
  diskPickDirectory, diskReadAll, diskWrite, diskDelete,
  loadFile, saveFile, titleToSlug,
} from './fileIO'
import { collapseToYaml } from './model/collapse'
// Type-only imports — used in exported function signatures so consumers get full type safety.
import type { Node, Occurrence, Repeat, Scheduled, Instance, Priority, StoreItem, InlineMetadata } from './types'
import { occKind, occIsRecur, isSeries } from './types'
export { occKind, occIsRecur }
import type { EntryState, ItemType } from './components/EntryEditor'
import { applyNodeEdit } from './nodeEdit'
import { useStore } from './store'
import { TODAY } from './constants'

// ── SERIES-DELETE SHEET CONFIG ────────────────────────────────
// Passed from deleteNode → App so the sheet is driven by React state only.
export type SeriesSheetOption = {
  icon: 'calendar' | 'calendar-range'
  label: string
  sublabel: string
  onClick: () => void
}
export type SeriesSheetConfig = { title: string; options: SeriesSheetOption[] }

// ── STORE ACCESSORS ────────────────────────────────────────────
// Thin wrappers that give vanilla-JS functions synchronous access to
// the Zustand store.
const getNodes      = (): Node[]        => useStore.getState().nodes
const setNodes      = (n: Node[])       => useStore.setState({ nodes: n })
const getItems      = (): StoreItem[]   => useStore.getState().items
const setItems      = (i: StoreItem[])  => useStore.setState({ items: i })
const getPrimary    = ()                => useStore.getState().primaryView
const setPrimary    = (v: string) => useStore.getState().setPrimaryView(v as any)
const pushOverlayFn = (v: string) => useStore.getState().pushOverlay(v as any)
const popOverlayFn  = ()          => useStore.getState().popOverlay()
const setCalMonth   = (d: Date)   => useStore.setState({ calMonth: d })
const setDvDate     = (d: Date)   => useStore.setState({ dvDate: d })
const getDirHandle  = ()          => useStore.getState().dirHandle
const setDirHandle  = (h: FileSystemDirectoryHandle | null) => useStore.setState({ dirHandle: h })

// ── ERROR NOTIFICATION ─────────────────────────────────────────
// Pushes a message to the store; App.tsx renders it as a dismissible banner.
// Auto-clears after 5 s (unless the same message is already gone).
function notify(msg: string): void {
  useStore.setState({ errorNotification: msg });
  setTimeout(() => {
    if (useStore.getState().errorNotification === msg) {
      useStore.setState({ errorNotification: null });
    }
  }, 5000);
}

// ── CONSTANTS ─────────────────────────────────────────────────
// TODAY is imported from ./constants

// ── SEED DATA (used by initApp when no vault is loaded) ───────
const SEED_NODES: Node[] = [
  {id:'standup', title:'Weekly Standup', tags:['work'],
   date:'2026-04-06', time:'09:00', duration:'30m',
   repeat:{type:'schedule', freq:'weekly', byweekday:['mo']},
   body:'Quick sync. Agenda:\n- [[project-alpha]] status\n- Blockers\n- [[weekly-log]] updates',
   instances:[
     {date:'2026-04-13', done:true},
     {date:'2026-04-14', done:true},
   ]
  },
  {id:'exercise', title:'Exercise', tags:['health'],
   date:'2026-04-06', done:false,
   repeat:{type:'schedule', freq:'weekly', byweekday:['mo','we','fr']},
   body:'30 min run or gym. Part of [[health-habits]] tracking.',
   instances:[
     {date:'2026-04-06', done:true},
   ]
  },
  {id:'vitamins', title:'Take Vitamins', tags:['health'],
   date:'2026-05-10', done:false,
   repeat:{type:'after_completion', interval:'1 day'},
   instances:[
     {date:'2026-05-10', done:true},
     {date:'2026-05-11', done:true},
     {date:'2026-05-12', done:true},
     {date:'2026-05-13', done:true},
     {date:'2026-05-14', done:false},
   ]
  },
  {id:'monthly-review', title:'Monthly Review', tags:['work'],
   date:'2026-04-07', time:'14:00', duration:'2h',
   repeat:{type:'schedule', freq:'monthly', byweekday:['mo'], bysetpos:1},
   body:'## Agenda\n\n- Review [[project-alpha]] milestones\n- Budget check\n- Team velocity\n- Next month planning',
   instances:[
     {date:'2026-04-07', done:true},
   ]
  },
  {id:'pay-rent', title:'Pay Rent', tags:['personal'],
   date:'2026-04-01', done:false,
   repeat:{type:'schedule', freq:'monthly', bymonthday:[1]},
   instances:[
     {date:'2026-04-01', done:true},
     {date:'2026-05-01', done:true},
   ]
  },
  {id:'design-sync',    title:'Design sync',          tags:['work','design'], date:'2026-04-08', time:'10:00', duration:'1h'},
  {id:'review-prs',     title:'Review PRs',           tags:['work'],          date:'2026-04-09', done:true},
  {id:'pycon',          title:'PyCon 2026',            tags:['conference'],    date:'2026-04-19',
   multiday:{start:'2026-04-19', end:'2026-04-21'},
   body:'## PyCon 2026\n\nSessions:\n- Keynote: The Future of Python\n- [[async-patterns]] workshop\n- Networking dinner'},
  {id:'keynote-ai',     title:'Keynote: Future of AI', tags:['conference'],   date:'2026-04-20', time:'10:00', duration:'2h'},
  {id:'sprint-plan',    title:'Sprint Planning',       tags:['work'],          date:'2026-04-27', time:'14:00', duration:'2h',
   body:'## Sprint 12\n\nCapacity: 34 points\n\n- [ ] [[project-alpha]] beta release\n- [ ] Recurrence engine tests\n- [ ] Design system updates'},
  {id:'offsite-kick',   title:'Team Offsite Kickoff',  tags:['work'],          date:'2026-05-08', time:'16:00', duration:'3h'},
  {id:'write-spec',     title:'Write Spec Draft',      tags:['project'],       date:'2026-05-11', done:true,
   body:'Draft of [[spec-instance-recurrence]] v0.9 — cover split date/time/timezone fields.'},
  {id:'standup-113',    title:'1:1 with Alex',         tags:['work'],          date:'2026-05-13', time:'11:00', duration:'30m',
   body:'Topics:\n- Career growth check-in\n- [[project-alpha]] concerns\n- Upcoming [[team-offsite]] agenda'},
  {id:'dentist-1',      title:'Dentist',               tags:['health'],        date:'2026-05-13', time:'14:30', duration:'1h',
   body:'Annual checkup. Bring insurance card.\n\nLocation: Dr. Müller, Friedrichstr. 42'},
  {id:'sprint-board',   title:'Review Sprint Board',   tags:['work'],          date:'2026-05-13', done:true},
  {id:'lecture',        title:'Prepare Lecture Notes', tags:['learning'],      date:'2026-05-13', done:false,
   body:"For Thursday's lecture on [[distributed-systems]].\n\nCover: consensus algorithms, [[raft-protocol]], practical exercises."},
  {id:'design-review',  title:'Design Review',         tags:['work','design'], date:'2026-05-14', time:'10:00', duration:'1h'},
  {id:'call-mom',       title:'Call Mom',              tags:['personal'],      date:'2026-05-14', done:false},
  {id:'blog-post',      title:'Publish Blog Post',     tags:['writing'],       date:'2026-05-15', done:false,
   body:'Post about [[spec-instance-recurrence]]. Target: dev.to + HN.\n\n1. The problem with iCalendar\n2. A simpler model\n3. Examples'},
  {id:'team-offsite',   title:'Team Offsite',          tags:['work'],          date:'2026-05-16',
   multiday:{start:'2026-05-16', end:'2026-05-18'}},
  {id:'product-demo',   title:'Product Demo',          tags:['work'],          date:'2026-05-20', time:'15:00', duration:'1h'},
  {id:'finish-spec',    title:'Finish Recurrence Spec',tags:['project'],       date:'2026-05-20', done:false},
  {id:'board-pres',     title:'Board Presentation',    tags:['work'],          date:'2026-06-03', time:'10:00', duration:'2h'},
  {id:'birthday-emma',  title:"Emma's Birthday 🎂",   tags:['personal'],      date:'2026-06-10',
   body:'Get a gift! Ideas: [[gift-ideas]] or book from her [[reading-list]].'},
  {id:'dentist-2',      title:'Dentist Follow-up',     tags:['health'],        date:'2026-06-18', time:'10:30', duration:'1h'},
  {id:'craft-conf',     title:'Craft Conf 2026',       tags:['conference'],    date:'2026-06-24',
   multiday:{start:'2026-06-24', end:'2026-06-26'}},
  {id:'beta-launch',    title:'Beta Launch',           tags:['work','milestone'], date:'2026-07-10',
   body:'## Launch checklist\n\n- [ ] Feature flags enabled\n- [ ] Monitoring alerts set up\n- [ ] [[release-notes]] published\n- [ ] Team comms sent'},
  {id:'q3-plan',        title:'Q3 Planning',           tags:['work'],          date:'2026-07-20', done:false},
];

export const NOTES_DATA = [
  {title:'Project Alpha',preview:'Core objectives for Q3. Launch by end of July.',date:'May 12',tags:['work'],type:'note'},
  {title:'Reading List',preview:'Books: SICP, TAOCP vol 1.',date:'May 10',tags:['personal'],type:'note'},
  {title:'Spec: Instance Recurrence',preview:'v0.8 — Draft. Human-readable YAML-native recurrence model.',date:'May 13',tags:['project'],type:'note'},
  {title:'Weekly Log',preview:'Week of May 11. Shipped the new parser.',date:'May 11',tags:['work'],type:'note'},
  {title:'Ideas',preview:'Offline-first sync, plugin system, graph view.',date:'May 9',tags:['ideas'],type:'note'},
]

// ── NODE → STORE ITEMS CONVERSION ─────────────────────────────
/**
 * Convert a Node[] (YAML-level model) to StoreItem[] (flat store model).
 * Each Node with a repeat becomes a RepeatPattern; its instances become
 * OccurrenceEntry children. Non-repeating Nodes become standalone OccurrenceEntries.
 * Excluded instances are skipped (structural YAML markers, not store items).
 */
export function nodesToStoreItems(nodes: Node[]): StoreItem[] {
  const result: StoreItem[] = []
  for (const node of nodes) {
    const fileSlug = node.id
    const inlineMeta: InlineMetadata = {
      title:    node.title,
      done:     node.done,
      tags:     node.tags || [],
      priority: node.priority,
      duration: node.duration,
      timezone: node.timezone,
    }
    if (node.repeat) {
      const seriesId = crypto.randomUUID()
      const series: StoreItem = {
        date:     node.date || '',
        time:     node.time || null,
        repeat:   node.repeat,
        fileSlug,
        id:       seriesId,
        metadata: inlineMeta,
      }
      result.push(series)
      // Add explicit instance overrides as OccurrenceEntry children
      for (const inst of node.instances || []) {
        if (inst.excluded) continue
        const instMeta: InlineMetadata = {
          title:    inst.title ?? node.title,
          done:     inst.done,
          tags:     inst.tags || node.tags || [],
          priority: inst.priority,
          duration: inst.duration,
          timezone: undefined,
        }
        const occ: StoreItem = {
          date:     inst.date,
          time:     inst.time || null,
          source:   'explicit',
          fileSlug,
          id:       crypto.randomUUID(),
          ownerId:  seriesId,
          metadata: instMeta,
        }
        result.push(occ)
      }
    } else {
      // Standalone occurrence (or multi-occurrence without a repeat)
      const occ: StoreItem = {
        date:    node.date || '',
        time:    node.time || null,
        source:  'explicit',
        fileSlug,
        id:      crypto.randomUUID(),
        metadata: inlineMeta,
      }
      result.push(occ)
      // Add extra explicit instances
      for (const inst of node.instances || []) {
        if (inst.excluded) continue
        const instMeta: InlineMetadata = {
          title:    inst.title ?? node.title,
          done:     inst.done,
          tags:     inst.tags || node.tags || [],
          priority: inst.priority,
          duration: inst.duration,
          timezone: undefined,
        }
        result.push({
          date:    inst.date,
          time:    inst.time || null,
          source:  'explicit',
          fileSlug,
          id:      crypto.randomUUID(),
          metadata: instMeta,
        })
      }
    }
  }
  return result
}

// curView, prevView, calMonth, dvDate, nsFilterVal, nextId → useStore

// ── UTILS ──────────────────────────────────────────────────────
export const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
export const addDays = (d: Date, n: number): Date => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
export const fmtLong = (d: Date): string => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
export const fmtShort = (d: Date): string => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

// ── NAVIGATION ──────────────────────────────────────────────────
// All view switching is pure store mutations — no DOM class/style manipulation.
// App.tsx derives the active view and topbar content from the store reactively.

/** Push an overlay view (entry or search) on top of the current primary view. */
export function pushOverlay(name: 'entry' | 'search'): void { pushOverlayFn(name); }
/** Pop the topmost overlay, returning to the primary view (or the overlay below). */
export function popOverlay(): void { popOverlayFn(); }

export function goToday(): void {
  const primary = getPrimary();
  if (primary === 'day') {
    setDvDate(new Date(TODAY));
  } else if (primary === 'calendar') {
    setCalMonth(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1));
  } else {
    setPrimary('agenda');
    setTimeout(() => {
      const sec = document.querySelector(`.day-section[data-key="${dayKey(TODAY)}"]`);
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }
}

export function openSearch(): void {
  pushOverlayFn('search');
  setTimeout(() => { (window as any)._focusSearch?.(); }, 50);
}
export function closeSearch(): void { popOverlayFn(); }

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

// ── AGENDA ──────────────────────────────────────────────────────
// buildAgenda(), makeOccRow(), flipResortSection(), insertOccIntoAgenda(),
// findOccWrapInAgenda(), removeOccWrapFromAgenda() are deleted.
// AgendaView (src/components/AgendaView.tsx) subscribes to the Zustand store
// and re-renders automatically whenever nodes change.
// Filtering is handled via useStore's filterQuery field.

export function occState(o: Occurrence): string {
  if (o.metadata.done) return 'done'
  if (occKind(o) === 'task' || o.metadata.done !== undefined) {
    const p = o.metadata.priority
    if (p === 'high') return 'task-p1'
    if (p === 'medium') return 'task-p2'
    if (p === 'low') return 'task-p3'
    return 'task-open'
  }
  if (o.metadata.multiday) return 'event-future'
  const now = new Date()
  if (o.metadata.jsTime && o.metadata.jsTime < now) return 'event-past'
  return 'event-future'
}
export function barClass(o: Occurrence): string { return occState(o) }

// ── IMMUTABLE NODE HELPERS ────────────────────────────────────
/** Shallow-clone a node with a fresh instances array so mutations
 *  never affect the original store object. */
function cloneNode(node: Node): Node {
  return {
    ...node,
    instances: node.instances ? node.instances.map((i: Instance) => ({ ...i })) : undefined,
  }
}
/** Return a new nodes array with the node matching `id` replaced. */
function replaceNode(nodes: Node[], id: string, updated: Node): Node[] {
  return nodes.map((n: Node) => n.id === id ? updated : n)
}

// ── TOGGLE DONE (data-only, exported for React components) ────
export function toggleOccDone(o: Occurrence): void {
  const newDone = !o.metadata.done
  o.metadata.done = newDone // update the occurrence for optimistic UI
  const node = getNodes().find(n => n.id === o.fileSlug)
  if (!node) return
  const updated = cloneNode(node)
  const jsT = o.metadata.jsTime
  if (node.repeat && jsT) {
    const inst = updated.instances?.find((i: Instance) => {
      const t = nodeDateTime(i as unknown as Record<string, unknown>) || parseDateString(i.date)
      return t && Math.abs(t.getTime() - jsT.getTime()) < 60000
    })
    if (inst) { inst.done = newDone }
    else {
      if (!updated.instances) updated.instances = []
      updated.instances.push({ date: o.date, done: newDone })
    }
  } else {
    updated.done = newDone
  }
  writeEntityToCache(updated)
  setNodes(replaceNode(getNodes(), node.id, updated))
}

// ── SWIPE DELETE (exported for React components) ──────────────
// Two-phase delete so the toast can appear at the moment the user lifts their
// finger, while the exit animation is still playing.
//
// Phase 1 — call beginSwipeDelete() on touchend:
//   Shows the toast immediately.  Returns an applyDelete() function.
// Phase 2 — call applyDelete() after the exit animation completes (~230 ms):
//   Removes the item from the Zustand store so React unmounts it.
//   applyDelete() is a no-op if the user already pressed Undo.
export function beginSwipeDelete(o: Occurrence): () => void {
  const node = getNodes().find(n => n.id === o.fileSlug)
  if (!node) return () => {}
  const nodeId = node.id
  const title = node.title
  let cancelled = false

  if (occIsRecur(o, getItems())) {
    const original = cloneNode(node) // snapshot for undo
    const updated = cloneNode(node)
    if (!updated.instances) updated.instances = []
    const occDate = o.date
    const inst = updated.instances.find((i: Instance) => i.date === occDate && !i.time)
    if (inst) { inst.excluded = true }
    else { updated.instances.push({ date: occDate, excluded: true }) }
    // Apply mutation to `updated` now so commitFn (writeEntityToCache) always
    // sees the correct state even if a second delete fires before applyDelete.
    showDeleteToast(title,
      () => { writeEntityToCache(updated) },
      () => {
        cancelled = true
        setNodes(replaceNode(getNodes(), nodeId, original))
      }
    )
    // applyDelete: swap updated node into the store (triggers React re-render).
    return () => { if (!cancelled) setNodes(replaceNode(getNodes(), nodeId, updated)) }
  } else {
    showDeleteToast(title,
      () => { deleteNodeFromDisk(node) },
      () => {
        cancelled = true
        // Only restore if applyDelete already removed the node.
        if (!getNodes().find(n => n.id === nodeId)) {
          setNodes([...getNodes(), node].sort((a, b) =>
            (parseDateString(a.date ?? '') ?? 0) as unknown as number -
            ((parseDateString(b.date ?? '') ?? 0) as unknown as number)
          ))
        }
      }
    )
    // applyDelete: filter the node out of the store.
    return () => { if (!cancelled) setNodes(getNodes().filter(n => n.id !== nodeId)) }
  }
}

export function ccBarClass(o: Occurrence): string {
  if (o.metadata.multiday) return 'multiday'
  const s = occState(o)
  if (s === 'done' || s === 'event-past') return 'done'
  if (s === 'task-open') return 'task'
  if (s === 'task-p1') return 'task-p1'
  if (s === 'task-p2') return 'task-p2'
  if (s === 'task-p3') return 'task-p3'
  return 'event'
}
// makeOccRow, toggleOccDone (DOM), findOccWrapInAgenda, removeOccWrapFromAgenda,
// insertOccIntoAgenda, flipResortSection all deleted.
// AgendaView + OccurrenceRow handle rendering and animations in React.

// ── MONTH ──────────────────────────────────────────────────────
// buildMonth, makeCalCell, chMonth deleted.
// MonthView (src/components/MonthView.tsx) subscribes to calMonth + nodes
// and re-renders automatically — no manual DOM updates needed.

/** Navigate to the day view for a specific date. Called from MonthView cell clicks. */
export function openDayViewForDate(date: Date): void {
  setDvDate(date)
  setPrimary('day')
}

// ── ENTRY EDITOR ──────────────────────────────────────────────
// openEntry is handled entirely by App.tsx via React state — no global bridge needed.

export function applyScope(item: Occurrence, scope: string): { scheduled: Scheduled | null; repeat: Repeat | null } {
  const root = getNodes().find(n => n.id === item.fileSlug)
  // Find parent series for repeat info
  const parentSeries = item.ownerId
    ? getItems().find(i => isSeries(i) && i.id === item.ownerId)
    : null
  const seriesRepeat = parentSeries && isSeries(parentSeries) ? parentSeries.repeat : null
  const occDate = item.date || root?.date || null
  const occTime = item.time || root?.time || null
  const rootDate = root?.date || null
  const rootTime = root?.time || null
  if (scope === 'single') return { scheduled: occDate ? { date: occDate, time: occTime || '' } : null, repeat: null }
  if (scope === 'future') return { scheduled: occDate ? { date: occDate, time: occTime || '' } : null, repeat: seriesRepeat || null }
  if (scope === 'add') return { scheduled: { date: fmtISO(TODAY), time: occTime || '' }, repeat: null }
  return { scheduled: rootDate ? { date: rootDate, time: rootTime || '' } : null, repeat: seriesRepeat || null }
}

/**
 * Seed an EntryState from a concrete occurrence.
 * `bodyTransform` converts raw body text to HTML (pass `buildBodyHtml` in the
 * main app; omit or pass identity in contexts that don't render wikilinks).
 */
export function entryFromOccurrence(
  item:          Occurrence,
  editScope:     string,
  bodyTransform: (body: string) => string = b => b,
): EntryState {
  const m = item.metadata
  const { scheduled, repeat } = applyScope(item, editScope)
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
    tags:      [...(m.tags     || [])],
    priority:  (m.priority || null) as Priority | null,
    editScope,
  }
}

export function buildBodyHtml(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, ref: string, label: string) => {
      const nodes = getNodes()
      const target = nodes.find(n => n.title.toLowerCase() === ref.toLowerCase())
      return `<span class="${target ? 'wl' : 'wl-broken'}" data-ref="${ref}">[[${label || ref}]]</span>`
    })
    .replace(/\n/g, '<br>')
}

export function closeEntry(): void { popOverlayFn() }

export function saveNode(item: Occurrence | null, editScope: string, fields: any): void {
  const { title } = fields
  if (!title) return

  const nodes = getNodes()
  const fileSlug = item?.fileSlug
  const existingIdx = fileSlug ? nodes.findIndex(n => n.id === fileSlug) : -1
  const isNew = existingIdx < 0

  if (isNew) {
    const { tags, body, tracked, done, priority, scheduled, duration, repeat } = fields
    const f: Partial<Node> & { title: string } = { title, tags, body: body || undefined }
    if (tracked) { f.done = done; if (priority) f.priority = priority }
    if (scheduled?.date) { f.date = scheduled.date; f.time = scheduled.time || undefined; f.duration = duration || undefined }
    const newId = crypto.randomUUID()
    const node: Partial<Node> & { id: string } = { id: newId, ...f }
    if (!tracked) delete node.done
    if (!scheduled) { delete node.date; delete node.time; delete node.duration }
    node.repeat = repeat || undefined
    setNodes([...nodes, node as Node])
    writeEntityToCache(node as Node)
    closeEntry()
    return
  }

  const node = nodes[existingIdx]

  if (editScope === 'add' && !fields.scheduled?.date) {
    notify('Please set a date for the new occurrence.')
    return
  }

  // Delegate all edit logic to the shared pure function.
  // Build an EntryState-compatible object from the flat fields.
  const entryForEdit = { item, editScope, ...fields } as any
  const rawNode = toRawNode(node)
  const updatedRaw = applyNodeEdit(rawNode, entryForEdit, fields.body ?? '')
  const updated = { ...updatedRaw, id: node.id, _path: node._path } as Node
  setNodes(replaceNode(nodes, node.id, updated))
  writeEntityToCache(updated)
  closeEntry()
}

export function deleteNode(
  item: Occurrence | null,
  onShowSeries?: (config: SeriesSheetConfig) => void,
  onHideSeries?: () => void,
  onConfirmSingle?: (title: string, onConfirm: () => void) => void,
): void {
  if (!item) return
  const _nodeOrUndef = getNodes().find(n => n.id === item.fileSlug)
  if (!_nodeOrUndef) return
  const node: Node = _nodeOrUndef  // narrow to Node for closures below
  const nodeId = node.id
  const occDate = item.date || node.date || ''

  const isScheduled = node.repeat?.type === 'schedule'
  const hasMultiple = !node.repeat && (node.instances || []).some((i: Instance) => !i.excluded)

  function hideSheet() {
    if (onHideSeries) onHideSeries()
  }
  function excludeThis() {
    const updated = cloneNode(node)
    if (!updated.instances) updated.instances = []
    const inst = updated.instances.find((i: Instance) => i.date === occDate && !i.time)
    if (inst) { inst.excluded = true }
    else { updated.instances.push({ date: occDate, excluded: true }) }
    setNodes(replaceNode(getNodes(), nodeId, updated))
    writeEntityToCache(updated)
    hideSheet(); closeEntry()
  }
  function deleteAll() {
    setNodes(getNodes().filter(n => n.id !== nodeId))
    deleteNodeFromDisk(node)
    hideSheet(); closeEntry()
  }
  function deleteAllFuture() {
    // Cap the series at the day before occDate; exclude any future manual instances
    const updated = cloneNode(node)
    const occJsDate = parseDateString(occDate)!
    const untilDate = new Date(occJsDate); untilDate.setDate(untilDate.getDate() - 1)
    updated.repeat = {
      ...updated.repeat,
      end: { type: 'until', date: fmtISO(untilDate) },
    } as Repeat
    if (updated.instances) {
      updated.instances = updated.instances.map((i: Instance) =>
        (i.date && i.date >= occDate && !i.excluded) ? { ...i, excluded: true } : i
      )
    }
    setNodes(replaceNode(getNodes(), nodeId, updated))
    writeEntityToCache(updated)
    hideSheet(); closeEntry()
  }

  if (!node.repeat && !hasMultiple) {
    // Single occurrence — ask React to show a confirm dialog, then act on confirm.
    const doDelete = () => { setNodes(getNodes().filter(n => n.id !== nodeId)); deleteNodeFromDisk(node); closeEntry() }
    if (onConfirmSingle) { onConfirmSingle(node.title, doDelete); return }
    // Fallback if caller doesn't provide a dialog (shouldn't happen in normal flow).
    doDelete()
    return
  }

  // Build config and hand off to React; no DOM manipulation.
  const options: SeriesSheetOption[] = [
    { icon: 'calendar', label: 'This occurrence', sublabel: 'Remove only this occurrence', onClick: excludeThis },
  ]
  if (isScheduled) {
    options.push({ icon: 'calendar-range', label: 'This and all following', sublabel: 'Remove this and all future occurrences', onClick: deleteAllFuture })
    options.push({ icon: 'calendar-range', label: 'All occurrences', sublabel: 'Remove all occurrences', onClick: deleteAll })
  } else {
    options.push({ icon: 'calendar-range', label: 'All occurrences', sublabel: 'Remove all occurrences', onClick: deleteAll })
  }

  if (onShowSeries) onShowSeries({ title: `Delete "${node.title}"`, options })
}

// ── WIKILINK AUTOCOMPLETE ─────────────────────────────────────
// Fully migrated to EntryEditor.tsx (React state + component-local handlers).
// wikilinkInputHandler, wikilinkKeydownHandler, wikilinkClickHandler, insertWikilink deleted.

// ── UNDO TOAST MANAGER ───────────────────────────────────────
// Timer lives in module scope so it survives across React renders.
let _toastTimer: ReturnType<typeof setTimeout> | null = null
let _pendingCommit: (() => void) | null = null
const TOAST_MS = 4000

function showDeleteToast(title: string, commitFn: () => void, undoFn: () => void): void {
  // Commit any previous pending delete before showing the new one.
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

function nodeToPath(node: Node): string {
  if (node._path) return node._path
  const slug = titleToSlug(node.title)
  const collision = getNodes().some(n => {
    if (n === node || n.id === node.id) return false
    const otherSlug = n._path ? n._path.replace(/\.md$/, '') : titleToSlug(n.title)
    return otherSlug === slug
  })
  const path = collision ? `${slug}-${node.id}.md` : `${slug}.md`
  node._path = path
  return path
}

// Module-level pending handle (needs user gesture before requestPermission can be called).
let _pendingDirHandle: FileSystemDirectoryHandle | null = null

/** Runtime/internal fields that must not be written to YAML. */
const _INTERNAL_FIELDS = new Set(['id', '_path'])

/** Strip runtime fields from a Node to get a plain object suitable for saveFile. */
function toRawNode(node: Node): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    if (!_INTERNAL_FIELDS.has(k)) result[k] = v
  }
  return result
}

/**
 * Construct a typed Node from a raw parsed object + body.
 * Handles date/time unification, type coercion, and instance normalisation.
 */
function rawToNode(path: string, raw: Record<string, unknown>, body: string): Node | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fm: any = raw
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const node: any = {}
  node.id    = fm.id || path.replace(/\.(md|yaml|yml)$/, '')
  node.title = fm.title || node.id

  if (fm.date) {
    node.date = String(fm.date)
  } else if (fm.time) {
    const unified = String(fm.time)
    const tMatch  = unified.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/)
    if (tMatch) { node.date = tMatch[1]; if (tMatch[2]) node.time = tMatch[2] }
    else node.date = unified
  }
  if (fm.date && fm.time !== undefined) {
    if (typeof fm.time === 'string' && fm.time.match(/^\d{1,2}:\d{2}/)) {
      node.time = fm.time.slice(0, 5)
    } else if (typeof fm.time === 'number') {
      const h = Math.floor(fm.time / 60), mn = fm.time % 60
      node.time = String(h).padStart(2, '0') + ':' + String(mn).padStart(2, '0')
    }
  }
  if (fm.timezone) node.timezone = String(fm.timezone)
  if (fm.duration) node.duration = String(fm.duration)
  if (fm.done !== undefined) node.done = fm.done
  if (fm.priority) node.priority = String(fm.priority)
  if (fm.tags) node.tags = Array.isArray(fm.tags) ? fm.tags : [String(fm.tags)]
  if (body) node.body = body

  if (fm.repeat && typeof fm.repeat === 'object') {
    const r = fm.repeat
    node.repeat = { type: String(r.type) }
    if (r.type === 'after_completion') {
      if (r.interval) node.repeat.interval = String(r.interval)
    } else if (r.type === 'schedule') {
      if (r.freq) node.repeat.freq = String(r.freq)
      if (r.byweekday) node.repeat.byweekday = Array.isArray(r.byweekday) ? r.byweekday.map(String) : [String(r.byweekday)]
      if (r.bymonthday) node.repeat.bymonthday = Array.isArray(r.bymonthday) ? r.bymonthday.map(Number) : [Number(r.bymonthday)]
      if (r.bysetpos !== undefined) node.repeat.bysetpos = Number(r.bysetpos)
      if (r.interval) node.repeat.interval = Number(r.interval)
      if (r.end && typeof r.end === 'object') {
        const end: Record<string, unknown> = { type: String(r.end.type) }
        if (r.end.date) end.date = String(r.end.date)
        else if (r.end.time) end.date = String(r.end.time).split('T')[0]
        if (r.end.occurrences) end.occurrences = Number(r.end.occurrences)
        node.repeat.end = end
      }
    }
  }

  if (Array.isArray(fm.instances)) {
    node.instances = fm.instances.map((inst: any) => {
      const r: any = {}
      if (inst.date) {
        r.date = String(inst.date)
      } else if (inst.time) {
        const unified = String(inst.time)
        const tMatch  = unified.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/)
        if (tMatch) { r.date = tMatch[1]; if (tMatch[2]) r.time = tMatch[2] }
        else r.date = unified
      }
      if (!r.date) return null
      if (inst.date && inst.time !== undefined) {
        if (typeof inst.time === 'string' && inst.time.match(/^\d{1,2}:\d{2}/)) r.time = inst.time.slice(0, 5)
        else if (typeof inst.time === 'number') {
          const h = Math.floor(inst.time / 60), mn = inst.time % 60
          r.time = String(h).padStart(2, '0') + ':' + String(mn).padStart(2, '0')
        }
      }
      if (inst.timezone) r.timezone = String(inst.timezone)
      if (inst.done !== undefined) r.done = inst.done
      if (inst.priority) r.priority = String(inst.priority)
      if (inst.excluded) r.excluded = true
      if (inst.title) r.title = String(inst.title)
      if (inst.tags) r.tags = Array.isArray(inst.tags) ? inst.tags : [String(inst.tags)]
      if (inst.duration) r.duration = String(inst.duration)
      if (inst.body) r.body = String(inst.body)
      if (inst.repeat && typeof inst.repeat === 'object') {
        const ir = inst.repeat
        const rep: any = { type: String(ir.type) }
        if (ir.type === 'after_completion') {
          if (ir.interval) rep.interval = String(ir.interval)
        } else if (ir.type === 'schedule') {
          if (ir.freq) rep.freq = String(ir.freq)
          if (ir.byweekday) rep.byweekday = Array.isArray(ir.byweekday) ? ir.byweekday.map(String) : [String(ir.byweekday)]
          if (ir.bymonthday) rep.bymonthday = Array.isArray(ir.bymonthday) ? ir.bymonthday.map(Number) : [Number(ir.bymonthday)]
          if (ir.bysetpos !== undefined) rep.bysetpos = Number(ir.bysetpos)
          if (ir.interval) rep.interval = Number(ir.interval)
          if (ir.end && typeof ir.end === 'object') {
            const end: Record<string, unknown> = { type: String(ir.end.type) }
            if (ir.end.date) end.date = String(ir.end.date)
            else if (ir.end.time) end.date = String(ir.end.time).split('T')[0]
            if (ir.end.occurrences) end.occurrences = Number(ir.end.occurrences)
            rep.end = end
          }
        }
        r.repeat = rep
      }
      return r
    }).filter(Boolean)
  }

  // multiday and any other pass-through fields
  if (fm.multiday && typeof fm.multiday === 'object') node.multiday = fm.multiday

  node.type  = node.done !== undefined ? 'task' : 'event'
  node._path = path
  return node as Node
}

async function writeEntityToCache(node: Node): Promise<void> {
  try {
    const path    = nodeToPath(node)
    const rawNode = toRawNode(node) as Record<string, unknown>
    const body    = (rawNode.body as string) || ''
    delete rawNode.body
    const content = saveFile(rawNode, body)
    await cacheWrite(path, content)
    updateSyncUI()
  } catch (e) {
    console.error('[storage] writeEntityToCache failed:', e)
  }
}

async function deleteNodeFromDisk(node: Node): Promise<void> {
  try {
    const dh   = getDirHandle()
    const path = nodeToPath(node)
    await cacheDelete(path)
    if (dh) await diskDelete(dh, path)
    updateSyncUI()
  } catch (e) {
    console.error('[storage] deleteNodeFromDisk failed:', e)
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
    // Flash the sync button green briefly, then settle to the synced state.
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
  const loaded: Node[] = []
  for (const { path, content } of files) {
    await cacheWriteClean(path, content)
    try {
      const { rawNode, body } = loadFile(path, content)
      const node = rawToNode(path, rawNode, body)
      if (node?.title) loaded.push(node)
    } catch (e) { console.warn('[storage] parse failed for', path, e) }
  }
  setNodes(loaded)
  setItems(nodesToStoreItems(loaded))
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
    if (!h) { setNodes(SEED_NODES); setItems(nodesToStoreItems(SEED_NODES)); return }
    const perm = await h.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') {
      setDirHandle(h)
      await loadFilesFromDisk()
    } else if (perm === 'prompt') {
      _pendingDirHandle = h
      useStore.setState({ pendingDirReconnect: h.name })
    } else {
      await dirHandleClear()
      setNodes(SEED_NODES); setItems(nodesToStoreItems(SEED_NODES))
    }
  } catch (e) {
    console.warn('[storage] tryRestoreDirectory failed:', e)
    setNodes(SEED_NODES); setItems(nodesToStoreItems(SEED_NODES))
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
  // Nodes stay empty until tryRestoreDirectory() resolves — if no vault is
  // found it will fall back to SEED_NODES, avoiding a flash of example content.
}

// syncToDirectory and pickDirectory are exported and called directly from App.tsx.
