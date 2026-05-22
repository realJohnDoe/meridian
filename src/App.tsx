import { useEffect } from 'react'
import { initApp, wikilinkInputHandler, wikilinkKeydownHandler, wikilinkClickHandler } from './meridian'

export default function App() {
  useEffect(() => {
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

  return (
    <>
      <div id="app">

        <header className="topbar" id="mainTop">
          <div className="tb-l" id="tbDefault">
            <button className="ib" onClick={() => (window as any).openSidebar()} title="Menu"><i data-lucide="menu"></i></button>
            <svg width="26" height="26" viewBox="0 0 28 28">
              <defs><linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#818cf8"/><stop offset="100%" stopColor="#38bdf8"/></linearGradient></defs>
              <circle cx="14" cy="14" r="11" fill="none" stroke="url(#lg)" strokeWidth="2" strokeDasharray="52 18"/>
              <text x="14" y="19" textAnchor="middle" fontFamily="Georgia,serif" fontSize="13" fill="#f5f0e8">M</text>
              <circle cx="14" cy="3.5" r="2" fill="#818cf8"/>
            </svg>
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
          <div className="entry-top">
            <button className="ib" onClick={() => (window as any).closeEntry()}><i data-lucide="arrow-left"></i></button>
            <span className="entry-fname" id="entryFname">untitled.md</span>
            <button className="ib" id="deleteBtn" onClick={() => (window as any).deleteEntry()} title="Delete" style={{color:'var(--ros)',display:'none'}}><i data-lucide="trash-2"></i></button>
            <button className="save-btn" onClick={() => (window as any).saveEntry()}>Save</button>
          </div>
          <div className="entry-sc"><div className="entry-pad">
            <div className="entry-title-row">
              <div className="echk" id="echk" onClick={() => (window as any).toggleDoneEntry()}><i data-lucide="check"></i></div>
              <textarea className="entry-title-in" id="entryTitle" placeholder="Title" rows={1} onInput={(e) => (window as any).autoResize(e.currentTarget)}></textarea>
            </div>
            <div className="scope-row" id="scopeRow" style={{display:'none'}}>
              <span className="scope-lbl">Edit</span>
              <select className="scope-select" id="scopeSelect" onChange={(e) => (window as any).setScope(e.currentTarget.value)}>
                <option value="single">This event</option>
                <option value="future">This and following events</option>
                <option value="all">All events</option>
              </select>
            </div>
            <div className="prop-chips" id="propChips">
              <button className="pchip" id="cSched" onClick={() => (window as any).openDlg('dlgSched')}><i data-lucide="calendar"></i>Date<span className="pchip-sum" id="sumSched"></span></button>
              <button className="pchip hidden" id="cTime" onClick={() => (window as any).openDlg('dlgTime')}><i data-lucide="clock"></i>Time<span className="pchip-sum" id="sumTime"></span></button>
              <button className="pchip hidden" id="cDur" onClick={() => (window as any).openDlg('dlgDur')}><i data-lucide="timer"></i>Duration<span className="pchip-sum" id="sumDur"></span></button>
              <button className="pchip" id="cTrack" onClick={() => (window as any).toggleTrack()}><i data-lucide="circle-check"></i>Track Completion</button>
              <button className="pchip hidden" id="cPriority" onClick={() => (window as any).openDlg('dlgPriority')}><i data-lucide="flag"></i>Priority<span className="pchip-sum" id="sumPriority"></span></button>
              <button className="pchip hidden" id="cRepeat" onClick={() => (window as any).openRepeatDlg()}><i data-lucide="repeat"></i>Repeat<span className="pchip-sum" id="sumRepeat"></span></button>
            </div>
            <div className="entry-tags" id="entryTags"><span className="etag etag-add" onClick={() => (window as any).addTag()}><i data-lucide="plus"></i> tag</span></div>
            <div className="entry-divider"></div>
            <div className="entry-body" id="entryBody" contentEditable="true" suppressContentEditableWarning spellCheck={false}></div>
          </div></div>
        </section>

        {/* SIDEBAR */}
        <div className="sidebar-ov" id="sidebarOv" onClick={() => (window as any).closeSidebar()}></div>
        <div className="sidebar" id="sidebar">
          <div className="sidebar-head">
            <svg width="26" height="26" viewBox="0 0 28 28">
              <defs><linearGradient id="lg2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#818cf8"/><stop offset="100%" stopColor="#38bdf8"/></linearGradient></defs>
              <circle cx="14" cy="14" r="11" fill="none" stroke="url(#lg2)" strokeWidth="2" strokeDasharray="52 18"/>
              <text x="14" y="19" textAnchor="middle" fontFamily="Georgia,serif" fontSize="13" fill="#f5f0e8">M</text>
              <circle cx="14" cy="3.5" r="2" fill="#818cf8"/>
            </svg>
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
      <div className="dlg-ov" id="dlgSched" onClick={(e) => (window as any).closeDlgOv('dlgSched', e.nativeEvent)}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Date</div><div className="dlg-body">
          <div className="dlg-row"><span className="dlg-lbl"><i data-lucide="calendar"></i>Date</span><input className="dlg-in" type="date" id="dlgDate" /></div>
          <div className="dlg-actions">
            <button className="dlg-rm" onClick={() => (window as any).removeSched()}><i data-lucide="x"></i>Remove</button>
            <div style={{display:'flex',gap:8}}><button className="dlg-cancel" onClick={() => (window as any).closeDlg('dlgSched')}>Cancel</button><button className="dlg-ok" onClick={() => (window as any).confirmSched()}>Set</button></div>
          </div>
        </div></div>
      </div>

      {/* PRIORITY DLG */}
      <div className="dlg-ov" id="dlgPriority" onClick={(e) => (window as any).closeDlgOv('dlgPriority', e.nativeEvent)}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Priority</div><div className="dlg-body">
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <button className="dlg-ok" style={{background:'rgba(248,113,113,.15)',color:'var(--p1)',border:'1px solid var(--p1)'}} onClick={() => (window as any).setPriority('high')}><i data-lucide="flag"></i> High</button>
            <button className="dlg-ok" style={{background:'rgba(251,146,60,.15)',color:'var(--p2)',border:'1px solid var(--p2)'}} onClick={() => (window as any).setPriority('medium')}><i data-lucide="flag"></i> Medium</button>
            <button className="dlg-ok" style={{background:'rgba(250,204,21,.15)',color:'var(--p3)',border:'1px solid var(--p3)'}} onClick={() => (window as any).setPriority('low')}><i data-lucide="flag"></i> Low</button>
            <button className="dlg-rm" onClick={() => (window as any).setPriority(null)}><i data-lucide="x"></i> None</button>
          </div>
        </div></div>
      </div>

      {/* TIME DLG */}
      <div className="dlg-ov" id="dlgTime" onClick={(e) => (window as any).closeDlgOv('dlgTime', e.nativeEvent)}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Time</div><div className="dlg-body">
          <div className="dlg-row"><span className="dlg-lbl"><i data-lucide="clock"></i>Time</span><input className="dlg-in" type="time" id="dlgTimeVal" /></div>
          <div className="dlg-actions">
            <button className="dlg-rm" onClick={() => (window as any).removeTime()}><i data-lucide="x"></i>Remove</button>
            <div style={{display:'flex',gap:8}}><button className="dlg-cancel" onClick={() => (window as any).closeDlg('dlgTime')}>Cancel</button><button className="dlg-ok" onClick={() => (window as any).confirmTime()}>Set</button></div>
          </div>
        </div></div>
      </div>

      {/* DURATION DLG */}
      <div className="dlg-ov" id="dlgDur" onClick={(e) => (window as any).closeDlgOv('dlgDur', e.nativeEvent)}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Duration</div><div className="dlg-body">
          <div className="dlg-row"><span className="dlg-lbl"><i data-lucide="timer"></i>Duration</span><input className="dlg-in" type="text" id="dlgDurVal" placeholder="e.g. 1h 30m" style={{width:120}} /></div>
          <div className="dlg-actions">
            <button className="dlg-rm" onClick={() => (window as any).removeDur()}><i data-lucide="x"></i>Remove</button>
            <div style={{display:'flex',gap:8}}><button className="dlg-cancel" onClick={() => (window as any).closeDlg('dlgDur')}>Cancel</button><button className="dlg-ok" onClick={() => (window as any).confirmDur()}>Set</button></div>
          </div>
        </div></div>
      </div>

      {/* REPEAT DLG */}
      <div className="dlg-ov" id="dlgRepeat" onClick={(e) => (window as any).closeDlgOv('dlgRepeat', e.nativeEvent)}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title">Repeat</div><div className="dlg-body">
          <div className="dlg-hint" id="repeatHint"><i data-lucide="info"></i><span id="repeatHintText"></span></div>
          <div className="recur-grid" id="recurGrid"></div>
          <div id="recurConfig"></div>
          <div className="end-sec" id="endSec" style={{display:'none'}}></div>
          <div className="dlg-actions">
            <button className="dlg-rm" onClick={() => (window as any).removeRepeat()}><i data-lucide="x"></i>Remove</button>
            <div style={{display:'flex',gap:8}}><button className="dlg-cancel" onClick={() => (window as any).closeDlg('dlgRepeat')}>Cancel</button><button className="dlg-ok" onClick={() => (window as any).confirmRepeat()}>Set</button></div>
          </div>
        </div></div>
      </div>

      {/* SERIES DELETE SHEET */}
      <div className="dlg-ov" id="seriesSheet" onClick={(e) => { if (e.target === e.currentTarget) (window as any).closeSeriesSheet() }}>
        <div className="dlg"><div className="dlg-handle"></div><div className="dlg-title" id="seriesSheetTitle">Delete event</div><div className="dlg-body">
          <button className="sheet-opt" id="seriesOpt1"><i data-lucide="calendar"></i><div><div className="sopt-t">This occurrence</div><div className="sopt-s">Remove only this instance</div></div></button>
          <button className="sheet-opt" id="seriesOpt2"><i data-lucide="calendar-range"></i><div><div className="sopt-t">All events in series</div><div className="sopt-s">Remove every occurrence</div></div></button>
          <button className="sheet-opt" onClick={() => (window as any).closeSeriesSheet()} style={{color:'var(--t3)'}}><i data-lucide="x"></i><div><div className="sopt-t">Cancel</div></div></button>
        </div></div>
      </div>

      <div className="wl-popup" id="wlPopup"></div>
    </>
  )
}
