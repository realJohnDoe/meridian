import { useState, useEffect } from 'react'
import {
  Menu, FolderSync, FolderOpen, CalendarCheck2,
  ChevronLeft, ChevronRight,
  AlignLeft, CalendarDays, CalendarClock,
  Plus, X, Search,
} from 'lucide-react'
import { initApp, syncToDirectory, pickDirectory, tryRestoreDirectory, reconnectDirectory } from './vault'
import { toggleOccDone } from './mutations'
import { addDays, fmtLong } from './presentation'
import { openDayViewForDate, goToday } from './navigation'
import { fmtISO } from './model/expansion'
import { TODAY } from './constants'
import { useStore } from './store'
import type { PrimaryView } from './store'
import EntryEditor from './components/EntryEditor'
import DialogStack from './components/DialogStack'
import UndoToast from './components/UndoToast'
import AgendaView from './components/AgendaView'
import MonthView from './components/MonthView'
import DayView from './components/DayView'
import FilterOverlay from './components/FilterOverlay'
import { useEntryEditor } from './hooks/useEntryEditor'
import type { Occurrence, EditScope } from './types'
import { cn } from './lib/utils'
import { Button } from './components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from './components/ui/sheet'

export default function App() {
  const [filterQuery, setFilterQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const primaryView  = useStore(s => s.primaryView)
  const setPrimary   = useStore(s => s.setPrimaryView)
  const overlayStack = useStore(s => s.overlayStack)
  const topOverlay   = overlayStack[overlayStack.length - 1]

  const dvDate    = useStore(s => s.dvDate)
  const setDvDate = useStore(s => s.setDvDate)

  const syncDirtyCount      = useStore(s => s.syncDirtyCount)
  const syncFlash           = useStore(s => s.syncFlash)
  const dirHandle           = useStore(s => s.dirHandle)
  const pendingDirReconnect = useStore(s => s.pendingDirReconnect)
  const errorNotification   = useStore(s => s.errorNotification)
  const setErrorNotification = useStore(s => s.setErrorNotification)

  const syncColor = syncFlash
    ? 'var(--grn)'
    : !dirHandle ? 'var(--t3)' : syncDirtyCount > 0 ? 'var(--amb)' : 'var(--t2)'
  const syncTitle = !dirHandle
    ? 'Click folder icon to open vault'
    : syncDirtyCount > 0
      ? `${syncDirtyCount} unsaved change${syncDirtyCount > 1 ? 's' : ''} — click to sync`
      : 'All synced'

  const viewCls = (name: string) => {
    const active = topOverlay ? name === topOverlay : name === primaryView
    return active ? 'view active' : 'view'
  }

  const showTopbar      = topOverlay === undefined
  const showDayHeader   = showTopbar && primaryView === 'day'
  const showBottomFloat = topOverlay === undefined

  useEffect(() => {
    initApp()
    tryRestoreDirectory()
    setTimeout(() => {
      const sec = document.querySelector(`.day-section[data-key="${fmtISO(TODAY)}"]`)
      if (sec) sec.scrollIntoView({ behavior: 'instant', block: 'start' })
    }, 200)
  }, [])

  const {
    entry, setEntry,
    activeDialog,
    pendingDelete, setPendingDelete,
    seriesSheetConfig, setSeriesSheetConfig,
    storeItems, storeRoots,
    openEntry,
    handleOpenWikilink,
    handleSave, handleDelete, handleClose, handleScopeChange,
    handleOpenDlg, handleOpenRepeatDlg, closeDialog,
    handleDateConfirm, handleDateRemove,
    handleTimeConfirm, handleTimeRemove,
    handleDurConfirm, handleDurRemove,
    handleRepeatConfirm, handleRepeatRemove,
    handlePriority,
  } = useEntryEditor()

  const navTo = (v: PrimaryView) => {
    setSidebarOpen(false)
    setPrimary(v)
  }

  return (
    <>
      <div id="app">

        {showTopbar && (
          <header className="topbar" id="mainTop">
            {showDayHeader ? (
              <div className="tb-l tb-l--day">
                <button className="ib" onClick={() => setSidebarOpen(true)} title="Menu"><Menu /></button>
                <span className="dv-date-title">{fmtLong(dvDate)}</span>
                <button className="ib" onClick={() => setDvDate(addDays(dvDate, -1))}><ChevronLeft /></button>
                <button className="ib" onClick={() => setDvDate(addDays(dvDate, 1))}><ChevronRight /></button>
              </div>
            ) : (
              <div className="tb-l" id="tbDefault">
                <button className="ib" onClick={() => setSidebarOpen(true)} title="Menu"><Menu /></button>
                <img src={`${import.meta.env.BASE_URL}icon-192.png`} width="26" height="26" style={{ borderRadius: 5 }} alt="Meridian" />
                <span className="vault-name">Meridian</span>
              </div>
            )}
            <div className="tb-r">
              <button className="ib" onClick={syncToDirectory} title={syncTitle} style={{ color: syncColor }}><FolderSync /></button>
              <button
                className={cn('ib', pendingDirReconnect && !dirHandle && 'text-[var(--amb)]')}
                onClick={pendingDirReconnect && !dirHandle ? reconnectDirectory : pickDirectory}
                title={pendingDirReconnect && !dirHandle ? `Reconnect vault "${pendingDirReconnect}"` : 'Open vault'}
              ><FolderOpen /></button>
              <button className="ib" onClick={goToday} title="Today"><CalendarCheck2 /></button>
            </div>
          </header>
        )}

        <section className={viewCls('agenda')} id="view-agenda">
          <div className="ag-sc" id="agSc">
            <AgendaView onOpen={(occ: Occurrence, scope?: EditScope) => openEntry(occ, scope ?? 'single')} />
          </div>
        </section>

        <section className={viewCls('calendar')} id="view-calendar">
          <MonthView onDayClick={openDayViewForDate} />
        </section>

        <section className={viewCls('day')} id="view-day">
          <DayView onOpen={(occ: Occurrence, scope?: EditScope) => openEntry(occ, scope ?? 'single')} />
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
            items={storeItems}
            roots={storeRoots}
            onOpenWikilink={handleOpenWikilink}
            onToggleDoneBacklink={toggleOccDone}
          />
        </section>

        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent
            side="left"
            className="w-[260px] sm:max-w-[260px] p-0 flex flex-col bg-[var(--bg2)] border-r border-[var(--bdr2)]"
          >
            {/* Visually-hidden title for screen readers */}
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>

            {/* Sidebar header */}
            <div className="flex items-center gap-[10px] h-[var(--th)] px-4 border-b border-[var(--bdr)] shrink-0">
              <img
                src={`${import.meta.env.BASE_URL}icon-192.png`}
                width="26" height="26"
                style={{ borderRadius: 5 }}
                alt="Meridian"
              />
              <span className="font-[family-name:var(--disp)] italic text-[16px] text-[var(--t1)]">Meridian</span>
            </div>

            {/* Nav items */}
            <nav className="flex-1 overflow-y-auto py-2">
              {(
                [
                  ['agenda',   AlignLeft,    'Agenda'] as const,
                  ['calendar', CalendarDays, 'Month']  as const,
                  ['day',      CalendarClock,'Day']    as const,
                ] as const
              ).map(([view, Icon, label]) => {
                const isActive = primaryView === view && !topOverlay
                return (
                  <Button
                    key={view}
                    variant="ghost"
                    onClick={() => navTo(view)}
                    className={cn(
                      'w-full justify-start gap-[14px] px-5 h-auto py-[13px] text-[14px] font-medium rounded-none',
                      'text-[var(--t2)] hover:bg-[var(--bg3)] hover:text-[var(--t1)]',
                      isActive && 'text-[var(--ind)] bg-[var(--ab)] hover:text-[var(--ind)] hover:bg-[var(--ab)]',
                    )}
                  >
                    <Icon className="size-[19px] stroke-[1.7] shrink-0" />
                    {label}
                  </Button>
                )
              })}
            </nav>
          </SheetContent>
        </Sheet>

        {showBottomFloat && (
          <FilterOverlay
            query={filterQuery}
            onOpen={(occ: Occurrence) => openEntry(occ, 'single')}
            onCreate={(title: string) => {
              openEntry(null, undefined, title)
              setFilterQuery('')
            }}
          />
        )}

        {showBottomFloat && (
          <div className="bottom-float">
            <UndoToast />
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
              ><Plus size={16} /></button>
            </div>
          </div>
        )}

      </div>

      <DialogStack
        entry={entry}
        activeDialog={activeDialog}
        pendingDelete={pendingDelete}
        seriesSheetConfig={seriesSheetConfig}
        onClose={closeDialog}
        onDateConfirm={handleDateConfirm}
        onDateRemove={handleDateRemove}
        onPriority={handlePriority}
        onTimeConfirm={handleTimeConfirm}
        onTimeRemove={handleTimeRemove}
        onDurConfirm={handleDurConfirm}
        onDurRemove={handleDurRemove}
        onRepeatConfirm={handleRepeatConfirm}
        onRepeatRemove={handleRepeatRemove}
        onSeriesClose={() => setSeriesSheetConfig(null)}
        onDeleteClose={() => setPendingDelete(null)}
      />

      {errorNotification && (
        <div className="error-banner" role="alert">
          <span className="error-banner-msg">{errorNotification}</span>
          <button className="error-banner-close" onClick={() => setErrorNotification(null)}><X size={13} /></button>
        </div>
      )}
    </>
  )
}
