import Dexie from 'dexie'
import { fmtISO, fmtT, nodeDateTime, parseDateString } from './model/expand'
import { nodeToFile, fileToNode, titleToSlug } from './yaml'
import { splitNode } from './model/nodeOps'
import { serializeRawNode } from './model/inheritance'
// Type-only imports — used in exported function signatures so consumers get full type safety.
import type { Node, Occurrence, Repeat, Scheduled, Instance } from './types'
import { useStore } from './store'
import { TODAY } from './constants'

// ── FILE SYSTEM ACCESS API ─────────────────────────────────────
// These methods exist in all modern browsers but aren't yet in TypeScript's
// built-in DOM lib (as of TS 5.8). Extend the existing interfaces via merging.
declare global {
  interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemFileHandle]>
    queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
    requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  }
}

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
const getNodes      = (): Node[]  => useStore.getState().nodes
const setNodes      = (n: Node[]) => useStore.setState({ nodes: n })
const bumpId        = (): number  => useStore.getState().bumpId()
const getPrimary    = ()          => useStore.getState().primaryView
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
  const t = !!fmtT(o.time), ev = o.type === 'event'
  return (o.done ? 8 : 0) + (t ? 0 : 2) + (ev ? 0 : 1)
}
function _prioKey(o: Occurrence): number { return o.priority ? (_prioOrder[o.priority] ?? 3) : 3 }
export function sortOccs(arr: Occurrence[]): Occurrence[] {
  return arr.sort((a: Occurrence, b: Occurrence) => {
    const sd = _sortKey(a) - _sortKey(b); if (sd) return sd
    const pd = _prioKey(a) - _prioKey(b); if (pd) return pd
    const td = (a.jsTime?.getHours() || 0) * 60 + (a.jsTime?.getMinutes() || 0)
             - (b.jsTime?.getHours() || 0) * 60 - (b.jsTime?.getMinutes() || 0)
    if (td) return td
    return (a.title || '').localeCompare(b.title || '')
  })
}

// ── AGENDA ──────────────────────────────────────────────────────
// buildAgenda(), makeOccRow(), flipResortSection(), insertOccIntoAgenda(),
// findOccWrapInAgenda(), removeOccWrapFromAgenda() are deleted.
// AgendaView (src/components/AgendaView.tsx) subscribes to the Zustand store
// and re-renders automatically whenever nodes change.
// Filtering is handled via useStore's filterQuery field.

export function occState(o: Occurrence): string {
  if (o.done) return 'done'
  if (o.type === 'task' || o.done !== undefined) {
    const p = o.priority
    if (p === 'high') return 'task-p1'
    if (p === 'medium') return 'task-p2'
    if (p === 'low') return 'task-p3'
    return 'task-open'
  }
  if (o.multiday) return 'event-future'
  const now = new Date()
  if (o.jsTime < now) return 'event-past'
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
  const newDone = !o.done
  o.done = newDone // update the occurrence for optimistic UI
  const node = o._node
  if (!node) return
  const updated = cloneNode(node)
  const jsT = o.jsTime
  if (node.repeat) {
    const inst = updated.instances?.find((i: Instance) => {
      const t = nodeDateTime(i) || parseDateString(i.date)
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
  const node = o._node || o
  const nodeId = node.id
  const title = node.title
  let cancelled = false

  if (o.recur) {
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
  if (o.multiday) return 'multiday'
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
  const root = item._node || item
  const occDate = item.date || root.date || null
  const occTime = item.time || root.time || null
  const rootDate = root.date || null
  const rootTime = root.time || null
  if (scope === 'single') return { scheduled: occDate ? { date: occDate, time: occTime || '' } : null, repeat: null }
  if (scope === 'future') return { scheduled: occDate ? { date: occDate, time: occTime || '' } : null, repeat: root.repeat || null }
  if (scope === 'add') return { scheduled: { date: fmtISO(TODAY), time: occTime || '' }, repeat: null }
  return { scheduled: rootDate ? { date: rootDate, time: rootTime || '' } : null, repeat: root.repeat || null }
}

export function buildBodyHtml(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, ref: string, label: string) => {
      const target = getNodes().find(n => n.title.toLowerCase() === ref.toLowerCase())
      return `<span class="${target ? 'wl' : 'wl-broken'}" data-ref="${ref}">[[${label || ref}]]</span>`
    })
    .replace(/\n/g, '<br>')
}

export function closeEntry(): void { popOverlayFn() }

export function saveNode(item: Occurrence | null, editScope: string, fields: any): void {
  const { title, tags, body, tracked, done, priority, scheduled, duration, repeat } = fields
  if (!title) return
  const rootNode = item ? (item._node || item) : null
  const nodes = getNodes()
  const existingIdx = rootNode ? nodes.findIndex(n => n === rootNode || (n.id && n.id === rootNode.id)) : -1
  const isNew = existingIdx < 0

  // Build the field accumulator with all possible Node properties.
  const f: Partial<Node> & { title: string } = { title, tags, body: body || undefined }
  if (tracked) { f.done = done; if (priority) f.priority = priority }
  if (scheduled?.date) { f.date = scheduled.date; f.time = scheduled.time || undefined; f.duration = duration || undefined }
  if (repeat) f.repeat = repeat

  if (isNew) {
    const node: Partial<Node> & { id: string } = { id: 'node-' + bumpId(), ...f }
    if (!tracked) delete node.done
    if (!scheduled) { delete node.date; delete node.time; delete node.duration }
    node.repeat = repeat || undefined
    setNodes([...nodes, node as Node])
    writeEntityToCache(node as Node)
    closeEntry()
    return
  }

  const node = nodes[existingIdx]

  if (editScope === 'add') {
    // Add a one-off occurrence to the series (or to a non-recurring node)
    if (!f.date) { notify('Please set a date for the new occurrence.'); return }
    const updated = cloneNode(node)
    if (!updated.instances) updated.instances = []
    // For non-recurring nodes: migrate root date into instances so all occurrences
    // are explicit in the YAML (root node.date stays as metadata)
    if (!updated.repeat && updated.date) {
      const alreadyCovered = updated.instances.some((i: Instance) => i.date === updated.date && !i.excluded)
      if (!alreadyCovered) {
        const rootInst: Instance = { date: updated.date }
        if (updated.time) rootInst.time = updated.time
        updated.instances.unshift(rootInst)
      }
    }
    const newInst: any = { date: f.date }
    if (f.time) newInst.time = f.time
    if (f.duration && f.duration !== updated.duration) newInst.duration = f.duration
    if (f.title !== updated.title) newInst.title = f.title
    if (f.body && f.body !== updated.body) newInst.body = f.body
    if (tracked && f.done !== undefined) newInst.done = f.done
    if (tracked && f.priority && f.priority !== updated.priority) newInst.priority = f.priority
    updated.instances.push(newInst)
    setNodes(replaceNode(nodes, node.id, updated))
    writeEntityToCache(updated)
    closeEntry()
    return
  }

  if (editScope === 'all' || !node.repeat) {
    const updated: Node = { ...cloneNode(node), ...f }
    if (!tracked) delete updated.done
    if (!scheduled) { delete updated.date; delete updated.time; delete updated.duration }
    if (repeat) updated.repeat = repeat; else delete updated.repeat
    if (updated.tags && updated.tags.length === 0) delete updated.tags
    setNodes(replaceNode(nodes, node.id, updated))
    writeEntityToCache(updated)

  } else if (editScope === 'single') {
    const updated = cloneNode(node)
    if (!updated.instances) updated.instances = []
    const occDate = item!.date
    const occTime = item!.time || undefined
    const newDate = f.date
    const newTime = f.time || undefined
    const isRescheduled = newDate !== occDate || (newTime && newTime !== occTime)
    if (isRescheduled) {
      let excl = updated.instances.find((i: Instance) => i.date === occDate && (!i.time || i.time === occTime))
      if (excl) { excl.excluded = true; delete excl.done }
      else { updated.instances.push({ date: occDate, excluded: true }) }
      const newInst: any = { date: newDate }
      if (newTime) newInst.time = newTime
      if (f.title !== node.title) newInst.title = f.title
      if (f.body !== node.body) newInst.body = f.body
      if (f.tags?.length && JSON.stringify(f.tags) !== JSON.stringify(node.tags)) newInst.tags = f.tags
      if (f.duration !== node.duration) newInst.duration = f.duration
      if (tracked && f.done !== undefined) newInst.done = f.done
      if (tracked && f.priority !== node.priority) newInst.priority = f.priority || undefined
      updated.instances.push(newInst)
    } else {
      let inst = updated.instances.find((i: Instance) => i.date === occDate && (!i.time || i.time === occTime))
      if (!inst) { inst = { date: occDate }; if (occTime) inst.time = occTime; updated.instances.push(inst) }
      if (f.title !== node.title) inst.title = f.title; else delete inst.title
      if (f.body !== node.body) inst.body = f.body; else delete inst.body
      if (f.tags?.length && JSON.stringify(f.tags) !== JSON.stringify(node.tags)) inst.tags = f.tags; else delete inst.tags
      if (f.duration !== node.duration) inst.duration = f.duration; else delete inst.duration
      if (tracked && f.done !== undefined) inst.done = f.done; else delete inst.done
      if (tracked && f.priority !== node.priority) inst.priority = f.priority || undefined; else delete inst.priority
    }
    setNodes(replaceNode(nodes, node.id, updated))
    writeEntityToCache(updated)

  } else if (editScope === 'future') {
    const occDate = item!.date
    // Convert to RawNode (strips _path, id, type, etc.) so splitNode works on clean data
    const rawNode = toRawNode(node)
    // Split into two series at occDate
    const [series1, series2raw] = splitNode(rawNode, occDate)
    // Apply the user's edits to the future series (series2)
    const series2: Record<string, unknown> = { ...series2raw }
    if (f.date && f.date !== occDate) series2.date = f.date
    if (f.time) series2.time = f.time; else delete series2.time
    if (f.title !== node.title) series2.title = f.title
    if (JSON.stringify(f.tags) !== JSON.stringify(node.tags)) series2.tags = f.tags
    if (f.duration !== node.duration) series2.duration = f.duration
    if (f.body !== node.body) series2.body = f.body
    // If the user changed the repeat pattern, apply it; otherwise series2 inherits the original
    if (repeat) series2.repeat = repeat
    if (tracked && f.done !== undefined) series2.done = f.done
    // Build a container node: no root date/time/repeat, just the shared fields + instances
    const container: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rawNode)) {
      if (['date', 'time', 'repeat', 'instances'].includes(k)) continue
      container[k] = v
    }
    container.instances = [series1, series2]
    // Restore runtime tracking fields so the store can identify this node
    const updated = { ...container, id: node.id, _path: node._path } as Node
    setNodes(replaceNode(nodes, node.id, updated))
    writeEntityToCache(updated)
  }

  closeEntry()
}

export function deleteNode(
  item: Occurrence | null,
  onShowSeries?: (config: SeriesSheetConfig) => void,
  onHideSeries?: () => void,
  onConfirmSingle?: (title: string, onConfirm: () => void) => void,
): void {
  if (!item) return
  const node = item._node || item
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

// ── DEXIE (IndexedDB cache) ───────────────────────────────────

interface CacheRecord {
  path: string
  content: string
  dirty: number
  updatedAt: number
}

interface MetaRecord {
  key: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any
}

class MeridianDB extends Dexie {
  files!: Dexie.Table<CacheRecord, string>
  meta!: Dexie.Table<MetaRecord, string>
  constructor() {
    super('meridian_v2')
    this.version(1).stores({ files: 'path,dirty,updatedAt' })
    this.version(2).stores({ files: 'path,dirty,updatedAt', meta: 'key' })
  }
}

let db: MeridianDB | null = null
let _cacheInitPromise: Promise<MeridianDB> | null = null

async function cacheInit(): Promise<MeridianDB> {
  if (db) return db
  if (_cacheInitPromise) return _cacheInitPromise
  _cacheInitPromise = (async () => {
    db = new MeridianDB()
    await db.open()
    return db
  })()
  return _cacheInitPromise
}

async function cacheWrite(path: string, content: string): Promise<void> {
  const d = await cacheInit()
  await d.files.put({ path, content, dirty: 1, updatedAt: Date.now() })
}

async function cacheWriteClean(path: string, content: string): Promise<void> {
  const d = await cacheInit()
  await d.files.put({ path, content, dirty: 0, updatedAt: Date.now() })
}

async function cacheDelete(path: string): Promise<void> {
  const d = await cacheInit()
  await d.files.delete(path)
}

async function cacheGetDirty(): Promise<CacheRecord[]> {
  const d = await cacheInit()
  return d.files.where('dirty').equals(1).toArray()
}

async function cacheMarkClean(path: string): Promise<void> {
  const d = await cacheInit()
  await d.files.update(path, { dirty: 0 })
}

async function cacheDirtyCount(): Promise<number> {
  if (!db) return 0
  try { return await db.files.where('dirty').equals(1).count() }
  catch { return 0 }
}

async function dirHandleSave(h: FileSystemDirectoryHandle): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: 'dirHandle', value: h })
}

async function dirHandleLoad(): Promise<FileSystemDirectoryHandle | null> {
  const d = await cacheInit()
  const record = await d.meta.get('dirHandle')
  return (record?.value as FileSystemDirectoryHandle) ?? null
}

async function dirHandleClear(): Promise<void> {
  const d = await cacheInit()
  await d.meta.delete('dirHandle')
}

// Module-level pending handle (needs user gesture before requestPermission can be called).
let _pendingDirHandle: FileSystemDirectoryHandle | null = null

async function diskPickDirectory(): Promise<void> {
  if (!window.showDirectoryPicker) {
    throw new Error('Your browser does not support folder access. Use Chrome or Edge, and open this file directly (not in a preview).')
  }
  try {
    const h = await window.showDirectoryPicker({ mode: 'readwrite' })
    setDirHandle(h)
    await dirHandleSave(h)
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    if ((e as Error).name === 'SecurityError') {
      throw new Error('Folder access is blocked here. This happens inside embedded previews. Save this HTML file and open it directly in Chrome or Edge.')
    }
    throw e
  }
}

async function diskReadAll(): Promise<Array<{ path: string; content: string }>> {
  const dh = getDirHandle()
  if (!dh) return []
  const results: Array<{ path: string; content: string }> = []
  for await (const [name, fh] of dh.entries()) {
    if (!name.endsWith('.md') && !name.endsWith('.yaml') && !name.endsWith('.yml')) continue
    try {
      const file = await fh.getFile()
      const content = await file.text()
      results.push({ path: name, content })
    } catch (e) { console.warn('[storage] could not read', name, e) }
  }
  return results
}

async function diskWrite(path: string, content: string): Promise<void> {
  const dh = getDirHandle()
  if (!dh) throw new Error('No vault folder connected')
  const perm = await dh.queryPermission({ mode: 'readwrite' })
  if (perm !== 'granted') {
    const ask = await dh.requestPermission({ mode: 'readwrite' })
    if (ask !== 'granted') throw new Error('Write permission denied')
  }
  const fh = await dh.getFileHandle(path, { create: true })
  const w = await fh.createWritable()
  await w.write(content)
  await w.close()
}

async function diskDelete(path: string): Promise<void> {
  const dh = getDirHandle()
  if (!dh) return
  try { await dh.removeEntry(path) } catch { }
}

/** Runtime/internal fields that must not be written to YAML. */
const _INTERNAL_FIELDS = new Set(['id', '_path', '_node', '_nodeId', 'type', 'jsTime', 'recur'])

/** Strip runtime fields from a Node to get a plain RawNode suitable for serializeRawNode. */
function toRawNode(node: Node): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    if (!_INTERNAL_FIELDS.has(k)) result[k] = v
  }
  return result
}

/** A container node has no root repeat but has instances that carry their own repeat. */
function isContainerNode(node: Node): boolean {
  return !node.repeat && Array.isArray(node.instances) &&
    (node.instances as any[]).some(i => i && i.repeat)
}

async function writeEntityToCache(node: Node): Promise<void> {
  try {
    const path = nodeToPath(node)
    const rawNode = toRawNode(node) as any
    const body = rawNode.body || ''
    delete rawNode.body
    const content = isContainerNode(node)
      ? serializeRawNode(rawNode, body)
      : nodeToFile(node)
    await cacheWrite(path, content)
    updateSyncUI()
  } catch (e) {
    console.error('[storage] writeEntityToCache failed:', e)
  }
}

async function deleteNodeFromDisk(node: Node): Promise<void> {
  try {
    const path = nodeToPath(node)
    await cacheDelete(path)
    await diskDelete(path)
    updateSyncUI()
  } catch (e) {
    console.error('[storage] deleteNodeFromDisk failed:', e)
  }
}

export async function syncToDirectory(): Promise<void> {
  try {
    if (!getDirHandle()) { notify('No vault folder connected. Click the folder icon first.'); return }
    const dirty = await cacheGetDirty()
    if (!dirty.length) { updateSyncUI(); return }
    for (const f of dirty) {
      await diskWrite(f.path, f.content)
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
  const files = await diskReadAll()
  const loaded: Node[] = []
  for (const { path, content } of files) {
    await cacheWriteClean(path, content)
    try {
      const node = fileToNode(path, content) as Node
      if (node.title) loaded.push(node)
    } catch (e) { console.warn('[storage] parse failed for', path, e) }
  }
  setNodes(loaded)
  updateSyncUI()
  setTimeout(() => goToday(), 100)
}

export async function pickDirectory(): Promise<void> {
  try {
    await cacheInit()
    await diskPickDirectory()
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
    if (!h) { setNodes(SEED_NODES); return }
    const perm = await h.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') {
      setDirHandle(h)
      await loadFilesFromDisk()
    } else if (perm === 'prompt') {
      _pendingDirHandle = h
      useStore.setState({ pendingDirReconnect: h.name })
    } else {
      await dirHandleClear()
      setNodes(SEED_NODES)
    }
  } catch (e) {
    console.warn('[storage] tryRestoreDirectory failed:', e)
    setNodes(SEED_NODES)
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
