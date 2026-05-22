import { useState, useEffect, useCallback } from 'react'
import {
  initApp, wikilinkInputHandler, wikilinkKeydownHandler, wikilinkClickHandler,
  applyScope, buildBodyHtml,
  saveNode, deleteNode, closeEntry, pushView,
  openDlg, closeDlg, closeDlgOv,
  openRepeatDlg, buildRepeatValue,
  closeSeriesSheet,
} from './meridian'
import EntryEditor, { EntryState, ENTRY_DEFAULT } from './components/EntryEditor'

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
  return {
    item: { ...item, _editScope: editScope },
    title: item.title || root.title || '',
    bodyHtml: buildBodyHtml(item.body || root.body || ''),
    scheduled,
    repeat,
    duration: item.duration || root.duration || '',
    tracked: item.done !== undefined || root.done !== undefined,
    done: item.done || false,
    tags: [...(item.tags || root.tags || [])],
    priority: item.priority || root.priority || null,
    editScope,
  }
}

export default function App() {
  const [entry, setEntry] = useState<EntryState>(ENTRY_DEFAULT)

  useEffect(() => {
    // ONE global: lets vanilla JS agenda/search rows open the editor
    ;(window as any).openEntry = (item: any, scope?: string) => {
      const editScope = scope ?? (item?.recur ? 'single' : 'all')
      setEntry(entryFromItem(item, editScope))
      pushView('entry')
    }
    document.addEventListener('input', wikilinkInputHandler as EventListener)
    document.addEventListener('keydown', wikilinkKeydownHandler as EventListener)
    document.addEventListener('click', wikilinkClickHandler as EventListener)
    initApp()
    return () => {
      document.removeEventListener('input', wikilinkInputHandler as EventListener)
      document.removeEventListener('keydown', wikilinkKeydownHandler as EventListener)
      document.removeEventListener('click', wikilinkClickHandler as EventListener)
    }
  }, [])

  const handleSave = useCallback((body: string) => {
    saveNode(entry.item, entry.editScope, { ...entry, body })
  }, [entry])

  const handleDelete = useCallback(() => {
    deleteNode(entry.item)
  }, [entry.item])

  const handleClose = useCallback(() => {
    closeEntry()
  }, [])

  const handleOpenDlg = useCallback((id: string) => {
    openDlg(id, entry.scheduled, entry.duration)
  }, [entry.scheduled, entry.duration])

  const handleOpenRepeatDlg = useCallback(() => {
    openRepeatDlg({ scheduled: entry.scheduled, tracked: entry.tracked, repeat: entry.repeat })
  }, [entry.scheduled, entry.tracked, entry.repeat])

  // Dialog confirm handlers — update entry state directly, no globals needed
  const confirmSched = useCallback(() => {
    const d = (document.getElementById('dlgDate') as HTMLInputElement).value
    if (!d) return
    setEntry(prev => ({ ...prev, scheduled: { date: d, time: prev.scheduled?.time || '' } }))
    closeDlg('dlgSched')
  }, [])

  const removeSched = useCallback(() => {
    setEntry(prev => ({ ...prev, scheduled: null, duration: '' }))
    closeDlg('dlgSched')
  }, [])

  const confirmTime = useCallback(() => {
    const t = (document.getElementById('dlgTimeVal') as HTMLInputElement).value
    setEntry(prev => prev.scheduled ? { ...prev, scheduled: { ...prev.scheduled, time: t } } : prev)
    closeDlg('dlgTime')
  }, [])

  const removeTime = useCallback(() => {
    setEntry(prev => prev.scheduled ? { ...prev, scheduled: { ...prev.scheduled, time: '' } } : prev)
    closeDlg('dlgTime')
  }, [])

  const confirmDur = useCallback(() => {
    const d = (document.getElementById('dlgDurVal') as HTMLInputElement).value.trim()
    setEntry(prev => ({ ...prev, duration: d }))
    closeDlg('dlgDur')
  }, [])

  const removeDur = useCallback(() => {
    setEntry(prev => ({ ...prev, duration: '' }))
    closeDlg('dlgDur')
  }, [])

  const confirmRepeat = useCallback(() => {
    const repeat = buildRepeatValue()
    setEntry(prev => ({ ...prev, repeat }))
    closeDlg('dlgRepeat')
  }, [])

  const removeRepeat = useCallback(() => {
    setEntry(prev => ({ ...prev, repeat: null }))
    closeDlg('dlgRepeat')
  }, [])

  const setPriority = useCallback((p: string | null) => {
    setEntry(prev => ({ ...prev, priority: p }))
    closeDlg('dlgPriority')
  }, [])

  return (
    <>
      <div id="app">

        <header className="topbar" id="mainTop">
          <div className="tb-l" id="tbDefault">
            <button className="ib" onClick={() => (window as any).openSidebar()} title="Menu"><i data-lucide="menu"></i></button>
            <img src={`${import.meta.env.BASE_URL}icon-192.png`} width="26" height="26" style={{borderRadius:5}} alt="Meridian" />
            <span className="vault-name">Meridian</span>
          </div>
          <div className="tb-l" id="tbDay" style={{display:'none',flex:1,gap:4,overflow:'hidden'}}>
            <button className="ib" onClick={() => (window as any).closeDayView()}><i data-lucide="arrow-left"></i></button>
            <span id="dvTitle" style={{flex:1,fontFamily:'var(--disp)',fontStyle:'italic',fontSize:15,color:'var(--t0)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}></span>
            <button className="ib" onClick={() => (window as any).dvNav(-1)}><i data-lucide="chevron-left"></i></button>
            <button className="ib" onClick={() => (window as any).dvNav(1)}><i data-lucide="chevron-right"></i></button>
          </div>
          <div className="tb-r">
            <button className="ib" id="syncBtn" onClick={() => (window as any).syncToDirectory()} title="Sync"><i data-lucide="folder-sync"></i></button>
            <button className="ib" onClick={() => (window as any).pickDirectory()} title="Open vault"><i data-lucide="folder-open"></i></button>
            <button className="ib" onClick={() => (window as any).goToday()} title="Today"><i data-lucide="calendar-check-2"></i></button>
            <button className="ib" onClick={() => (window as any).openSearch()} title="Search"><i data-lucide="search"></i></button>
          </div>
        </header>

        {/* AGENDA */}
        <section className="view active" id="view-agenda">
          <div className="ag-sc" id="agSc"><div className="ag-pad" id="agContent"></div></div>
        </section>

        {/* MONTH */}
        <section className="view" id="view-calendar">
          <div className="cal-wrap">
            <div className="cal-hdr">
              <div className="cal-mt" id="mTitle"></div>
              <div className="mnav">
                <button className="mnb" onClick={() => (window as any).chMonth(-1)}><i data-lucide="chevron-left"></i></button>
                <button className="mnb" onClick={() => (window as any).chMonth(1)}><i data-lucide="chevron-right"></i></button>
              </div>
            </div>
            <div className="dow-row" id="dowRow"></div>
            <div className="cal-grid-wrap"><div className="cal-grid" id="calGrid"></div></div>
          </div>
        </section>

        {/* DAY */}
        <section className="view" id="view-day">
          <div className="dv-allday" id="dvAllDay" style={{display:'none'}}></div>
          <div className="dv-sc" id="dvSc"><div className="dv-tl" id="dvTl"></div></div>
        </section>

        {/* SEARCH */}
        <section className="view" id="view-search">
          <div className="entry-top">
            <button className="ib" onClick={() => (window as any).closeSearch()}><i data-lucide="arrow-left"></i></button>
            <span className="entry-fname">Search</span>
          </div>
          <div className="ns-bar"><i data-lucide="search"></i><input id="nsIn" type="text" placeholder="Search notes, tasks, events…" onInput={() => (window as any).filterNS()} /></div>
          <div className="ns-filters">
            <button className="fchip on" onClick={(e) => (window as any).setNSF('all', e.currentTarget)}>All</button>
            <button className="fchip" onClick={(e) => (window as any).setNSF('event', e.currentTarget)}>Events</button>
            <button className="fchip" onClick={(e) => (window as any).setNSF('task', e.currentTarget)}>Tasks</button>
            <button className="fchip" onClick={(e) => (window as any).setNSF('note', e.currentTarget)}>Notes</button>
          </div>
          <div className="ns-sc"><div className="ns-pad" id="nsList"></div></div>
        </section>

        {/* ENTRY */}
        <section className="view" id="view-entry">
          <EntryEditor
            entry={entry}
            onChange={setEntry}
            onSave={handleSave}
            onDelete={handleDelete}
            onClose={handleClose}
            onOpenDlg={handleOpenDlg}
            onOpenRepeatDlg={handleOpenRepeatDlg}
          />
        </section>

        {/* SIDEBAR */}
        <div className="sidebar-ov" id="sidebarOv" onClick={() => (window as any).closeSidebar()}></div>
        <div className="sidebar" id="sidebar">
          <div className="sidebar-head">
            <img src={`${import.meta.env.BASE_URL}icon-192.png`} width="26" height="26" style={{borderRadius:5}} alt="Meridian" />
            <span className="sidebar-title">Meridian</span>
          </div>
          <div className="sidebar-body">
            <button className="sni active" id="sni-agenda" onClick={(e) => (window as any).sidebarNav('agenda', e.currentTarget)}><i data-lucide="align-left"></i>Agenda</button>
            <button className="sni" id="sni-calendar" onClick={(e) => (window as any).sidebarNav('calendar', e.currentTarget)}><i data-lucide="calendar-days"></i>Month</button>
            <button className="sni" id="sni-day" onClick={(e) => (window as any).sidebarNav('day', e.currentTarget)}><i data-lucide="calendar-clock"></i>Day</button>
          </div>
        </div>

        {/* FAB */}
        <div className="bottom-float" id="bottomFloat">
          <button className="fab" id="fab" onClick={() => (window as any).openEntry(null)} style={{marginLeft:'auto',pointerEvents:'all'}}><i data-lucide="plus"></i></button>
        </div>

      </div>{/* end #app */}

      {/* DATE DLG */}
      <div className="dlg-ov" id="dlgSched" onClick={(e) => closeDlgOv('dlgSched', e.nativeEvent)}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Date</div><div className="dlg-body">
          <div className="dlg-row"><span className="dlg-lbl"><i data-lucide="calendar"></i>Date</span><input className="dlg-in" type="date" id="dlgDate" /></div>
          <div className="dlg-actions">
            <button className="dlg-rm" onClick={removeSched}><i data-lucide="x"></i>Remove</button>
            <div style={{display:'flex',gap:8}}><button className="dlg-cancel" onClick={() => closeDlg('dlgSched')}>Cancel</button><button className="dlg-ok" onClick={confirmSched}>Set</button></div>
          </div>
        </div></div>
      </div>

      {/* PRIORITY DLG */}
      <div className="dlg-ov" id="dlgPriority" onClick={(e) => closeDlgOv('dlgPriority', e.nativeEvent)}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Priority</div><div className="dlg-body">
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <button className="dlg-ok" style={{background:'rgba(248,113,113,.15)',color:'var(--p1)',border:'1px solid var(--p1)'}} onClick={() => setPriority('high')}><i data-lucide="flag"></i> High</button>
            <button className="dlg-ok" style={{background:'rgba(251,146,60,.15)',color:'var(--p2)',border:'1px solid var(--p2)'}} onClick={() => setPriority('medium')}><i data-lucide="flag"></i> Medium</button>
            <button className="dlg-ok" style={{background:'rgba(250,204,21,.15)',color:'var(--p3)',border:'1px solid var(--p3)'}} onClick={() => setPriority('low')}><i data-lucide="flag"></i> Low</button>
            <button className="dlg-rm" onClick={() => setPriority(null)}><i data-lucide="x"></i> None</button>
          </div>
        </div></div>
      </div>

      {/* TIME DLG */}
      <div className="dlg-ov" id="dlgTime" onClick={(e) => closeDlgOv('dlgTime', e.nativeEvent)}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Time</div><div className="dlg-body">
          <div className="dlg-row"><span className="dlg-lbl"><i data-lucide="clock"></i>Time</span><input className="dlg-in" type="time" id="dlgTimeVal" /></div>
          <div className="dlg-actions">
            <button className="dlg-rm" onClick={removeTime}><i data-lucide="x"></i>Remove</button>
            <div style={{display:'flex',gap:8}}><button className="dlg-cancel" onClick={() => closeDlg('dlgTime')}>Cancel</button><button className="dlg-ok" onClick={confirmTime}>Set</button></div>
          </div>
        </div></div>
      </div>

      {/* DURATION DLG */}
      <div className="dlg-ov" id="dlgDur" onClick={(e) => closeDlgOv('dlgDur', e.nativeEvent)}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Duration</div><div className="dlg-body">
          <div className="dlg-row"><span className="dlg-lbl"><i data-lucide="timer"></i>Duration</span><input className="dlg-in" type="text" id="dlgDurVal" placeholder="e.g. 1h 30m" style={{width:120}} /></div>
          <div className="dlg-actions">
            <button className="dlg-rm" onClick={removeDur}><i data-lucide="x"></i>Remove</button>
            <div style={{display:'flex',gap:8}}><button className="dlg-cancel" onClick={() => closeDlg('dlgDur')}>Cancel</button><button className="dlg-ok" onClick={confirmDur}>Set</button></div>
          </div>
        </div></div>
      </div>

      {/* REPEAT DLG */}
      <div className="dlg-ov" id="dlgRepeat" onClick={(e) => closeDlgOv('dlgRepeat', e.nativeEvent)}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Repeat</div><div className="dlg-body">
          <div className="dlg-hint" id="repeatHint"><i data-lucide="info"></i><span id="repeatHintText"></span></div>
          <div className="recur-grid" id="recurGrid"></div>
          <div id="recurConfig"></div>
          <div className="end-sec" id="endSec" style={{display:'none'}}></div>
          <div className="dlg-actions">
            <button className="dlg-rm" onClick={removeRepeat}><i data-lucide="x"></i>Remove</button>
            <div style={{display:'flex',gap:8}}><button className="dlg-cancel" onClick={() => closeDlg('dlgRepeat')}>Cancel</button><button className="dlg-ok" onClick={confirmRepeat}>Set</button></div>
          </div>
        </div></div>
      </div>

      {/* SERIES DELETE SHEET */}
      <div className="dlg-ov" id="seriesSheet" onClick={(e) => { if (e.target === e.currentTarget) closeSeriesSheet() }}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title" id="seriesSheetTitle">Delete event</div><div className="dlg-body">
          <button className="sheet-opt" id="seriesOpt1"><i data-lucide="calendar"></i><div><div className="sopt-t">This occurrence</div><div className="sopt-s">Remove only this instance</div></div></button>
          <button className="sheet-opt" id="seriesOpt2"><i data-lucide="calendar-range"></i><div><div className="sopt-t">All events in series</div><div className="sopt-s">Remove every occurrence</div></div></button>
          <button className="sheet-opt" onClick={closeSeriesSheet} style={{color:'var(--t3)'}}><i data-lucide="x"></i><div><div className="sopt-t">Cancel</div></div></button>
        </div></div>
      </div>

      <div className="wl-popup" id="wlPopup"></div>
    </>
  )
}
