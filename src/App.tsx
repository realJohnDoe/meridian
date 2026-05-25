import { useState, useEffect, useCallback } from 'react'
import {
  Menu, FolderSync, FolderOpen, CalendarCheck2, Search,
  ChevronLeft, ChevronRight,
  AlignLeft, CalendarDays, CalendarClock,
  Plus, Calendar, Clock, Timer, X, Info, Flag,
} from 'lucide-react'
import {
  initApp, wikilinkInputHandler, wikilinkKeydownHandler, wikilinkClickHandler,
  applyScope, buildBodyHtml,
  saveNode, deleteNode, closeEntry, pushOverlay,
  openRepeatDlg, buildRepeatValue,
  openDayViewForDate, goToday, openSearch,
  addDays, fmtLong,
} from './meridian'
import { useStore } from './store'
import type { PrimaryView } from './store'
import EntryEditor, { EntryState, ENTRY_DEFAULT, ItemType } from './components/EntryEditor'
import AgendaView from './components/AgendaView'
import MonthView from './components/MonthView'
import DayView from './components/DayView'
import SearchView from './components/SearchView'
import FilterOverlay from './components/FilterOverlay'
import type { Occurrence, Priority } from './types'

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0)
function fmtISO(d: Date) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

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
    scheduled,
    repeat,
    duration: item.duration || root.duration || '',
    tracked,
    itemType,
    done: item.done || false,
    tags: [...(item.tags || root.tags || [])],
    priority: item.priority || root.priority || null,
    editScope,
  }
}

export default function App() {
  const [entry, setEntry] = useState<EntryState>(ENTRY_DEFAULT)
  const [activeDialog, setActiveDialog] = useState<string | null>(null)
  const [dlgDateVal, setDlgDateVal] = useState('')
  const [dlgTimeVal, setDlgTimeVal] = useState('')
  const [dlgDurVal, setDlgDurVal] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // ── Navigation state (source of truth) ───────────────────────
  const primaryView  = useStore(s => s.primaryView)
  const setPrimary   = useStore(s => s.setPrimaryView)
  const overlayStack = useStore(s => s.overlayStack)
  const popOverlay   = useStore(s => s.popOverlay)
  const topOverlay   = overlayStack[overlayStack.length - 1] // 'entry' | 'search' | undefined

  const dvDate    = useStore(s => s.dvDate)
  const setDvDate = useStore(s => s.setDvDate)

  // Derive CSS class for each section — only one is 'active' at a time
  const viewCls = (name: string) => {
    const active = topOverlay ? name === topOverlay : name === primaryView
    return active ? 'view active' : 'view'
  }

  // Topbar is hidden while an overlay is open (each has its own header)
  const showTopbar     = topOverlay === undefined
  const showDayHeader  = showTopbar && primaryView === 'day'
  // Bottom search bar: hidden inside overlays
  const showBottomFloat = topOverlay === undefined

  useEffect(() => {
    // Global openEntry hook — lets vanilla-JS agenda/search rows open the editor
    ;(window as any).openEntry = (item: any, scope?: string, prefillTitle?: string) => {
      const editScope = scope ?? (item ? 'single' : 'all')
      const state = entryFromItem(item, editScope)
      setEntry(prefillTitle && !item ? { ...state, title: prefillTitle } : state)
      pushOverlay('entry')
    }
    document.addEventListener('input', wikilinkInputHandler as EventListener)
    document.addEventListener('keydown', wikilinkKeydownHandler as EventListener)
    document.addEventListener('click', wikilinkClickHandler as EventListener)
    initApp()
    // Scroll agenda to today after AgendaView has rendered its sections.
    setTimeout(() => {
      const sec = document.querySelector(`.day-section[data-key="${TODAY.getFullYear()}-${String(TODAY.getMonth()+1).padStart(2,'0')}-${String(TODAY.getDate()).padStart(2,'0')}"]`)
      if (sec) sec.scrollIntoView({ behavior: 'instant', block: 'start' })
    }, 200)
    return () => {
      document.removeEventListener('input', wikilinkInputHandler as EventListener)
      document.removeEventListener('keydown', wikilinkKeydownHandler as EventListener)
      document.removeEventListener('click', wikilinkClickHandler as EventListener)
    }
  }, [])

  const openEntry = useCallback((item: any, scope?: string, prefillTitle?: string) => {
    const editScope = scope ?? (item ? 'single' : 'all')
    const state = entryFromItem(item, editScope)
    setEntry(prefillTitle && !item ? { ...state, title: prefillTitle } : state)
    pushOverlay('entry')
  }, [])

  const handleSave = useCallback((body: string) => {
    saveNode(entry.item, entry.editScope, { ...entry, body })
  }, [entry])

  const handleDelete = useCallback(() => {
    deleteNode(entry.item, () => setActiveDialog('seriesSheet'), () => setActiveDialog(null))
  }, [entry.item])

  const handleClose = useCallback(() => {
    closeEntry()
  }, [])

  const handleScopeChange = useCallback((scope: string) => {
    setEntry(prev => {
      if (!prev.item) return prev
      const { scheduled, repeat } = applyScope(prev.item, scope)
      return { ...prev, editScope: scope, scheduled, repeat }
    })
  }, [])

  const handleOpenDlg = useCallback((id: string) => {
    if (id === 'dlgSched') setDlgDateVal(entry.scheduled?.date || fmtISO(TODAY))
    if (id === 'dlgTime') setDlgTimeVal(entry.scheduled?.time || '')
    if (id === 'dlgDur') setDlgDurVal(entry.duration || '')
    setActiveDialog(id)
  }, [entry.scheduled, entry.duration])

  const handleOpenRepeatDlg = useCallback((itemType?: string) => {
    openRepeatDlg({ scheduled: entry.scheduled, tracked: entry.tracked, repeat: entry.repeat, itemType })
    setActiveDialog('dlgRepeat')
  }, [entry.scheduled, entry.tracked, entry.repeat])

  const closeDialog = useCallback(() => setActiveDialog(null), [])

  const confirmSched = useCallback(() => {
    if (!dlgDateVal) return
    setEntry(prev => ({ ...prev, scheduled: { date: dlgDateVal, time: prev.scheduled?.time || '' } }))
    setActiveDialog(null)
  }, [dlgDateVal])

  const removeSched = useCallback(() => {
    setEntry(prev => ({ ...prev, scheduled: null, duration: '' }))
    setActiveDialog(null)
  }, [])

  const confirmTime = useCallback(() => {
    setEntry(prev => prev.scheduled ? { ...prev, scheduled: { ...prev.scheduled, time: dlgTimeVal } } : prev)
    setActiveDialog(null)
  }, [dlgTimeVal])

  const removeTime = useCallback(() => {
    setEntry(prev => prev.scheduled ? { ...prev, scheduled: { ...prev.scheduled, time: '' } } : prev)
    setActiveDialog(null)
  }, [])

  const confirmDur = useCallback(() => {
    setEntry(prev => ({ ...prev, duration: dlgDurVal.trim() }))
    setActiveDialog(null)
  }, [dlgDurVal])

  const removeDur = useCallback(() => {
    setEntry(prev => ({ ...prev, duration: '' }))
    setActiveDialog(null)
  }, [])

  const confirmRepeat = useCallback(() => {
    const repeat = buildRepeatValue()
    setEntry(prev => ({ ...prev, repeat }))
    setActiveDialog(null)
  }, [])

  const removeRepeat = useCallback(() => {
    setEntry(prev => ({ ...prev, repeat: null }))
    setActiveDialog(null)
  }, [])

  const setPriority = useCallback((p: Priority | null) => {
    setEntry(prev => ({ ...prev, priority: p }))
    setActiveDialog(null)
  }, [])

  const dlgOvClass = (id: string) => activeDialog === id ? 'dlg-ov open' : 'dlg-ov'
  const closeDlgOv = (e: React.MouseEvent) => { if (e.target === e.currentTarget) setActiveDialog(null) }

  // Sidebar nav: switch primary view and close the panel
  const navTo = (v: PrimaryView) => {
    setSidebarOpen(false)
    setPrimary(v)
  }

  return (
    <>
      <div id="app">

        {/* ── TOPBAR ── visible only when no overlay is active */}
        {showTopbar && (
          <header className="topbar" id="mainTop">
            {showDayHeader ? (
              /* Day-view header: date title + prev/next navigation */
              <div className="tb-l" style={{ flex: 1, gap: 4, overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
                <button className="ib" onClick={() => setSidebarOpen(true)} title="Menu"><Menu /></button>
                <span style={{ flex: 1, fontFamily: 'var(--disp)', fontStyle: 'italic', fontSize: 15, color: 'var(--t0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {fmtLong(dvDate)}
                </span>
                <button className="ib" onClick={() => setDvDate(addDays(dvDate, -1))}><ChevronLeft /></button>
                <button className="ib" onClick={() => setDvDate(addDays(dvDate, 1))}><ChevronRight /></button>
              </div>
            ) : (
              /* Default header: logo + app name */
              <div className="tb-l" id="tbDefault">
                <button className="ib" onClick={() => setSidebarOpen(true)} title="Menu"><Menu /></button>
                <img src={`${import.meta.env.BASE_URL}icon-192.png`} width="26" height="26" style={{ borderRadius: 5 }} alt="Meridian" />
                <span className="vault-name">Meridian</span>
              </div>
            )}
            <div className="tb-r">
              <button className="ib" id="syncBtn" onClick={() => (window as any).syncToDirectory()} title="Sync"><FolderSync /></button>
              <button className="ib" onClick={() => (window as any).pickDirectory()} title="Open vault"><FolderOpen /></button>
              <button className="ib" onClick={goToday} title="Today"><CalendarCheck2 /></button>
              <button className="ib" onClick={openSearch} title="Search"><Search /></button>
            </div>
          </header>
        )}

        {/* ── PRIMARY VIEWS ── */}
        <section className={viewCls('agenda')} id="view-agenda">
          <div className="ag-sc" id="agSc">
            <AgendaView onOpen={(occ: Occurrence, scope?: string) => {
              openEntry(occ, scope ?? 'single')
            }} />
          </div>
        </section>

        <section className={viewCls('calendar')} id="view-calendar">
          <MonthView onDayClick={openDayViewForDate} />
        </section>

        <section className={viewCls('day')} id="view-day">
          <DayView onOpen={(occ: Occurrence, scope?: string) => {
            openEntry(occ, scope ?? 'single')
          }} />
        </section>

        {/* ── OVERLAY VIEWS ── */}
        <section className={viewCls('search')} id="view-search">
          <SearchView
            onOpen={(item: any, scope?: string) => {
              openEntry(item, scope ?? (item?._node ? 'single' : 'all'))
            }}
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
          className={`sidebar-ov${sidebarOpen ? ' open' : ''}`}
          onClick={() => setSidebarOpen(false)}
        />
        <div className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="sidebar-head">
            <img src={`${import.meta.env.BASE_URL}icon-192.png`} width="26" height="26" style={{ borderRadius: 5 }} alt="Meridian" />
            <span className="sidebar-title">Meridian</span>
          </div>
          <div className="sidebar-body">
            <button
              className={`sni${primaryView === 'agenda' && !topOverlay ? ' active' : ''}`}
              onClick={() => navTo('agenda')}
            >
              <AlignLeft />Agenda
            </button>
            <button
              className={`sni${primaryView === 'calendar' && !topOverlay ? ' active' : ''}`}
              onClick={() => navTo('calendar')}
            >
              <CalendarDays />Month
            </button>
            <button
              className={`sni${primaryView === 'day' && !topOverlay ? ' active' : ''}`}
              onClick={() => navTo('day')}
            >
              <CalendarClock />Day
            </button>
          </div>
        </div>

        {/* ── FILTER OVERLAY ── sits above views, below topbar and search bar */}
        {showBottomFloat && (
          <FilterOverlay
            query={filterQuery}
            onOpen={(occ: Occurrence) => {
              openEntry(occ, 'single')
            }}
            onCreate={(title: string) => {
              openEntry(null, undefined, title)
              setFilterQuery('')
            }}
          />
        )}

        {/* ── BOTTOM SEARCH BAR ── */}
        {showBottomFloat && (
          <div className="bottom-float" id="bottomFloat">
            <div className="search-bar-wrap">
              <Search size={15} className="search-bar-icon" />
              <input
                id="filterInput"
                className="search-bar-input"
                placeholder="Search or create…"
                value={filterQuery}
                onChange={e => setFilterQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && filterQuery) {
                    openEntry(null, undefined, filterQuery)
                    setFilterQuery('')
                  }
                }}
              />
              {filterQuery && (
                <button className="search-bar-clear" onClick={() => setFilterQuery('')}>
                  <X size={13} />
                </button>
              )}
              <button
                className="search-bar-add"
                onClick={() => {
                  openEntry(null, undefined, filterQuery || undefined)
                  if (filterQuery) setFilterQuery('')
                }}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        )}

      </div>{/* end #app */}

      {/* ── DIALOGS ── */}

      {/* DATE */}
      <div className={dlgOvClass('dlgSched')} id="dlgSched" onClick={closeDlgOv}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Date</div><div className="dlg-body">
          <div className="dlg-row"><span className="dlg-lbl"><Calendar />Date</span><input className="dlg-in" type="date" id="dlgDate" value={dlgDateVal} onChange={e => setDlgDateVal(e.target.value)} /></div>
          <div className="dlg-actions">
            <button className="dlg-rm" onClick={removeSched}><X />Remove</button>
            <div style={{ display: 'flex', gap: 8 }}><button className="dlg-cancel" onClick={closeDialog}>Cancel</button><button className="dlg-ok" onClick={confirmSched}>Set</button></div>
          </div>
        </div></div>
      </div>

      {/* PRIORITY */}
      <div className={dlgOvClass('dlgPriority')} id="dlgPriority" onClick={closeDlgOv}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Priority</div><div className="dlg-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="dlg-ok" style={{ background: 'rgba(248,113,113,.15)', color: 'var(--p1)', border: '1px solid var(--p1)' }} onClick={() => setPriority('high')}><Flag /> High</button>
            <button className="dlg-ok" style={{ background: 'rgba(251,146,60,.15)', color: 'var(--p2)', border: '1px solid var(--p2)' }} onClick={() => setPriority('medium')}><Flag /> Medium</button>
            <button className="dlg-ok" style={{ background: 'rgba(250,204,21,.15)', color: 'var(--p3)', border: '1px solid var(--p3)' }} onClick={() => setPriority('low')}><Flag /> Low</button>
            <button className="dlg-rm" onClick={() => setPriority(null)}><X /> None</button>
          </div>
        </div></div>
      </div>

      {/* TIME */}
      <div className={dlgOvClass('dlgTime')} id="dlgTime" onClick={closeDlgOv}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Time</div><div className="dlg-body">
          <div className="dlg-row"><span className="dlg-lbl"><Clock />Time</span><input className="dlg-in" type="time" id="dlgTimeVal" value={dlgTimeVal} onChange={e => setDlgTimeVal(e.target.value)} /></div>
          <div className="dlg-actions">
            <button className="dlg-rm" onClick={removeTime}><X />Remove</button>
            <div style={{ display: 'flex', gap: 8 }}><button className="dlg-cancel" onClick={closeDialog}>Cancel</button><button className="dlg-ok" onClick={confirmTime}>Set</button></div>
          </div>
        </div></div>
      </div>

      {/* DURATION */}
      <div className={dlgOvClass('dlgDur')} id="dlgDur" onClick={closeDlgOv}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Duration</div><div className="dlg-body">
          <div className="dlg-row"><span className="dlg-lbl"><Timer />Duration</span><input className="dlg-in" type="text" id="dlgDurVal" value={dlgDurVal} onChange={e => setDlgDurVal(e.target.value)} placeholder="e.g. 1h 30m" style={{ width: 120 }} /></div>
          <div className="dlg-actions">
            <button className="dlg-rm" onClick={removeDur}><X />Remove</button>
            <div style={{ display: 'flex', gap: 8 }}><button className="dlg-cancel" onClick={closeDialog}>Cancel</button><button className="dlg-ok" onClick={confirmDur}>Set</button></div>
          </div>
        </div></div>
      </div>

      {/* REPEAT */}
      <div className={dlgOvClass('dlgRepeat')} id="dlgRepeat" onClick={closeDlgOv}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Repeat</div><div className="dlg-body">
          <div className="dlg-hint" id="repeatHint"><Info /><span id="repeatHintText"></span></div>
          <div className="recur-grid" id="recurGrid"></div>
          <div id="recurConfig"></div>
          <div className="end-sec" id="endSec" style={{ display: 'none' }}></div>
          <div className="dlg-actions">
            <button className="dlg-rm" onClick={removeRepeat}><X />Remove</button>
            <div style={{ display: 'flex', gap: 8 }}><button className="dlg-cancel" onClick={closeDialog}>Cancel</button><button className="dlg-ok" onClick={confirmRepeat}>Set</button></div>
          </div>
        </div></div>
      </div>

      {/* SERIES DELETE SHEET */}
      <div className={dlgOvClass('seriesSheet')} id="seriesSheet" onClick={closeDlgOv}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title" id="seriesSheetTitle">Delete event</div><div className="dlg-body">
          <button className="sheet-opt" id="seriesOpt1"><i data-lucide="calendar"></i><div><div className="sopt-t">This occurrence</div><div className="sopt-s">Remove only this occurrence</div></div></button>
          <button className="sheet-opt" id="seriesOpt2"><i data-lucide="calendar-range"></i><div><div className="sopt-t">All occurrences</div><div className="sopt-s">Remove all occurrences</div></div></button>
          <button className="sheet-opt" id="seriesOpt3" style={{ display: 'none' }}><i data-lucide="calendar-range"></i><div><div className="sopt-t">All occurrences</div><div className="sopt-s">Remove all occurrences</div></div></button>
          <button className="sheet-opt" onClick={closeDialog} style={{ color: 'var(--t3)' }}><i data-lucide="x"></i><div><div className="sopt-t">Cancel</div></div></button>
        </div></div>
      </div>

      <div className="wl-popup" id="wlPopup"></div>
    </>
  )
}
