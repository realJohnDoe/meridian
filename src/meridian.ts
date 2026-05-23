// @ts-nocheck
import Dexie from 'dexie'
import { createIcons, CalendarRange, Trash2, Check, Repeat2, FileText, CheckSquare, Calendar, Plus } from 'lucide'
import { fmtISO, fmtT, nodeDateTime, jsDateToSpec, parseDateString, toDate, addInterval, mergeNode, expandNode, expandRange as _expandRange, parseDurationHours } from './recurrence'
import { yamlParse, yamlParseScalar, yamlSerializeScalar, nodeToFile, fileToNode, titleToSlug } from './yaml'
// Type-only imports — used in exported function signatures so consumers get full type safety.
// @ts-nocheck suppresses the internal DOM-manipulation errors; a follow-up PR will address those.
import type { Node, Occurrence, Repeat, Scheduled } from './types'
import { useStore } from './store'

// ── STORE ACCESSORS ────────────────────────────────────────────
// Thin wrappers that give vanilla-JS functions synchronous access to
// the Zustand store. Once views are converted to React components
// they will read the store directly via useStore().
const getNodes    = (): Node[]  => useStore.getState().nodes
const setNodes    = (n: Node[]) => useStore.setState({ nodes: n })
const bumpId      = (): number  => useStore.getState().bumpId()
const getCurView  = (): string  => useStore.getState().curView
const getPrevView = (): string  => useStore.getState().prevView
const setCurView  = (v: string) => useStore.setState({ curView: v })
const setPrevView = (v: string) => useStore.setState({ prevView: v })
const getCalMonth = (): Date    => useStore.getState().calMonth
const setCalMonth = (d: Date)   => useStore.setState({ calMonth: d })
const getDvDate   = (): Date    => useStore.getState().dvDate
const setDvDate   = (d: Date)   => useStore.setState({ dvDate: d })
const getNsFilter = (): string  => useStore.getState().nsFilterVal
const setNsFilter = (f: string) => useStore.setState({ nsFilterVal: f })
const getDirHandle = ()         => useStore.getState().dirHandle
const setDirHandle = (h: any)   => useStore.setState({ dirHandle: h })

// ── CONSTANTS ─────────────────────────────────────────────────
const TODAY=new Date();TODAY.setHours(0,0,0,0);
const DAYS=['Mo','Tu','We','Th','Fr','Sa','Su'];
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const D=(y,m,d,h=0,mi=0)=>new Date(y,m-1,d,h,mi);

// ── SEED DATA (used by initApp when no vault is loaded) ───────
const SEED_NODES: Node[] = [
  {id:'standup', title:'Weekly Standup', tags:['work'],
   date:'2026-04-06', time:'09:00', duration:'30m',
   repeat:{type:'schedule', scheduled:{freq:'weekly', byweekday:['mo']}},
   body:'Quick sync. Agenda:\n- [[project-alpha]] status\n- Blockers\n- [[weekly-log]] updates',
   instances:[
     {date:'2026-04-13', done:true},
     {date:'2026-04-14', done:true},
   ]
  },
  {id:'exercise', title:'Exercise', tags:['health'],
   date:'2026-04-06', done:false,
   repeat:{type:'schedule', scheduled:{freq:'weekly', byweekday:['mo','we','fr']}},
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
   repeat:{type:'schedule', scheduled:{freq:'monthly', byweekday:['mo'], bysetpos:1}},
   body:'## Agenda\n\n- Review [[project-alpha]] milestones\n- Budget check\n- Team velocity\n- Next month planning',
   instances:[
     {date:'2026-04-07', done:true},
   ]
  },
  {id:'pay-rent', title:'Pay Rent', tags:['personal'],
   date:'2026-04-01', done:false,
   repeat:{type:'schedule', scheduled:{freq:'monthly', bymonthday:[1]}},
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

const NOTES_DATA=[
  {title:'Project Alpha',preview:'Core objectives for Q3. Launch by end of July.',date:'May 12',tags:['work'],type:'note'},
  {title:'Reading List',preview:'Books: SICP, TAOCP vol 1.',date:'May 10',tags:['personal'],type:'note'},
  {title:'Spec: Instance Recurrence',preview:'v0.8 — Draft. Human-readable YAML-native recurrence model.',date:'May 13',tags:['project'],type:'note'},
  {title:'Weekly Log',preview:'Week of May 11. Shipped the new parser.',date:'May 11',tags:['work'],type:'note'},
  {title:'Ideas',preview:'Offline-first sync, plugin system, graph view.',date:'May 9',tags:['ideas'],type:'note'},
];

// curView, prevView, calMonth, dvDate, nsFilterVal, nextId → useStore
let rdType=null,rdWdays=[false,false,false,false,false,false,false],rdMonthly='first-weekday',rdEndType='never',rdEndVal='',rdInterval='1 day';

// ── UTILS ──────────────────────────────────────────────────────
export const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
export const addDays=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r};
export const fmtLong=d=>d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
export const fmtShort=d=>d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
export const dayKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function autoResize(el){el.style.height='auto';el.style.height=el.scrollHeight+'px';}
function escapeHtml(s:string):string{return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function ic(){createIcons({icons:{CalendarRange,Trash2,Check,Repeat2,FileText,CheckSquare,Calendar,Plus}});}

// ── FUZZY FILTER ─────────────────────────────────────────────────
function fuzzyMatch(query:string,text:string):boolean{
  if(!query)return true;
  const q=query.toLowerCase(),t=text.toLowerCase();
  let qi=0;
  for(let i=0;i<t.length&&qi<q.length;i++){if(t[i]===q[qi])qi++;}
  return qi===q.length;
}
function fuzzyScore(query:string,text:string):number{
  const q=query.toLowerCase(),t=text.toLowerCase();
  let score=0,qi=0,cons=0;
  for(let i=0;i<t.length&&qi<q.length;i++){
    if(t[i]===q[qi]){qi++;cons++;score+=cons;}
    else{cons=0;}
  }
  if(t.startsWith(q))score+=100;
  return score;
}

let _globalFilter='';

// ── NAVIGATION ──────────────────────────────────────────────────
function openSidebar(){
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOv').classList.add('open');
  ic();
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOv').classList.remove('open');
}
function sidebarNav(name, btn){
  closeSidebar();
  if(name==='day'){openLastDay();return;}
  document.querySelectorAll('.sni').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  navTo(name, btn);
}
function setSidebarActive(name){
  document.querySelectorAll('.sni').forEach(b=>b.classList.remove('active'));
  const el=document.getElementById('sni-'+name);
  if(el)el.classList.add('active');
}
function navTo(name,btn){
  setSidebarActive(name);
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  showChrome();
  document.getElementById('tbDefault').style.display='';
  document.getElementById('tbDay').style.display='none';
  setCurView(name);
  applyGlobalFilter(_globalFilter);
}
export function pushView(name: string): void {
  setPrevView(getCurView());
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  // Hide filter overlay when leaving filterable views
  const overlay=document.getElementById('filterOverlay');
  if(name==='entry'||name==='search'){
    if(overlay)overlay.style.display='none';
  }
  if(name==='entry'){
    hideChrome();
  } else if(name==='day'){
    document.getElementById('tbDefault').style.display='none';
    document.getElementById('tbDay').style.display='flex';
    document.getElementById('mainTop').style.display='';
    document.getElementById('bottomFloat').style.display='none';
    setSidebarActive('calendar');
  } else {
    document.getElementById('mainTop').style.display='none';
    document.getElementById('bottomFloat').style.display='none';
  }
  setCurView(name);
  // Re-apply filter when pushing day view (e.g. from calendar cell click)
  if(name==='day'&&_globalFilter){
    setTimeout(()=>applyGlobalFilter(_globalFilter),0);
  }
}
function popView(){
  document.getElementById('tbDefault').style.display='';
  document.getElementById('tbDay').style.display='none';
  showChrome();
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+getPrevView()).classList.add('active');
  setSidebarActive(getPrevView());
  setCurView(getPrevView());
  applyGlobalFilter(_globalFilter);
}
function showChrome(){
  document.getElementById('mainTop').style.display='';
  document.getElementById('bottomFloat').style.display='';
}
function hideChrome(){
  document.getElementById('mainTop').style.display='none';
  document.getElementById('bottomFloat').style.display='none';
}

function goToday(){
  if(getCurView()==='day'){
    setDvDate(new Date(TODAY));buildDayView();
  } else if(getCurView()==='calendar'){
    setCalMonth(new Date(TODAY.getFullYear(),TODAY.getMonth(),1));
  } else {
    setSidebarActive('agenda');navTo('agenda',null);
    setTimeout(()=>{
      const sec=document.querySelector(`.day-section[data-key="${dayKey(TODAY)}"]`);
      if(sec)sec.scrollIntoView({behavior:'smooth',block:'start'});
    },60);
  }
}
function openSearch(){setPrevView(getCurView());pushView('search');buildNS();setTimeout(()=>{document.getElementById('nsIn').focus();ic();},100);}
function closeSearch(){popView();}
function openLastDay(){setDvDate(new Date(TODAY));buildDayView();pushView('day');}
function closeDayView(){popView();}
function dvNav(d){setDvDate(addDays(getDvDate(),d));buildDayView();if(_globalFilter)applyGlobalFilter(_globalFilter);}

// ── SHARED OCCURRENCE SORT ────────────────────────────────────
const _prioOrder={high:0,medium:1,low:2};
function _sortKey(o){
  const t=!!fmtT(o.time),ev=o.type==='event';
  return(o.done?8:0)+(t?0:2)+(ev?0:1);
}
function _prioKey(o){return o.priority?_prioOrder[o.priority]??3:3;}
export function sortOccs(arr){
  return arr.sort((a,b)=>{
    const sd=_sortKey(a)-_sortKey(b);if(sd)return sd;
    const pd=_prioKey(a)-_prioKey(b);if(pd)return pd;
    const td=(a.jsTime?.getHours()||0)*60+(a.jsTime?.getMinutes()||0)
            -(b.jsTime?.getHours()||0)*60-(b.jsTime?.getMinutes()||0);
    if(td)return td;
    return(a.title||'').localeCompare(b.title||'');
  });
}

// ── AGENDA ──────────────────────────────────────────────────────
// buildAgenda(), makeOccRow(), flipResortSection(), insertOccIntoAgenda(),
// findOccWrapInAgenda(), removeOccWrapFromAgenda() are deleted.
// AgendaView (src/components/AgendaView.tsx) subscribes to the Zustand store
// and re-renders automatically whenever nodes change.
// Filtering is handled via useStore's filterQuery field.

export function occState(o){
  if(o.done)return 'done';
  if(o.type==='task'||o.done!==undefined){
    const p=o.priority;
    if(p==='high')return 'task-p1';
    if(p==='medium')return 'task-p2';
    if(p==='low')return 'task-p3';
    return 'task-open';
  }
  if(o.multiday)return 'event-future';
  const now=new Date();
  if(o.jsTime<now)return 'event-past';
  return 'event-future';
}
export function barClass(o){return occState(o);}

// ── TOGGLE DONE (data-only, exported for React components) ────
export function toggleOccDone(o): void {
  const newDone=!o.done;
  o.done=newDone;
  const node=o._node;
  if(!node)return;
  if(!node.instances)node.instances=[];
  const jsT=o.jsTime;
  if(node.repeat){
    let inst=node.instances.find(i=>{
      const t=nodeDateTime(i)||parseDateString(i.date);
      return t&&Math.abs(t.getTime()-jsT.getTime())<60000;
    });
    if(inst){inst.done=newDone;}
    else{node.instances.push({date:o.date, done:newDone});}
  } else {
    node.done=newDone;
  }
  writeEntityToCache(node);
  setNodes([...getNodes()]);
}

// ── SWIPE DELETE (exported for React components) ──────────────
export function swipeDeleteOcc(o): void {
  const node=o._node||o;
  const nodeId=node.id;
  const title=node.title;

  if(o.recur){
    if(!node.instances)node.instances=[];
    const occDate=o.date;
    let inst=node.instances.find(i=>i.date===occDate&&!i.time);
    if(inst){inst.excluded=true;}
    else{node.instances.push({date:occDate,excluded:true});}
    setNodes([...getNodes()]);
    showDeleteToast(title,
      ()=>{ writeEntityToCache(node); },
      ()=>{
        if(inst){delete inst.excluded;}
        else{node.instances=node.instances.filter(i=>!(i.date===occDate&&i.excluded&&!i.time));}
        setNodes([...getNodes()]);
      }
    );
  } else {
    setNodes(getNodes().filter(n=>n.id!==nodeId));
    showDeleteToast(title,
      ()=>{ deleteNodeFromDisk(node); },
      ()=>{
        setNodes([...getNodes(), node].sort((a,b)=>(parseDateString(a.date)||0)-(parseDateString(b.date)||0)));
      }
    );
  }
}

export function ccBarClass(o){
  if(o.multiday)return 'multiday';
  const s=occState(o);
  if(s==='done'||s==='event-past')return 'done';
  if(s==='task-open')return 'task';
  if(s==='task-p1')return 'task-p1';
  if(s==='task-p2')return 'task-p2';
  if(s==='task-p3')return 'task-p3';
  return 'event';
}
function dvBlkClass(o){
  const s=occState(o);
  if(s==='done'||s==='event-past')return 'past';
  if(s==='task-open')return 'task';
  if(s==='task-p1')return 'task-p1';
  if(s==='task-p2')return 'task-p2';
  if(s==='task-p3')return 'task-p3';
  return 'event';
}

// makeOccRow, toggleOccDone (DOM), findOccWrapInAgenda, removeOccWrapFromAgenda,
// insertOccIntoAgenda, flipResortSection all deleted.
// AgendaView + OccurrenceRow handle rendering and animations in React.

// ── FILTER OVERLAY ──────────────────────────────────────────────
function buildFilteredAgenda(query:string){
  const overlay=document.getElementById('filterOverlay');
  if(!overlay)return;
  overlay.innerHTML='';
  if(!query){overlay.style.display='none';return;}
  overlay.style.display='';

  // "Create" row at top
  const createRow=document.createElement('div');
  createRow.className='occ-create-row';
  createRow.innerHTML=`<i data-lucide="plus"></i><span>Create "<strong>${escapeHtml(query)}</strong>"</span>`;
  createRow.onclick=()=>(window as any).openEntry(null,undefined,query);
  overlay.appendChild(createRow);

  const from=addDays(TODAY,-7),to=addDays(TODAY,90);
  const occs=_expandRange(NODES,from,to);
  const filtered=occs
    .filter(o=>fuzzyMatch(query,o.title))
    .map(o=>({occ:o,score:fuzzyScore(query,o.title)}))
    .sort((a,b)=>b.score-a.score||(a.occ.jsTime as any)-(b.occ.jsTime as any))
    .map(x=>x.occ);

  if(!filtered.length){
    const empty=document.createElement('div');
    empty.style.cssText='padding:40px 14px;text-align:center;color:var(--t3);font-size:13px';
    empty.textContent='No matches';
    overlay.appendChild(empty);
    ic();return;
  }
  filtered.forEach((o,i)=>overlay.appendChild(makeOccRow(o,i)));
  ic();
}

function applyGlobalFilter(q:string){
  _globalFilter=q;
  const overlay=document.getElementById('filterOverlay');
  const cv=getCurView();
  if(q){
    buildFilteredAgenda(q);
  } else {
    if(overlay)overlay.style.display='none';
    if(cv==='day')buildDayView();
    // agenda + calendar views are React components; they re-render from the store automatically
  }
}

// ── MONTH ──────────────────────────────────────────────────────
// buildMonth, makeCalCell, chMonth deleted.
// MonthView (src/components/MonthView.tsx) subscribes to calMonth + nodes
// and re-renders automatically — no manual DOM updates needed.

/** Open the day view for a specific date. Called from MonthView cell clicks. */
export function openDayViewForDate(date: Date): void {
  setDvDate(date);
  buildDayView();
  pushView('day');
}

// ── DAY VIEW ──────────────────────────────────────────────────
function buildDayView(){
  document.getElementById('dvTitle').textContent=fmtLong(getDvDate());
  const from=new Date(getDvDate());from.setHours(0,0,0,0);
  const to=new Date(getDvDate());to.setHours(23,59,59);
  const occs=_expandRange(getNodes(),from,to);
  const allday=occs.filter(o=>!fmtT(o.time)||o.multiday);
  const timed=occs.filter(o=>!!fmtT(o.time)&&!o.multiday);

  sortOccs(allday);
  sortOccs(timed);

  const ad=document.getElementById('dvAllDay');
  if(allday.length){
    ad.style.display='';
    const seen=new Set();
    ad.innerHTML=`<div class="dv-adlbl">All day</div>`;
    allday.forEach(o=>{
      if(o.multiday&&seen.has(o._nodeId))return;
      if(o.multiday)seen.add(o._nodeId);
      const hasTrack=o.done!==undefined;
      const it=document.createElement('div');
      it.className=`dv-aditem ${o.multiday?'multiday':dvBlkClass(o)}`;
      const chkHtml=hasTrack?`<div class="dv-chk${o.done?' done':''}"><i data-lucide="check"></i></div>`:'';
      it.innerHTML=chkHtml+`<span>${escapeHtml(o.title)}</span>`;
      it.onclick=()=>openEntry(o);
      ad.appendChild(it);
    });
  } else {ad.style.display='none';}

  const tl=document.getElementById('dvTl');tl.innerHTML='';
  const SH=7,EH=22,HP=56;
  for(let h=SH;h<=EH;h++){
    const row=document.createElement('div');row.className='dv-hr';
    row.innerHTML=`<span class="dv-hlbl">${h<12?h+'am':h===12?'12pm':(h-12)+'pm'}</span><div class="dv-hline"></div>`;
    tl.appendChild(row);
  }
  if(sameDay(getDvDate(),TODAY)){
    const now=new Date(),nh=now.getHours()+now.getMinutes()/60;
    if(nh>=SH&&nh<=EH){
      const nl=document.createElement('div');nl.className='now-line';nl.style.top=((nh-SH)*HP)+'px';nl.innerHTML='<div class="now-dot"></div>';tl.appendChild(nl);
    }
  }

  function computeColumns(events){
    const sorted=[...events].sort((a,b)=>a.jsTime-b.jsTime);
    const cols=[];
    for(const ev of sorted){
      const dh=parseDurationHours(ev.duration);
      const endMs=ev.jsTime.getTime()+dh*3600000;
      ev._dh=dh;ev._endMs=endMs;
      let placed=false;
      for(const col of cols){
        const last=col[col.length-1];
        if(ev.jsTime.getTime()>=last._endMs){col.push(ev);placed=true;break;}
      }
      if(!placed)cols.push([ev]);
    }
    return cols;
  }

  const cols=computeColumns(timed);
  const totalCols=Math.max(cols.length,1);
  const tlLeft=50;
  cols.forEach((col,ci)=>{
    col.forEach(o=>{
      const h=o.jsTime.getHours()+o.jsTime.getMinutes()/60;
      if(h<SH||h>EH)return;
      const blk=document.createElement('div');
      blk.className=`dv-eblk ${dvBlkClass(o)}`;
      blk.style.top=((h-SH)*HP+1)+'px';
      blk.style.height=Math.max(o._dh*HP-4,28)+'px';
      blk.dataset.col=ci;
      blk.dataset.totalCols=totalCols;
      const hasTrack=o.done!==undefined;
      const chkHtml=hasTrack?`<div class="dv-blk-chk${o.done?' done':''}"><i data-lucide="check"></i></div>`:'';
      blk.innerHTML=`<div class="dv-et">${chkHtml}${escapeHtml(o.title)}</div><div class="dv-em">${fmtT(o.time)}${o.duration?' · '+escapeHtml(o.duration):''}</div>`;
      blk.onclick=()=>openEntry(o);
      tl.appendChild(blk);
    });
  });
  requestAnimationFrame(()=>{
    const tlW=tl.getBoundingClientRect().width||380;
    const avail=tlW-tlLeft-6;
    tl.querySelectorAll('.dv-eblk').forEach(blk=>{
      const ci=parseInt(blk.dataset.col||0);
      const tc=parseInt(blk.dataset.totalCols||1);
      blk.style.left=(tlLeft+ci*Math.floor(avail/tc))+'px';
      blk.style.right='';
      blk.style.width=(Math.floor(avail/tc)-3)+'px';
    });
    ic();
  });
  setTimeout(()=>document.getElementById('dvSc').scrollTo({top:(8-SH)*HP,behavior:'instant'}),50);
  ic();
}

// ── SEARCH ──────────────────────────────────────────────────────
function buildNS(filter,q=''){
  if(filter!==undefined)setNsFilter(filter);
  const list=document.getElementById('nsList');list.innerHTML='';
  const q2=(q||document.getElementById('nsIn')?.value||'').toLowerCase();
  const occs=_expandRange(getNodes(),addDays(TODAY,-30),addDays(TODAY,90));
  const seen=new Set();
  const allItems=[
    ...NOTES_DATA,
    ...occs.filter(o=>{if(seen.has(o._nodeId||o.title))return false;seen.add(o._nodeId||o.title);return true;})
      .map(o=>({title:o.title,preview:o.body||'',date:fmtShort(o.jsTime),tags:o.tags||[],type:o.type,_node:o._node||o}))
  ];
  const filtered=allItems.filter(it=>{
    if(getNsFilter()!=='all'&&it.type!==getNsFilter())return false;
    if(q2&&!it.title.toLowerCase().includes(q2)&&!it.preview.toLowerCase().includes(q2)&&!it.tags.some(t=>t.includes(q2)))return false;
    return true;
  });
  if(!filtered.length){list.innerHTML=`<div style="padding:40px 14px;text-align:center;color:var(--t3);font-size:13px">No results</div>`;return;}
  const grps={event:[],task:[],note:[]};
  filtered.forEach(it=>{if(grps[it.type])grps[it.type].push(it);});
  const order=getNsFilter()==='all'?['event','task','note']:[getNsFilter()];
  order.forEach(t=>{
    const items=grps[t]||[];if(!items.length)return;
    if(getNsFilter()==='all'){const l=document.createElement('div');l.className='ns-sec';l.textContent=t==='event'?'Events':t==='task'?'Tasks':'Notes';list.appendChild(l);}
    items.forEach(it=>{
      const row=document.createElement('div');row.className='note-row';
      row.innerHTML=`<div class="nr-t">${escapeHtml(it.title)}</div><div class="nr-p">${escapeHtml(it.preview||'')}</div><div class="nr-m"><span class="nr-d">${it.date}</span>${(it.tags||[]).slice(0,2).map(t=>`<span class="otag">${escapeHtml(t)}</span>`).join('')}</div>`;
      row.onclick=()=>openEntry(it._node?it:it);list.appendChild(row);
    });
  });
}
function filterNS(){buildNS(getNsFilter());}
function setNSF(f,btn){document.querySelectorAll('.fchip').forEach(c=>c.classList.remove('on'));btn.classList.add('on');buildNS(f);}

// ── ENTRY EDITOR ──────────────────────────────────────────────
function openEntry(item){ (window as any).openEntry(item) }

export function applyScope(item: Occurrence, scope: string): { scheduled: Scheduled|null; repeat: Repeat|null } {
  const root=item._node||item;
  const occDate=item.date||root.date||null;
  const occTime=item.time||root.time||null;
  const rootDate=root.date||null;
  const rootTime=root.time||null;
  if(scope==='single') return {scheduled:occDate?{date:occDate,time:occTime||''}:null, repeat:null};
  if(scope==='future') return {scheduled:occDate?{date:occDate,time:occTime||''}:null, repeat:root.repeat||null};
  if(scope==='add') return {scheduled:{date:fmtISO(TODAY), time:occTime||''}, repeat:null};
  return {scheduled:rootDate?{date:rootDate,time:rootTime||''}:null, repeat:root.repeat||null};
}

export function buildBodyHtml(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(m,ref,label)=>{
      const target=getNodes().find(n=>n.title.toLowerCase()===ref.toLowerCase());
      return `<span class="${target?'wl':'wl-broken'}" data-ref="${ref}">[[${label||ref}]]</span>`;
    })
    .replace(/\n/g,'<br>');
}

export function closeEntry(): void {popView();}

export function saveNode(item: Occurrence|null, editScope: string, fields: any): void {
  const {title,tags,body,tracked,done,priority,scheduled,duration,repeat}=fields;
  if(!title)return;
  const rootNode=item?(item._node||item):null;
  const nodes=getNodes();
  const existingIdx=rootNode?nodes.findIndex(n=>n===rootNode||(n.id&&n.id===rootNode.id)):-1;
  const isNew=existingIdx<0;

  const f={title,tags,body:body||undefined};
  if(tracked){f.done=done;if(priority)f.priority=priority;}
  if(scheduled?.date){f.date=scheduled.date;f.time=scheduled.time||undefined;f.duration=duration||undefined;}
  if(repeat)f.repeat=repeat;

  if(isNew){
    const node={id:'node-'+bumpId(), ...f};
    if(!tracked)delete node.done;
    if(!scheduled){delete node.date;delete node.time;delete node.duration;}
    node.repeat=repeat||undefined;
    setNodes([...nodes, node]);
    writeEntityToCache(node);
    closeEntry();
    return;
  }

  const node=nodes[existingIdx];

  if(editScope==='add'){
    // Add a one-off occurrence to the series (or to a non-recurring node)
    if(!f.date){alert('Please set a date for the new occurrence.');return;}
    if(!node.instances)node.instances=[];
    // For non-recurring nodes: migrate root date into instances so all occurrences
    // are explicit in the YAML (root node.date stays as metadata)
    if(!node.repeat&&node.date){
      const alreadyCovered=node.instances.some(i=>i.date===node.date&&!i.excluded);
      if(!alreadyCovered){
        const rootInst:any={date:node.date};
        if(node.time)rootInst.time=node.time;
        node.instances.unshift(rootInst);
      }
    }
    const newInst:any={date:f.date};
    if(f.time)newInst.time=f.time;
    if(f.duration&&f.duration!==node.duration)newInst.duration=f.duration;
    if(f.title!==node.title)newInst.title=f.title;
    if(f.body&&f.body!==node.body)newInst.body=f.body;
    if(tracked&&f.done!==undefined)newInst.done=f.done;
    if(tracked&&f.priority&&f.priority!==node.priority)newInst.priority=f.priority;
    node.instances.push(newInst);
    writeEntityToCache(node);
    closeEntry();
    return;
  }

  if(editScope==='all'||!node.repeat){
    Object.assign(node,f);
    if(!tracked)delete node.done;
    if(!scheduled){delete node.date;delete node.time;delete node.duration;}
    if(repeat)node.repeat=repeat; else delete node.repeat;
    if(node.tags&&node.tags.length===0)delete node.tags;
    writeEntityToCache(node);

  } else if(editScope==='single'){
    const occDate=item.date;
    const occTime=item.time||undefined;
    const newDate=f.date;
    const newTime=f.time||undefined;
    const isRescheduled=newDate!==occDate||(newTime&&newTime!==occTime);
    if(!node.instances)node.instances=[];
    if(isRescheduled){
      let excl=node.instances.find(i=>i.date===occDate&&(!i.time||i.time===occTime));
      if(excl){excl.excluded=true;delete excl.done;}
      else{node.instances.push({date:occDate,excluded:true});}
      const newInst={date:newDate};
      if(newTime)newInst.time=newTime;
      if(f.title!==node.title)newInst.title=f.title;
      if(f.body!==node.body)newInst.body=f.body;
      if(f.tags?.length&&JSON.stringify(f.tags)!==JSON.stringify(node.tags))newInst.tags=f.tags;
      if(f.duration!==node.duration)newInst.duration=f.duration;
      if(tracked&&f.done!==undefined)newInst.done=f.done;
      if(tracked&&f.priority!==node.priority)newInst.priority=f.priority||undefined;
      node.instances.push(newInst);
    } else {
      let inst=node.instances.find(i=>i.date===occDate&&(!i.time||i.time===occTime));
      if(!inst){inst={date:occDate};if(occTime)inst.time=occTime;node.instances.push(inst);}
      if(f.title!==node.title)inst.title=f.title; else delete inst.title;
      if(f.body!==node.body)inst.body=f.body; else delete inst.body;
      if(f.tags?.length&&JSON.stringify(f.tags)!==JSON.stringify(node.tags))inst.tags=f.tags; else delete inst.tags;
      if(f.duration!==node.duration)inst.duration=f.duration; else delete inst.duration;
      if(tracked&&f.done!==undefined)inst.done=f.done; else delete inst.done;
      if(tracked&&f.priority!==node.priority)inst.priority=f.priority||undefined; else delete inst.priority;
    }
    writeEntityToCache(node);

  } else if(editScope==='future'){
    const occDate=item.date;
    const occJsDate=parseDateString(occDate);
    const untilDate=new Date(occJsDate);untilDate.setDate(untilDate.getDate()-1);
    if(!node.repeat.scheduled)node.repeat.scheduled={};
    node.repeat.scheduled.end={type:'until',date:fmtISO(untilDate)};
    if(node.instances){
      node.instances=node.instances.filter(i=>{
        const t=parseDateString(i.date||'9999-01-01');
        return !t||t<occJsDate;
      });
    }
    const newChild={date:f.date||occDate};
    if(f.time)newChild.time=f.time;
    if(f.title!==node.title)newChild.title=f.title;
    if(JSON.stringify(f.tags)!==JSON.stringify(node.tags))newChild.tags=f.tags;
    if(f.duration!==node.duration)newChild.duration=f.duration;
    if(f.body!==node.body)newChild.body=f.body;
    if(repeat)newChild.repeat=repeat;
    if(tracked&&f.done!==undefined)newChild.done=f.done;
    Object.keys(newChild).forEach(k=>{if(newChild[k]===undefined)delete newChild[k];});
    if(!node.instances)node.instances=[];
    node.instances.push(newChild);
    writeEntityToCache(node);
  }

  setNodes([...nodes]); // notify store (node mutated in place)
  closeEntry();
}

export function deleteNode(item: Occurrence|null, onShowSeries?: ()=>void, onHideSeries?: ()=>void): void {
  if(!item)return;
  const node=item._node||item;
  const nodeId=node.id;
  const occDate=item.date||node.date;

  const isScheduled=node.repeat?.type==='schedule';
  const hasMultiple=!node.repeat&&(node.instances||[]).some(i=>!i.excluded);

  function hideSheet(){
    if(onHideSeries)onHideSeries();
    else document.getElementById('seriesSheet').classList.remove('open');
  }
  function excludeThis(){
    if(!node.instances)node.instances=[];
    let inst=node.instances.find(i=>i.date===occDate&&!i.time);
    if(inst){inst.excluded=true;}
    else{node.instances.push({date:occDate,excluded:true});}
    writeEntityToCache(node);
    hideSheet();closeEntry();
  }
  function deleteAll(){
    setNodes(getNodes().filter(n=>n.id!==nodeId));
    deleteNodeFromDisk(node);
    hideSheet();closeEntry();
  }
  function deleteAllFuture(){
    // Cap the series at the day before occDate; exclude any future manual instances
    const occJsDate=parseDateString(occDate);
    const untilDate=new Date(occJsDate);untilDate.setDate(untilDate.getDate()-1);
    if(!node.repeat.scheduled)node.repeat.scheduled={};
    node.repeat.scheduled.end={type:'until',date:fmtISO(untilDate)};
    if(node.instances){
      node.instances.forEach(i=>{if(i.date&&i.date>=occDate&&!i.excluded)i.excluded=true;});
    }
    writeEntityToCache(node);
    hideSheet();closeEntry();
  }

  const opt3=document.getElementById('seriesOpt3') as HTMLElement|null;

  if(!node.repeat&&!hasMultiple){
    // Single occurrence — plain confirm, no sheet needed
    if(!confirm(`Delete "${node.title}"?`))return;
    setNodes(getNodes().filter(n=>n.id!==nodeId));
    deleteNodeFromDisk(node);
    closeEntry();
    return;
  }

  // All other cases: show the series sheet
  document.getElementById('seriesSheetTitle').textContent=`Delete "${node.title}"`;
  document.getElementById('seriesOpt1').onclick=excludeThis;

  if(isScheduled){
    // 3-button layout: This / This+following / All
    const opt2=document.getElementById('seriesOpt2');
    opt2.onclick=deleteAllFuture;
    opt2.querySelector('.sopt-t').textContent='This and all following';
    opt2.querySelector('.sopt-s').textContent='Remove this and all future occurrences';
    if(opt3){
      opt3.style.display='';
      opt3.onclick=deleteAll;
      opt3.querySelector('.sopt-t').textContent='All occurrences';
      opt3.querySelector('.sopt-s').textContent='Remove all occurrences';
    }
  } else {
    // 2-button layout: This / All
    const opt2=document.getElementById('seriesOpt2');
    opt2.onclick=deleteAll;
    opt2.querySelector('.sopt-t').textContent='All occurrences';
    opt2.querySelector('.sopt-s').textContent='Remove all occurrences';
    if(opt3)opt3.style.display='none';
  }

  if(onShowSeries)onShowSeries();
  else document.getElementById('seriesSheet').classList.add('open');
  ic();
}

// ── DIALOGS ──────────────────────────────────────────────────
export function openRepeatDlg({scheduled,tracked,repeat}: {scheduled: Scheduled|null; tracked: boolean; repeat: Repeat|null}): void {
  const hasSched=!!scheduled,hasTrk=tracked;
  const hint=document.getElementById('repeatHintText'),hintBox=document.getElementById('repeatHint');
  if(hasSched&&hasTrk){hint.textContent='Both Schedule and Track Completion are on. Choose a schedule pattern, or "After completion" to repeat when you check this done.';hintBox.style.display='flex';}
  else if(hasTrk&&!hasSched){hint.textContent='"After completion" repeats whenever you mark this done.';hintBox.style.display='flex';rdType='after_completion';}
  else{hint.textContent='Choose how often this scheduled item repeats.';hintBox.style.display='flex';if(rdType==='after_completion')rdType='weekly';}
  if(!repeat&&scheduled?.date){
    const jsDay=parseDateString(scheduled.date)?.getDay()??1;
    const monFirst=(jsDay+6)%7;
    rdWdays=[false,false,false,false,false,false,false];
    rdWdays[monFirst]=true;
  }
  buildRepeatDlg(hasSched,hasTrk);
}

export function buildRepeatValue(): Repeat {
  const iv=document.getElementById('rdIv');if(iv)rdInterval=iv.value;
  const ed=document.getElementById('endD');if(ed)rdEndVal=ed.value;
  const ec=document.getElementById('endC');if(ec)rdEndVal=ec.value;
  const sched={freq:rdType==='daily'?'daily':rdType==='weekly'?'weekly':rdType==='monthly'?'monthly':'yearly'};
  if(rdType==='weekly'){const wdMap=['mo','tu','we','th','fr','sa','su'];sched.byweekday=wdMap.filter((_,i)=>rdWdays[i]);}
  if(rdType==='monthly'&&rdMonthly==='first-weekday'){sched.byweekday=['mo','tu','we','th','fr'];sched.bysetpos=1;}
  if(rdEndType==='until'&&rdEndVal)sched.end={type:'until',time:rdEndVal};
  if(rdEndType==='count'&&rdEndVal)sched.end={type:'count',occurrences:parseInt(rdEndVal)};
  return rdType==='after_completion'?{type:'after_completion',interval:rdInterval}:{type:'schedule',scheduled:sched};
}
function buildRepeatDlg(hasSched,hasTrk){
  const grid=document.getElementById('recurGrid');grid.innerHTML='';
  const opts=[];
  if(hasSched)opts.push({id:'daily',label:'Daily'},{id:'weekly',label:'Weekly'},{id:'monthly',label:'Monthly'},{id:'yearly',label:'Yearly'});
  if(hasTrk)opts.push({id:'after_completion',label:'After ✓'});
  if(!rdType)rdType=opts[0]?.id;
  opts.forEach(o=>{const btn=document.createElement('button');btn.className=`ro${rdType===o.id?' on':''}`;btn.textContent=o.label;btn.onclick=()=>{rdType=o.id;buildRepeatDlg(hasSched,hasTrk);};grid.appendChild(btn);});
  buildRepeatConfig();
}
function buildRepeatConfig(){
  const cfg=document.getElementById('recurConfig');cfg.innerHTML='';
  const end=document.getElementById('endSec');end.innerHTML='';
  if(rdType==='weekly'){
    const row=document.createElement('div');row.className='wd-row';
    ['Mo','Tu','We','Th','Fr','Sa','Su'].forEach((d,i)=>{
      const b=document.createElement('button');
      b.className=`wd${rdWdays[i]?' on':''}`;
      b.textContent=d;
      b.onclick=()=>{rdWdays[i]=!rdWdays[i];buildRepeatConfig();};
      row.appendChild(b);
    });
    cfg.appendChild(row);
  }
  else if(rdType==='monthly'){const w=document.createElement('div');w.className='monthly-opts';[['first-weekday','First weekday of month'],['last-weekday','Last weekday of month'],['same-day','Same day of month']].forEach(([v,l])=>{const b=document.createElement('button');b.className=`mopt${rdMonthly===v?' on':''}`;b.textContent=l;b.onclick=()=>{rdMonthly=v;buildRepeatConfig();};w.appendChild(b);});cfg.appendChild(w);}
  else if(rdType==='after_completion'){const row=document.createElement('div');row.className='interval-row';row.innerHTML=`<span>Every</span><input class="dlg-in" id="rdIv" value="${escapeHtml(rdInterval)}" style="width:130px" placeholder="e.g. 2 days">`;cfg.appendChild(row);}
  if(rdType&&rdType!=='after_completion'){end.style.display='block';end.innerHTML=`<div class="end-lbl">Ends</div><div class="end-opts"><button class="eopt${rdEndType==='never'?' on':''}" onclick="setEnd('never',this)">Never</button><button class="eopt${rdEndType==='until'?' on':''}" onclick="setEnd('until',this)">On date</button><button class="eopt${rdEndType==='count'?' on':''}" onclick="setEnd('count',this)">After N</button></div><div id="endValRow"></div>`;buildEndVal();}
  else end.style.display='none';
}
function setEnd(type,btn){rdEndType=type;document.querySelectorAll('.eopt').forEach(b=>b.classList.remove('on'));btn.classList.add('on');buildEndVal();}
function buildEndVal(){const row=document.getElementById('endValRow');if(!row)return;if(rdEndType==='until')row.innerHTML=`<input class="dlg-in" style="width:100%;margin-top:6px" type="date" id="endD" value="${escapeHtml(rdEndVal)}">`;else if(rdEndType==='count')row.innerHTML=`<input class="dlg-in" style="width:100%;margin-top:6px" type="number" id="endC" placeholder="occurrences" value="${escapeHtml(rdEndVal)}">`;else row.innerHTML='';}

// ── WIKILINK AUTOCOMPLETE ─────────────────────────────────────
let wlFocusIdx=-1;

export function wikilinkInputHandler(e: Event): void {
  if(!e.target.closest('#entryBody'))return;
  const sel=window.getSelection();if(!sel.rangeCount)return;
  const range=sel.getRangeAt(0);
  const bodyEl=document.getElementById('entryBody');
  const preRange=document.createRange();
  preRange.setStart(bodyEl,0);
  try{preRange.setEnd(range.startContainer,range.startOffset);}catch(err){return;}
  const before=preRange.toString();
  const m=before.match(/\[\[([^\]\n]*)$/);
  const popup=document.getElementById('wlPopup');
  if(m){
    const q=m[1].toLowerCase();
    if(!q){popup.classList.remove('show');return;}
    const allTitles=[...new Set([...getNodes(),...NOTES_DATA].map(o=>o.title))];
    const matches=allTitles.filter(t=>t.toLowerCase().includes(q)).slice(0,8);
    if(matches.length){
      wlFocusIdx=-1;
      popup.innerHTML=matches.map(t=>{
        const o=getNodes().find(n=>n.title===t)||NOTES_DATA.find(n=>n.title===t);
        const icon=o?.done!==undefined?'check-square':o?.time?'calendar':'file-text';
        return `<div class="wl-item" data-title="${escapeHtml(t)}"><i data-lucide="${icon}"></i>${escapeHtml(t)}</div>`;
      }).join('');
      popup.classList.add('show');
      const rect=range.getBoundingClientRect();
      popup.style.top=(rect.bottom+6)+'px';
      popup.style.left=Math.max(8,rect.left)+'px';
      popup.querySelectorAll('.wl-item').forEach(item=>{item.onmousedown=ev=>{ev.preventDefault();insertWikilink(item.dataset.title);};});
      ic();return;
    }
  }
  popup.classList.remove('show');
}

export function wikilinkKeydownHandler(e: Event): void {
  const popup=document.getElementById('wlPopup');
  if(popup.classList.contains('show')){
    const items=popup.querySelectorAll('.wl-item');
    if(e.key==='ArrowDown'){e.preventDefault();wlFocusIdx=Math.min(wlFocusIdx+1,items.length-1);items.forEach((it,i)=>it.classList.toggle('focused',i===wlFocusIdx));return;}
    if(e.key==='ArrowUp'){e.preventDefault();wlFocusIdx=Math.max(wlFocusIdx-1,0);items.forEach((it,i)=>it.classList.toggle('focused',i===wlFocusIdx));return;}
    if(e.key==='Enter'&&wlFocusIdx>=0){e.preventDefault();insertWikilink(items[wlFocusIdx].dataset.title);return;}
    if(e.key==='Escape'){popup.classList.remove('show');return;}
  }
  if(e.key==='Escape')document.querySelectorAll('.dlg-ov.open').forEach(d=>d.classList.remove('open'));
}

export function wikilinkClickHandler(e: Event): void {
  const p=document.getElementById('wlPopup');
  if(p&&!p.contains(e.target)&&!e.target.closest('#entryBody'))p.classList.remove('show');
}

function insertWikilink(title){
  const popup=document.getElementById('wlPopup');popup.classList.remove('show');
  const sel=window.getSelection();if(!sel.rangeCount)return;
  const range=sel.getRangeAt(0);
  const bodyEl=document.getElementById('entryBody');
  const preRange=document.createRange();preRange.setStart(bodyEl,0);
  try{preRange.setEnd(range.startContainer,range.startOffset);}catch(err){return;}
  const before=preRange.toString();
  const openBracket=before.lastIndexOf('[[');if(openBracket===-1)return;
  const node=range.startContainer;
  const pos=range.startOffset;
  const fullText=node.textContent;
  const localOpenBracket=fullText.lastIndexOf('[[',pos-1);
  if(localOpenBracket===-1)return;
  node.textContent=fullText.slice(0,localOpenBracket)+'[['+title+']]'+fullText.slice(pos);
  const newPos=localOpenBracket+title.length+4;
  const newRange=document.createRange();
  newRange.setStart(node,Math.min(newPos,node.textContent.length));
  newRange.collapse(true);sel.removeAllRanges();sel.addRange(newRange);
}

// ── UNDO TOAST MANAGER ───────────────────────────────────────
let _toastTimer=null, _toastEl=null, _pendingDelete=null;
const TOAST_MS=4000;

function showDeleteToast(title, commitFn, undoFn){
  if(_toastTimer){commitToast();}
  _pendingDelete={commitFn, undoFn};
  const toast=document.createElement('div');
  toast.className='undo-toast';
  toast.innerHTML=
    `<span class="undo-toast-msg">Deleted: <strong>${escapeHtml(title)}</strong></span>`+
    `<button class="undo-btn">Undo</button>`;
  const float=document.getElementById('bottomFloat');
  float.insertBefore(toast, float.firstChild);
  _toastEl=toast;
  toast.querySelector('.undo-btn').onclick=()=>{undoToast();};
  _toastTimer=setTimeout(()=>commitToast(), TOAST_MS);
}

function commitToast(){
  if(!_toastTimer)return;
  clearTimeout(_toastTimer);_toastTimer=null;
  if(_pendingDelete){_pendingDelete.commitFn();_pendingDelete=null;}
  dismissToast();
}

function undoToast(){
  clearTimeout(_toastTimer);_toastTimer=null;
  if(_pendingDelete){_pendingDelete.undoFn();_pendingDelete=null;}
  dismissToast();
}

function dismissToast(){
  if(!_toastEl)return;
  const el=_toastEl;_toastEl=null;
  el.classList.add('hiding');
  setTimeout(()=>el.remove(),280);
}

function addSwipe(el,onLeft,onRight){
  if(!el)return;
  let sx=0,sy=0;
  el.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY;},{passive:true});
  el.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;
    if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5){if(dx<0)onLeft();else onRight();}
  },{passive:true});
}


function nodeToPath(node){
  if(node._path)return node._path;
  const slug=titleToSlug(node.title);
  const collision=getNodes().some(n=>{
    if(n===node||n.id===node.id)return false;
    const otherSlug=n._path?n._path.replace(/\.md$/,''):titleToSlug(n.title);
    return otherSlug===slug;
  });
  const path=collision?`${slug}-${node.id}.md`:`${slug}.md`;
  node._path=path;
  return path;
}

let db=null;
let _cacheInitPromise=null;

async function cacheInit(){
  if(db)return db;
  if(_cacheInitPromise)return _cacheInitPromise;
  _cacheInitPromise=(async()=>{
    db=new Dexie('meridian_v2');
    db.version(1).stores({files:'path,dirty,updatedAt'});
    await db.open();
    return db;
  })();
  return _cacheInitPromise;
}

async function cacheWrite(path, content){
  await cacheInit();
  await db.files.put({path, content, dirty:1, updatedAt:Date.now()});
}

async function cacheWriteClean(path, content){
  await cacheInit();
  await db.files.put({path, content, dirty:0, updatedAt:Date.now()});
}

async function cacheDelete(path){
  await cacheInit();
  await db.files.delete(path);
}

async function cacheGetDirty(){
  await cacheInit();
  return db.files.where('dirty').equals(1).toArray();
}

async function cacheMarkClean(path){
  await cacheInit();
  await db.files.update(path, {dirty:0});
}

async function cacheDirtyCount(){
  if(!db)return 0;
  try{return await db.files.where('dirty').equals(1).count();}
  catch(e){return 0;}
}

// dirHandle → useStore

async function diskPickDirectory(){
  if(!window.showDirectoryPicker){
    throw new Error('Your browser does not support folder access. Use Chrome or Edge, and open this file directly (not in a preview).');
  }
  try{
    setDirHandle(await window.showDirectoryPicker({mode:'readwrite'}));
  }catch(e){
    if(e.name==='AbortError')throw e;
    if(e.name==='SecurityError'){
      throw new Error('Folder access is blocked here. This happens inside embedded previews. Save this HTML file and open it directly in Chrome or Edge.');
    }
    throw e;
  }
  return getDirHandle();
}

async function diskReadAll(){
  if(!getDirHandle())return [];
  const results=[];
  for await(const [name, fh] of getDirHandle().entries()){
    if(!name.endsWith('.md')&&!name.endsWith('.yaml')&&!name.endsWith('.yml'))continue;
    try{
      const file=await fh.getFile();
      const content=await file.text();
      results.push({path:name, content});
    }catch(e){console.warn('[storage] could not read', name, e);}
  }
  return results;
}

async function diskWrite(path, content){
  if(!getDirHandle())throw new Error('No vault folder connected');
  const perm=await getDirHandle().queryPermission({mode:'readwrite'});
  if(perm!=='granted'){
    const ask=await getDirHandle().requestPermission({mode:'readwrite'});
    if(ask!=='granted')throw new Error('Write permission denied');
  }
  const fh=await getDirHandle().getFileHandle(path,{create:true});
  const w=await fh.createWritable();
  await w.write(content);
  await w.close();
}

async function diskDelete(path){
  if(!getDirHandle())return;
  try{await getDirHandle().removeEntry(path);}catch(e){}
}

async function writeEntityToCache(node){
  try{
    const path=nodeToPath(node);
    const content=nodeToFile(node);
    await cacheWrite(path, content);
    updateSyncUI();
  }catch(e){
    console.error('[storage] writeEntityToCache failed:', e);
  }
}

async function deleteNodeFromDisk(node){
  try{
    const path=nodeToPath(node);
    await cacheDelete(path);
    await diskDelete(path);
    updateSyncUI();
  }catch(e){
    console.error('[storage] deleteNodeFromDisk failed:', e);
  }
}

async function syncToDirectory(){
  try{
    if(!getDirHandle()){alert('No vault folder connected. Click the folder icon first.');return;}
    const dirty=await cacheGetDirty();
    if(!dirty.length){updateSyncUI();return;}
    for(const f of dirty){
      await diskWrite(f.path, f.content);
      await cacheMarkClean(f.path);
    }
    updateSyncUI();
    const btn=document.getElementById('syncBtn');
    if(btn){btn.style.color='var(--grn)';setTimeout(()=>updateSyncUI(),800);}
  }catch(e){
    console.error('[storage] sync failed:', e);
    alert('Sync failed: '+(e.message||e.name));
  }
}

async function pickDirectory(){
  try{
    await cacheInit();
    await diskPickDirectory();
    const files=await diskReadAll();
    const loaded=[];
    for(const {path, content} of files){
      await cacheWriteClean(path, content);
      try{const node=fileToNode(path, content);if(node.title)loaded.push(node);}catch(e){console.warn('[storage] parse failed for', path, e);}
    }
    setNodes(loaded);
    updateSyncUI();
    setTimeout(()=>goToday(),100);
  }catch(e){
    if(e.name==='AbortError')return;
    console.error('[storage] pickDirectory failed:', e);
    alert(e.message||'Could not connect vault');
  }
}

function updateSyncUI(){
  const btn=document.getElementById('syncBtn');
  if(!btn)return;
  cacheDirtyCount().then(n=>{
    if(!db){btn.style.color='var(--t3)';btn.title='No vault connected';return;}
    btn.style.color=n>0?'var(--amb)':'var(--t2)';
    btn.title=n>0
      ? `${n} unsaved change${n>1?'s':''} — click to sync`
      : getDirHandle()?'All synced':'Click folder icon to open vault';
  }).catch(()=>{});
}

const entityToFile=nodeToFile;
async function loadFromDirectory(){
  const files=await diskReadAll();
  const loaded=[];
  for(const {path, content} of files){
    await cacheWriteClean(path, content);
    try{const node=fileToNode(path, content);if(node.title)loaded.push(node);}catch(e){}
  }
  setNodes(loaded);
}
async function initDexie(){return cacheInit();}

// ── INIT ──────────────────────────────────────────────────────
export function initApp(): void {
  setNodes(SEED_NODES);
  ic();
  // Month calendar navigation is now handled by MonthView (React).
  // Swipe on the day-view timeline still needs vanilla handling.
  addSwipe(document.getElementById('dvTl'),()=>dvNav(1),()=>dvNav(-1));
  // Scroll-to-today in the agenda is handled by AgendaView on mount.
}

// Only functions called from vanilla JS inline onclick strings need window exposure
Object.assign(window as any, {
  setEnd,   // used in buildRepeatConfig innerHTML onclick strings
  autoResize,
  openSidebar, closeSidebar, sidebarNav,
  closeDayView, dvNav,
  syncToDirectory, pickDirectory, goToday, openSearch, closeSearch,
  filterNS, setNSF,
  applyGlobalFilter,
});
