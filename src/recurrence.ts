// @ts-nocheck
// ── DATE HELPERS (shared with yaml.ts) ───────────────────────
export const fmtISO = d =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export const fmtT = v => {
  if(!v) return null;
  if(typeof v==='string' && v.match(/^\d{1,2}:\d{2}/)) return v.slice(0,5);
  if(v instanceof Date){const h=v.getHours(),m=v.getMinutes();return(h||m)?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`:null;}
  return null;
};

// ── SPEC EXPANSION ENGINE (v0.9) ─────────────────────────────
const WDAYS_MAP={su:0,mo:1,tu:2,we:3,th:4,fr:5,sa:6};

export function nodeDateTime(nodeOrInst){
  const dateStr=nodeOrInst.date;
  const timeStr=nodeOrInst.time;
  if(!dateStr)return null;
  const dm=String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!dm)return null;
  const [,y,mo,d]=dm.map(Number);
  if(timeStr){
    const tm=String(timeStr).match(/^(\d{1,2}):(\d{2})/);
    if(tm)return new Date(y,mo-1,d,+tm[1],+tm[2],0,0);
  }
  return new Date(y,mo-1,d,0,0,0,0);
}

export function jsDateToSpec(jsDate){
  if(!jsDate||isNaN(jsDate))return {date:null,time:null};
  const date=fmtISO(jsDate);
  const h=jsDate.getHours(),m=jsDate.getMinutes();
  const time=(h||m)?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`:null;
  return {date,time};
}

export function parseDateString(s){
  if(!s)return null;
  if(s instanceof Date)return isNaN(s)?null:s;
  const dm=String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(dm)return new Date(+dm[1],+dm[2]-1,+dm[3]);
  const d=new Date(s);
  return isNaN(d)?null:d;
}

export function toDate(v){
  if(!v)return null;
  if(v instanceof Date)return isNaN(v)?null:v;
  return parseDateString(String(v));
}

export function addInterval(date, intervalStr){
  const d=new Date(date);
  const m=intervalStr.match(/(\d+)\s*(day|week|hour|minute|month|year)s?/i);
  if(!m)return d;
  const n=parseInt(m[1]);
  const unit=m[2].toLowerCase();
  if(unit==='day')d.setDate(d.getDate()+n);
  else if(unit==='week')d.setDate(d.getDate()+n*7);
  else if(unit==='hour')d.setHours(d.getHours()+n);
  else if(unit==='minute')d.setMinutes(d.getMinutes()+n);
  else if(unit==='month')d.setMonth(d.getMonth()+n);
  else if(unit==='year')d.setFullYear(d.getFullYear()+n);
  return d;
}

export function mergeNode(parent, child){
  const merged={...parent};
  for(const [k,v] of Object.entries(child)){
    if(k==='instances')continue;
    if(v&&typeof v==='object'&&!Array.isArray(v)&&v.type!==undefined){
      merged[k]=v;
    } else if(v&&typeof v==='object'&&!Array.isArray(v)){
      merged[k]=mergeNode(merged[k]||{},v);
    } else {
      merged[k]=v;
    }
  }
  return merged;
}

function generateScheduledDates(anchor, anchorTimeStr, sched, from, to){
  const {freq, byweekday, bymonthday, bysetpos, interval=1, end} = sched;
  const results=[];
  const maxDate=end?.type==='until'?toDate(end.date||end.time)||to:to;
  let maxCount=end?.type==='count'?end.occurrences:Infinity;
  let count=0;

  function withTime(d){
    const r=new Date(d);
    if(anchorTimeStr){
      const tm=String(anchorTimeStr).match(/^(\d{1,2}):(\d{2})/);
      if(tm){r.setHours(+tm[1],+tm[2],0,0);}
    } else {
      r.setHours(0,0,0,0);
    }
    return r;
  }

  function nextBase(d){
    const n=new Date(d);
    if(freq==='daily')n.setDate(n.getDate()+interval);
    else if(freq==='weekly')n.setDate(n.getDate()+7*interval);
    else if(freq==='monthly')n.setMonth(n.getMonth()+interval);
    else if(freq==='yearly')n.setFullYear(n.getFullYear()+interval);
    return n;
  }

  function matchesInPeriod(periodStart){
    const dates=[];
    if(freq==='daily'){
      dates.push(withTime(periodStart));
    } else if(freq==='weekly'){
      if(!byweekday||!byweekday.length){dates.push(withTime(periodStart));}
      else{
        const wd=periodStart.getDay();
        const mondayOff=(wd===0)?-6:(1-wd);
        const weekStart=new Date(periodStart);
        weekStart.setDate(periodStart.getDate()+mondayOff);
        for(const dStr of byweekday){
          const target=WDAYS_MAP[dStr.toLowerCase()]||0;
          const dayCandidate=new Date(weekStart);
          dayCandidate.setDate(weekStart.getDate()+(target===0?6:target-1));
          dates.push(withTime(dayCandidate));
        }
      }
    } else if(freq==='monthly'){
      if(bymonthday&&bymonthday.length){
        for(const mday of bymonthday){
          dates.push(withTime(new Date(periodStart.getFullYear(),periodStart.getMonth(),mday)));
        }
      } else if(byweekday&&byweekday.length&&bysetpos!==undefined){
        const month=periodStart.getMonth(),year=periodStart.getFullYear();
        const candidates=[];
        const daysInMonth=new Date(year,month+1,0).getDate();
        const targetDays=byweekday.map(d=>WDAYS_MAP[d.toLowerCase()]||0);
        for(let day=1;day<=daysInMonth;day++){
          const d2=new Date(year,month,day);
          if(targetDays.includes(d2.getDay()))candidates.push(d2);
        }
        const pos=bysetpos<0?candidates.length+bysetpos:bysetpos-1;
        if(candidates[pos])dates.push(withTime(candidates[pos]));
      } else {
        dates.push(withTime(new Date(periodStart.getFullYear(),periodStart.getMonth(),anchor.getDate())));
      }
    } else if(freq==='yearly'){
      dates.push(withTime(new Date(periodStart.getFullYear(),anchor.getMonth(),anchor.getDate())));
    }
    return dates;
  }

  let cursor=new Date(anchor);
  const LIMIT=500; let iter=0;
  while(cursor<=maxDate&&count<maxCount&&iter++<LIMIT){
    const dates=matchesInPeriod(cursor).filter(d=>d>anchor&&d>=from&&d<=maxDate&&d<=to);
    for(const d of dates.sort((a,b)=>a-b)){
      if(d>anchor&&count<maxCount){results.push(d);count++;}
    }
    cursor=nextBase(cursor);
    if(cursor>maxDate||cursor>to)break;
  }
  return results;
}

export function expandNode(node, from, to){
  const occurrences=[];
  const anchor=nodeDateTime(node);
  if(!anchor)return occurrences;

  const instanceOverrides=(node.instances||[]).map(child=>{
    const t=nodeDateTime(child);
    if(!t&&!child.date)return null;
    const hasTime=!!(child.time);
    const matchDate=child.date?parseDateString(child.date):t;
    return {
      ms:t?t.getTime():matchDate?matchDate.getTime():0,
      hasTime,
      matchDate,
      child,
      eff:mergeNode(node,child)
    };
  }).filter(Boolean);

  function findOverride(jsDate){
    for(const o of instanceOverrides){
      if(!o.hasTime){
        const od=o.matchDate;
        if(od&&od.getFullYear()===jsDate.getFullYear()&&od.getMonth()===jsDate.getMonth()&&od.getDate()===jsDate.getDate())return o;
      } else {
        if(Math.abs(o.ms-jsDate.getTime())<60000)return o;
      }
    }
    return null;
  }

  function makeOcc(eff, jsDate, baseNode, instOverride){
    if(eff.excluded)return null;
    const occTimeStr=eff.time||baseNode.time||node.time||null;
    const occDate=(instOverride&&instOverride.child.date&&instOverride.child.date!==node.date)
      ? instOverride.child.date
      : jsDateToSpec(jsDate).date;
    return {
      title:eff.title||node.title,
      date:occDate,
      time:occTimeStr,
      timezone:eff.timezone||node.timezone,
      jsTime:jsDate,
      duration:eff.duration||node.duration,
      done:eff.done,
      priority:eff.priority||node.priority,
      tags:eff.tags||[],
      type:eff.type||(eff.done!==undefined?'task':'event'),
      body:eff.body,
      multiday:eff.multiday,
      recur:true,
      _nodeId:node.id,
      _node:node,
    };
  }

  if(node.repeat?.type!=='after_completion'){
    if(anchor>=from&&anchor<=to){
      const ov=findOverride(anchor);
      const occ=makeOcc(ov?ov.eff:node, anchor, node, ov);
      if(occ)occurrences.push(occ);
    }
  }

  if(!node.repeat)return occurrences;

  if(node.repeat.type==='schedule'){
    const sched=node.repeat.scheduled||{};
    const generated=generateScheduledDates(anchor, node.time, sched, from, to);
    const generatedMs=new Set(generated.map(d=>d.getTime()));
    generatedMs.add(anchor.getTime());

    for(const genDate of generated){
      const ov=findOverride(genDate);
      const effNode=ov?ov.eff:node;
      const occ=makeOcc(effNode, genDate, node, ov);
      if(occ)occurrences.push(occ);
    }

    for(const inst of (node.instances||[])){
      if(inst.excluded)continue;
      const t=nodeDateTime(inst);
      if(!t)continue;
      let isGenerated=false;
      if(!inst.time){
        isGenerated=[...generatedMs].some(ms=>{
          const gd=new Date(ms);
          return gd.getFullYear()===t.getFullYear()&&gd.getMonth()===t.getMonth()&&gd.getDate()===t.getDate();
        });
      } else {
        isGenerated=[...generatedMs].some(ms=>Math.abs(ms-t.getTime())<60000);
      }
      if(!isGenerated&&t>=from&&t<=to){
        const eff=mergeNode(node,inst);
        if(!eff.excluded){
          occurrences.push({
            title:eff.title||node.title,
            date:inst.date||jsDateToSpec(t).date,
            time:eff.time||node.time||null,
            timezone:eff.timezone||node.timezone,
            jsTime:t,
            duration:eff.duration||node.duration,
            done:inst.done,
            tags:eff.tags||node.tags||[],
            type:eff.type||(eff.done!==undefined?'task':'event'),
            body:eff.body||node.body,
            recur:true,_nodeId:node.id,_node:node,
          });
        }
      }
    }
  } else if(node.repeat.type==='after_completion'){
    const allTimes=[];
    const anchorInst=(node.instances||[]).find(i=>{
      const t=nodeDateTime(i)||parseDateString(i.date);
      return t&&Math.abs(t.getTime()-anchor.getTime())<60000;
    });
    if(!anchorInst?.excluded){
      allTimes.push({jsTime:anchor, done:anchorInst!==undefined?anchorInst.done:node.done, priority:anchorInst?.priority||node.priority});
    }
    for(const inst of (node.instances||[])){
      const t=nodeDateTime(inst)||parseDateString(inst.date);
      if(!t||inst.excluded)continue;
      if(Math.abs(t.getTime()-anchor.getTime())<60000)continue;
      allTimes.push({jsTime:t, done:inst.done, priority:inst.priority||node.priority});
    }
    allTimes.sort((a,b)=>a.jsTime-b.jsTime);

    for(const entry of allTimes){
      if(entry.jsTime>=from&&entry.jsTime<=to){
        const spec=jsDateToSpec(entry.jsTime);
        occurrences.push({
          title:node.title, date:spec.date, time:spec.time||node.time||null,
          timezone:node.timezone, jsTime:entry.jsTime, done:entry.done,
          tags:node.tags||[], type:'task', priority:entry.priority, body:node.body,
          recur:true, _nodeId:node.id, _node:node
        });
      }
    }
    const lastDone=[...allTimes].reverse().find(e=>e.done===true);
    if(lastDone){
      const nextJsTime=addInterval(lastDone.jsTime, node.repeat.interval||'1 day');
      const alreadyExists=allTimes.some(e=>Math.abs(e.jsTime.getTime()-nextJsTime.getTime())<60000);
      if(!alreadyExists&&nextJsTime>=from&&nextJsTime<=to){
        const spec=jsDateToSpec(nextJsTime);
        occurrences.push({
          title:node.title, date:spec.date, time:spec.time||node.time||null,
          timezone:node.timezone, jsTime:nextJsTime, done:false,
          tags:node.tags||[], type:'task', priority:node.priority, body:node.body,
          recur:true, _nodeId:node.id, _node:node
        });
      }
    }
  }

  for(const child of (node.instances||[])){
    if(child.repeat){
      const effChild=mergeNode(node,child);
      occurrences.push(...expandNode({...effChild,instances:[]},from,to));
    }
  }

  return occurrences;
}

export function expandRange(nodes, from, to){
  const addDays=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r};
  const all=[];
  for(const node of nodes){
    if(node.multiday){
      let d=parseDateString(node.multiday.start||node.date);
      if(!d)continue;
      d=new Date(d);d.setHours(0,0,0,0);
      const endD=parseDateString(node.multiday.end);
      if(!endD)continue;
      const endDt=new Date(endD);endDt.setHours(23,59,59);
      while(d<=endDt){
        if(d>=from&&d<=to){
          const spec=jsDateToSpec(d);
          all.push({...node,date:spec.date,time:null,jsTime:new Date(d),_nodeId:node.id,_node:node,recur:false});
        }
        d=addDays(d,1);
      }
    } else if(node.repeat){
      all.push(...expandNode(node,from,to));
    } else {
      const liveInstances=(node.instances||[]).filter(i=>!i.excluded&&!i.repeat);
      if(liveInstances.length>0){
        // Multi-occurrence non-recurring: root date is metadata only; all calendar items come from instances
        for(const inst of liveInstances){
          const it=nodeDateTime(inst)||parseDateString(inst.date);
          if(!it||it<from||it>to)continue;
          const eff=mergeNode(node,inst);
          if(!eff.excluded){
            all.push({
              ...eff,
              date:inst.date||jsDateToSpec(it).date,
              jsTime:it,
              _nodeId:node.id,
              _node:node,
              recur:true,  // enables per-instance swipe-delete (exclude, not full node delete)
            });
          }
        }
      } else {
        // Single occurrence: emit root date
        const t=nodeDateTime(node);
        if(t&&t>=from&&t<=to){
          all.push({...node,jsTime:t,_nodeId:node.id,_node:node,recur:false});
        }
      }
    }
  }
  const seen=new Set();
  return all.filter(o=>{
    if(!o.jsTime)return false;
    const k=`${o._nodeId||o.title}|${o.jsTime.getTime()}`;
    if(seen.has(k))return false;seen.add(k);return true;
  }).sort((a,b)=>a.jsTime-b.jsTime);
}

export function parseDurationHours(dur){
  if(!dur)return 0.75;
  const s=String(dur).toLowerCase().trim();
  let h=0, m=0;
  const hm=s.match(/(\d+(?:\.\d+)?)\s*h/);
  const mm=s.match(/(\d+)\s*m/);
  if(hm)h=parseFloat(hm[1]);
  if(mm)m=parseInt(mm[1]);
  if(!hm&&!mm){
    const n=parseFloat(s);
    if(!isNaN(n))h=n;
  }
  const total=h+m/60;
  return total>0?total:0.75;
}
