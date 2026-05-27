import { useState, useEffect, useCallback } from 'react'
import {
  Menu, FolderSync, FolderOpen, CalendarCheck2, Search,
  ChevronLeft, ChevronRight,
  AlignLeft, CalendarDays, CalendarClock,
  Plus, Calendar, CalendarRange, Clock, Timer, X, Flag, Trash2,
} from 'lucide-react'
import {
  initApp, applyScope, buildBodyHtml,
  saveNode, deleteNode, closeEntry, pushOverlay,
  openDayViewForDate, goToday, openSearch,
  syncToDirectory, pickDirectory,
  addDays, fmtLong,
} from './meridian'
import type { SeriesSheetConfig } from './meridian'
import { fmtISO } from './recurrence'
import { TODAY } from './constants'
import { useStore } from './store'
import type { PrimaryView } from './store'
import EntryEditor, { EntryState, ENTRY_DEFAULT, ItemType } from './components/EntryEditor'
import RepeatDialog from './components/RepeatDialog'
import UndoToast from './components/UndoToast'
import AgendaView from './components/AgendaView'
import MonthView from './components/MonthView'
import DayView from './components/DayView'
import SearchView from './components/SearchView'
import FilterOverlay from './components/FilterOverlay'
import type { Occurrence, Priority } from './types'
import { cn } from './lib/utils'


function entryFromItem(item: any, editScope: string): EntryState {
  if (!item) {
    return { ...ENTRY_DEFAULT, scheduled: { date: fmtISO(TODAY), time: '' } }
  }
  const root = item._node || item
  const { scheduled, repeat } = applyScope(item, editScope)
  const tracked = item.done !== undefined || root.done !== undefined
  const itemType: ItemType = tracked ? 'task' : scheduled ? 'event' : 'note'
  return {
    item: { ...item, _editScope: editScope },
    title: item.title || root.title || '',
    bodyHtml: buildBodyHtml(item.body || root.body || ''),
    scheduled, repeat,
    duration: item.duration || root.duration || '',
    tracked, itemType,
    done: item.done || false,
    tags: [...(item.tags || root.tags || [])],
    priority: item.priority || root.priority || null,
    editScope,
  }
}

// ── Shared bottom-sheet class helpers ─────────────────────────
const dlgOv = (open: boolean) => cn(
  'fixed inset-0 bg-[rgba(9,17,31,.82)] z-[200] flex items-end justify-center',
  'transition-opacity duration-200',
  open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
)
const dlgPanel = (open: boolean) => cn(
  'w-full max-w-[430px] bg-bg2 border-t border-bdr2 rounded-t-[24px] pt-3 pb-10',
  'transition-[transform] duration-[280ms] ease-[cubic-bezier(.4,0,.2,1)]',
  open ? 'translate-y-0' : 'translate-y-full',
)
const dlgHandle = 'w-[34px] h-1 bg-bg4 rounded-[2px] mx-auto mb-3.5'
const dlgTitle  = 'text-[13px] font-bold tracking-[.07em] uppercase text-t3 px-[18px] pb-[10px] border-b border-bdr mb-2'
const dlgBody   = 'px-4'
const dlgRow    = 'flex items-center justify-between py-[11px] border-b border-bdr last:border-none'
const dlgLbl    = 'text-[13px] text-t2 flex items-center gap-[7px] [&_svg]:w-[15px] [&_svg]:h-[15px] [&_svg]:stroke-current [&_svg]:fill-none [&_svg]:stroke-[1.8]'
const dlgIn     = 'bg-bg3 border border-transparent rounded-[8px] px-[11px] py-[7px] text-[13px] font-mono text-t0 outline-none transition-colors focus:border-ind placeholder:text-t3'
const dlgActions= 'flex justify-between items-center mt-4 pt-3 border-t border-bdr'
const dlgRm     = 'text-[12px] text-ros px-3 py-2 rounded-[20px] flex items-center gap-1 [&_svg]:w-[13px] [&_svg]:h-[13px]'
const dlgCancel = 'text-[13px] text-t3 px-3.5 py-2 rounded-[20px]'
const dlgOk     = 'text-[13px] font-semibold text-white bg-gradient-to-br from-ind2 to-cyn2 px-5 py-2 rounded-[20px]'

// Icon button (topbar / sidebar nav)
const ib = 'size-[34px] rounded-full flex items-center justify-center text-t2 transition-colors hover:bg-bg3 hover:text-t0 shrink-0'

export default function App() {
  const [entry, setEntry]             = useState<EntryState>(ENTRY_DEFAULT)
  const [activeDialog, setActiveDialog] = useState<string | null>(null)
  const [dlgDateVal, setDlgDateVal]   = useState('')
  const [dlgTimeVal, setDlgTimeVal]   = useState('')
  const [dlgDurVal,  setDlgDurVal]    = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ title: string; onConfirm: () => void } | null>(null)
  const [seriesSheetConfig, setSeriesSheetConfig] = useState<SeriesSheetConfig | null>(null)

  const primaryView  = useStore(s => s.primaryView)
  const setPrimary   = useStore(s => s.setPrimaryView)
  const overlayStack = useStore(s => s.overlayStack)
  const popOverlay   = useStore(s => s.popOverlay)
  const topOverlay   = overlayStack[overlayStack.length - 1]

  const dvDate    = useStore(s => s.dvDate)
  const setDvDate = useStore(s => s.setDvDate)

  const syncDirtyCount      = useStore(s => s.syncDirtyCount)
  const syncFlash           = useStore(s => s.syncFlash)
  const dirHandle           = useStore(s => s.dirHandle)
  const errorNotification   = useStore(s => s.errorNotification)
  const setErrorNotification= useStore(s => s.setErrorNotification)

  const syncColor = syncFlash
    ? 'var(--color-grn)'
    : !dirHandle ? 'var(--color-t3)' : syncDirtyCount > 0 ? 'var(--color-amb)' : 'var(--color-t2)'
  const syncTitle = !dirHandle
    ? 'Click folder icon to open vault'
    : syncDirtyCount > 0
      ? `${syncDirtyCount} unsaved change${syncDirtyCount > 1 ? 's' : ''} — click to sync`
      : 'All synced'

  // Which section is the "active" view (primary or overlay)
  const viewCls = (name: string) => {
    const active = topOverlay ? name === topOverlay : name === primaryView
    return cn('flex-col overflow-hidden', active ? 'flex flex-1' : 'hidden')
  }

  const showTopbar      = topOverlay === undefined
  const showDayHeader   = showTopbar && primaryView === 'day'
  const showBottomFloat = topOverlay === undefined

  useEffect(() => {
    ;(window as any).openEntry = (item: any, scope?: string, prefillTitle?: string) => {
      const editScope = scope ?? (item ? 'single' : 'all')
      const state = entryFromItem(item, editScope)
      setEntry(prefillTitle && !item ? { ...state, title: prefillTitle } : state)
      pushOverlay('entry')
    }
    initApp()
    setTimeout(() => {
      const sec = document.querySelector(`.day-section[data-key="${TODAY.getFullYear()}-${String(TODAY.getMonth()+1).padStart(2,'0')}-${String(TODAY.getDate()).padStart(2,'0')}"]`)
      if (sec) sec.scrollIntoView({ behavior: 'instant', block: 'start' })
    }, 200)
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveDialog(null) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const openEntry = useCallback((item: any, scope?: string, prefillTitle?: string) => {
    const editScope = scope ?? (item ? 'single' : 'all')
    const state = entryFromItem(item, editScope)
    setEntry(prefillTitle && !item ? { ...state, title: prefillTitle } : state)
    pushOverlay('entry')
  }, [])

  const handleSave   = useCallback((body: string) => { saveNode(entry.item, entry.editScope, { ...entry, body }) }, [entry])
  const handleDelete = useCallback(() => {
    deleteNode(entry.item, config => setSeriesSheetConfig(config), () => setSeriesSheetConfig(null), (title, onConfirm) => setPendingDelete({ title, onConfirm }))
  }, [entry.item])
  const handleClose  = useCallback(() => { closeEntry() }, [])

  const handleScopeChange = useCallback((scope: string) => {
    setEntry(prev => {
      if (!prev.item) return prev
      const { scheduled, repeat } = applyScope(prev.item, scope)
      return { ...prev, editScope: scope, scheduled, repeat }
    })
  }, [])

  const handleOpenDlg = useCallback((id: string) => {
    if (id === 'dlgSched') setDlgDateVal(entry.scheduled?.date || fmtISO(TODAY))
    if (id === 'dlgTime')  setDlgTimeVal(entry.scheduled?.time || '')
    if (id === 'dlgDur')   setDlgDurVal(entry.duration || '')
    setActiveDialog(id)
  }, [entry.scheduled, entry.duration])

  const handleOpenRepeatDlg = useCallback(() => { setActiveDialog('dlgRepeat') }, [])
  const closeDialog         = useCallback(() => setActiveDialog(null), [])

  const confirmSched = useCallback(() => {
    if (!dlgDateVal) return
    setEntry(prev => ({ ...prev, scheduled: { date: dlgDateVal, time: prev.scheduled?.time || '' } }))
    setActiveDialog(null)
  }, [dlgDateVal])

  const removeSched = useCallback(() => { setEntry(prev => ({ ...prev, scheduled: null, duration: '' })); setActiveDialog(null) }, [])

  const confirmTime = useCallback(() => {
    setEntry(prev => prev.scheduled ? { ...prev, scheduled: { ...prev.scheduled, time: dlgTimeVal } } : prev)
    setActiveDialog(null)
  }, [dlgTimeVal])

  const removeTime = useCallback(() => {
    setEntry(prev => prev.scheduled ? { ...prev, scheduled: { ...prev.scheduled, time: '' } } : prev)
    setActiveDialog(null)
  }, [])

  const confirmDur = useCallback(() => { setEntry(prev => ({ ...prev, duration: dlgDurVal.trim() })); setActiveDialog(null) }, [dlgDurVal])
  const removeDur  = useCallback(() => { setEntry(prev => ({ ...prev, duration: '' })); setActiveDialog(null) }, [])

  const setPriority = useCallback((p: Priority | null) => { setEntry(prev => ({ ...prev, priority: p })); setActiveDialog(null) }, [])

  const closeDlgOv = (e: React.MouseEvent) => { if (e.target === e.currentTarget) setActiveDialog(null) }
  const navTo = (v: PrimaryView) => { setSidebarOpen(false); setPrimary(v) }

  const isOpen = (id: string) => activeDialog === id

  return (
    <>
      <div id="app">

        {/* ── TOPBAR ── */}
        {showTopbar && (
          <header className="h-[var(--th)] flex items-center justify-between px-3.5 border-b border-bdr shrink-0 bg-bg1 z-10" id="mainTop">
            {showDayHeader ? (
              <div className="flex-1 flex items-center gap-1 overflow-hidden">
                <button className={ib} onClick={() => setSidebarOpen(true)} title="Menu">
                  <Menu size={18} strokeWidth={1.8} />
                </button>
                <span className="flex-1 font-display italic text-[15px] text-t0 whitespace-nowrap overflow-hidden text-ellipsis">
                  {fmtLong(dvDate)}
                </span>
                <button className={ib} onClick={() => setDvDate(addDays(dvDate, -1))}><ChevronLeft size={18} strokeWidth={1.8} /></button>
                <button className={ib} onClick={() => setDvDate(addDays(dvDate, 1))}><ChevronRight size={18} strokeWidth={1.8} /></button>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0" id="tbDefault">
                <button className={ib} onClick={() => setSidebarOpen(true)} title="Menu">
                  <Menu size={18} strokeWidth={1.8} />
                </button>
                <img src={`${import.meta.env.BASE_URL}icon-192.png`} width="26" height="26" style={{ borderRadius: 5 }} alt="Meridian" />
                <span className="font-display italic text-base text-t1">Meridian</span>
              </div>
            )}
            <div className="flex items-center gap-0.5 shrink-0">
              <button className={ib} onClick={syncToDirectory} title={syncTitle} style={{ color: syncColor }}><FolderSync size={18} strokeWidth={1.8} /></button>
              <button className={ib} onClick={pickDirectory}   title="Open vault"><FolderOpen size={18} strokeWidth={1.8} /></button>
              <button className={ib} onClick={goToday}         title="Today"><CalendarCheck2 size={18} strokeWidth={1.8} /></button>
              <button className={ib} onClick={openSearch}      title="Search"><Search size={18} strokeWidth={1.8} /></button>
            </div>
          </header>
        )}

        {/* ── PRIMARY VIEWS ── */}
        <section className={viewCls('agenda')} id="view-agenda">
          <div className="flex-1 overflow-y-auto" id="agSc">
            <AgendaView onOpen={(occ: Occurrence, scope?: string) => openEntry(occ, scope ?? 'single')} />
          </div>
        </section>

        <section className={viewCls('calendar')} id="view-calendar">
          <MonthView onDayClick={openDayViewForDate} />
        </section>

        <section className={viewCls('day')} id="view-day">
          <DayView onOpen={(occ: Occurrence, scope?: string) => openEntry(occ, scope ?? 'single')} />
        </section>

        {/* ── OVERLAY VIEWS ── */}
        <section className={viewCls('search')} id="view-search">
          <SearchView
            onOpen={(item: any, scope?: string) => openEntry(item, scope ?? (item?._node ? 'single' : 'all'))}
            onClose={popOverlay}
          />
        </section>

        <section className={viewCls('entry')} id="view-entry">
          <EntryEditor
            entry={entry}
            onChange={setEntry}
            onSave={handleSave}
            onDelete={handleDelete}
            onClose={handleClose}
            onOpenDlg={handleOpenDlg}
            onOpenRepeatDlg={handleOpenRepeatDlg}
            onScopeChange={handleScopeChange}
          />
        </section>

        {/* ── SIDEBAR ── */}
        <div
          className={cn(
            'absolute inset-0 bg-[rgba(0,0,0,.45)] z-[80] transition-opacity duration-[220ms] ease-in-out',
            sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
          )}
          onClick={() => setSidebarOpen(false)}
        />
        <div className={cn(
          'absolute top-0 left-0 bottom-0 w-[260px] bg-bg2 border-r border-bdr2 z-[81]',
          'flex flex-col overflow-hidden',
          'transition-[transform] duration-[250ms] ease-[cubic-bezier(.4,0,.2,1)]',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}>
          <div className="h-[var(--th)] flex items-center gap-[10px] px-4 border-b border-bdr shrink-0">
            <img src={`${import.meta.env.BASE_URL}icon-192.png`} width="26" height="26" style={{ borderRadius: 5 }} alt="Meridian" />
            <span className="font-display italic text-base text-t1">Meridian</span>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {([
              { view: 'agenda'   as PrimaryView, Icon: AlignLeft,    label: 'Agenda' },
              { view: 'calendar' as PrimaryView, Icon: CalendarDays,  label: 'Month'  },
              { view: 'day'      as PrimaryView, Icon: CalendarClock, label: 'Day'    },
            ]).map(({ view, Icon, label }) => (
              <button
                key={view}
                className={cn(
                  'w-full flex items-center gap-3.5 px-5 py-[13px] text-[14px] font-medium transition-[background,color] duration-[120ms] text-left',
                  primaryView === view && !topOverlay ? 'text-ind bg-ab' : 'text-t2 hover:bg-bg3',
                )}
                onClick={() => navTo(view)}
              >
                <Icon size={19} strokeWidth={1.7} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── FILTER OVERLAY ── */}
        {showBottomFloat && (
          <FilterOverlay
            query={filterQuery}
            onOpen={(occ: Occurrence) => openEntry(occ, 'single')}
            onCreate={(title: string) => { openEntry(null, undefined, title); setFilterQuery('') }}
          />
        )}

        {/* ── BOTTOM FLOAT: toast + search bar ── */}
        {showBottomFloat && (
          <div className="absolute bottom-[calc(var(--nh)+14px)] left-3.5 right-3.5 flex flex-col gap-2 pointer-events-none z-50">
            <UndoToast />
            <div className="shrink-0 flex items-center gap-2 bg-bg3 border border-[rgba(148,163,184,.18)] rounded-[26px] pl-3.5 pr-1.5 h-[52px] pointer-events-auto transition-[box-shadow,border-color] duration-200 shadow-[0_2px_12px_rgba(0,0,0,.5),0_10px_40px_rgba(99,102,241,.18),0_0_0_1px_rgba(129,140,248,.06)] focus-within:border-[rgba(129,140,248,.35)] focus-within:shadow-[0_2px_12px_rgba(0,0,0,.5),0_10px_44px_rgba(99,102,241,.3),0_0_0_1px_rgba(129,140,248,.18)]">
              <Search size={15} className="stroke-t3 fill-none shrink-0" strokeWidth={2} />
              <input
                id="filterInput"
                className="flex-1 bg-transparent border-0 outline-none text-t0 text-[14px] min-w-0 placeholder:text-t3"
                placeholder="Search or create…"
                value={filterQuery}
                onChange={e => setFilterQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && filterQuery) { openEntry(null, undefined, filterQuery); setFilterQuery('') }
                }}
              />
              {filterQuery && (
                <button
                  className="size-7 rounded-full flex items-center justify-center text-t3 transition-colors hover:bg-bg3 hover:text-t0 shrink-0"
                  onClick={() => setFilterQuery('')}
                >
                  <X size={13} strokeWidth={2} />
                </button>
              )}
              <button
                className="size-9 rounded-full bg-gradient-to-br from-ind2 to-cyn2 flex items-center justify-center text-white shrink-0 transition-[transform,box-shadow] duration-150 shadow-[0_2px_10px_rgba(99,102,241,.4)] hover:scale-[1.08] hover:shadow-[0_4px_16px_rgba(99,102,241,.6)] active:scale-[.93]"
                onClick={() => { openEntry(null, undefined, filterQuery || undefined); if (filterQuery) setFilterQuery('') }}
              >
                <Plus size={16} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        )}

      </div>{/* end #app */}

      {/* ── DIALOGS ── */}

      {/* DATE */}
      <div className={dlgOv(isOpen('dlgSched'))} id="dlgSched" onClick={closeDlgOv}>
        <div className={dlgPanel(isOpen('dlgSched'))}>
          <div className={dlgHandle} />
          <div className={dlgTitle}>Date</div>
          <div className={dlgBody}>
            <div className={dlgRow}>
              <span className={dlgLbl}><Calendar />Date</span>
              <input className={dlgIn} type="date" id="dlgDate" value={dlgDateVal} onChange={e => setDlgDateVal(e.target.value)} />
            </div>
            <div className={dlgActions}>
              <button className={dlgRm} onClick={removeSched}><X size={13} />Remove</button>
              <div className="flex gap-2">
                <button className={dlgCancel} onClick={closeDialog}>Cancel</button>
                <button className={dlgOk} onClick={confirmSched}>Set</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PRIORITY */}
      <div className={dlgOv(isOpen('dlgPriority'))} id="dlgPriority" onClick={closeDlgOv}>
        <div className={dlgPanel(isOpen('dlgPriority'))}>
          <div className={dlgHandle} />
          <div className={dlgTitle}>Priority</div>
          <div className={dlgBody}>
            <div className="flex flex-col gap-2">
              <button className="text-[13px] font-semibold px-5 py-2 rounded-[20px] bg-[rgba(248,113,113,.15)] text-p1 border border-p1 flex items-center gap-2" onClick={() => setPriority('high')}><Flag size={14} /> High</button>
              <button className="text-[13px] font-semibold px-5 py-2 rounded-[20px] bg-[rgba(251,146,60,.15)]  text-p2 border border-p2 flex items-center gap-2" onClick={() => setPriority('medium')}><Flag size={14} /> Medium</button>
              <button className="text-[13px] font-semibold px-5 py-2 rounded-[20px] bg-[rgba(250,204,21,.15)]  text-p3 border border-p3 flex items-center gap-2" onClick={() => setPriority('low')}><Flag size={14} /> Low</button>
              <button className={dlgRm} onClick={() => setPriority(null)}><X size={13} /> None</button>
            </div>
          </div>
        </div>
      </div>

      {/* TIME */}
      <div className={dlgOv(isOpen('dlgTime'))} id="dlgTime" onClick={closeDlgOv}>
        <div className={dlgPanel(isOpen('dlgTime'))}>
          <div className={dlgHandle} />
          <div className={dlgTitle}>Time</div>
          <div className={dlgBody}>
            <div className={dlgRow}>
              <span className={dlgLbl}><Clock />Time</span>
              <input className={dlgIn} type="time" id="dlgTimeVal" value={dlgTimeVal} onChange={e => setDlgTimeVal(e.target.value)} />
            </div>
            <div className={dlgActions}>
              <button className={dlgRm} onClick={removeTime}><X size={13} />Remove</button>
              <div className="flex gap-2">
                <button className={dlgCancel} onClick={closeDialog}>Cancel</button>
                <button className={dlgOk} onClick={confirmTime}>Set</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* DURATION */}
      <div className={dlgOv(isOpen('dlgDur'))} id="dlgDur" onClick={closeDlgOv}>
        <div className={dlgPanel(isOpen('dlgDur'))}>
          <div className={dlgHandle} />
          <div className={dlgTitle}>Duration</div>
          <div className={dlgBody}>
            <div className={dlgRow}>
              <span className={dlgLbl}><Timer />Duration</span>
              <input className={dlgIn} type="text" id="dlgDurVal" value={dlgDurVal} onChange={e => setDlgDurVal(e.target.value)} placeholder="e.g. 1h 30m" style={{ width: 120 }} />
            </div>
            <div className={dlgActions}>
              <button className={dlgRm} onClick={removeDur}><X size={13} />Remove</button>
              <div className="flex gap-2">
                <button className={dlgCancel} onClick={closeDialog}>Cancel</button>
                <button className={dlgOk} onClick={confirmDur}>Set</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* REPEAT */}
      <RepeatDialog
        open={activeDialog === 'dlgRepeat'}
        scheduled={entry.scheduled}
        tracked={entry.tracked}
        itemType={entry.itemType}
        repeat={entry.repeat}
        onConfirm={repeat => { setEntry(prev => ({ ...prev, repeat })); setActiveDialog(null) }}
        onRemove={() => { setEntry(prev => ({ ...prev, repeat: null })); setActiveDialog(null) }}
        onClose={() => setActiveDialog(null)}
      />

      {/* SERIES DELETE SHEET */}
      <div className={dlgOv(!!seriesSheetConfig)} onClick={e => { if (e.target === e.currentTarget) setSeriesSheetConfig(null) }}>
        <div className={dlgPanel(!!seriesSheetConfig)}>
          <div className={dlgHandle} />
          <div className={dlgTitle}>{seriesSheetConfig?.title ?? ''}</div>
          <div className={dlgBody}>
            {seriesSheetConfig?.options.map((opt, i) => (
              <button
                key={i}
                className="flex items-center gap-3.5 w-full px-[18px] py-3.5 cursor-pointer transition-colors hover:bg-bg3 text-left border-b border-bdr last:border-none"
                onClick={() => { opt.onClick(); setSeriesSheetConfig(null) }}
              >
                {opt.icon === 'calendar' ? <Calendar size={20} className="stroke-ind fill-none shrink-0" strokeWidth={1.8} /> : <CalendarRange size={20} className="stroke-ind fill-none shrink-0" strokeWidth={1.8} />}
                <div>
                  <div className="text-[14px] font-medium text-t0 mb-0.5">{opt.label}</div>
                  <div className="text-[12px] text-t3">{opt.sublabel}</div>
                </div>
              </button>
            ))}
            <button
              className="flex items-center gap-3.5 w-full px-[18px] py-3.5 cursor-pointer transition-colors hover:bg-bg3 text-left text-t3"
              onClick={() => setSeriesSheetConfig(null)}
            >
              <X size={20} className="shrink-0" strokeWidth={1.8} />
              <div><div className="text-[14px] font-medium">Cancel</div></div>
            </button>
          </div>
        </div>
      </div>

      {/* ERROR BANNER */}
      {errorNotification && (
        <div
          className="fixed top-[calc(var(--th)+8px)] left-1/2 -translate-x-1/2 w-[calc(100%-28px)] max-w-[402px] bg-[rgba(251,113,133,.12)] border border-[rgba(251,113,133,.35)] rounded-[10px] px-3 py-[10px] flex items-center gap-[10px] z-[300] shadow-[0_4px_16px_rgba(0,0,0,.3)] [animation:banner-in_.2s_ease]"
          role="alert"
        >
          <span className="flex-1 text-[13px] text-ros leading-[1.4]">{errorNotification}</span>
          <button
            className="size-6 rounded-full flex items-center justify-center text-ros opacity-70 shrink-0 transition-opacity hover:opacity-100"
            onClick={() => setErrorNotification(null)}
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* SINGLE-ITEM DELETE CONFIRM */}
      <div className={dlgOv(!!pendingDelete)} onClick={e => { if (e.target === e.currentTarget) setPendingDelete(null) }}>
        <div className={dlgPanel(!!pendingDelete)}>
          <div className={dlgHandle} />
          <div className={dlgTitle}>Delete</div>
          <div className={dlgBody}>
            <p className="text-[14px] text-t1 mb-4">
              Delete &ldquo;{pendingDelete?.title}&rdquo;? This cannot be undone.
            </p>
            <div className={dlgActions}>
              <button className={dlgRm} onClick={() => { pendingDelete?.onConfirm(); setPendingDelete(null) }}>
                <Trash2 size={13} />Delete
              </button>
              <button className={dlgCancel} onClick={() => setPendingDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
