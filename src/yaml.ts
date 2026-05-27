// @ts-nocheck
import { fmtISO, fmtT } from './model/expand'

// ── YAML PARSER ───────────────────────────────────────────────
export function yamlParseScalar(v){
  const s=String(v).trim();
  if(s==='')return '';
  if(s==='true')return true;
  if(s==='false')return false;
  if(s==='null'||s==='~')return null;
  if(/^-?\d+$/.test(s))return parseInt(s,10);
  if(/^-?\d+\.\d+$/.test(s))return parseFloat(s);
  if(/^\[.*\]$/.test(s))return s.slice(1,-1).split(',').map(x=>x.trim()).filter(Boolean).map(yamlParseScalar);
  return s.replace(/^["']|["']$/g,'');
}

function yamlIndent(line){
  let n=0;
  while(n<line.length&&line[n]===' ')n++;
  return n;
}

export function yamlParse(text){
  const lines=text.split('\n').filter(l=>l.trim()!==''&&!l.trim().startsWith('#'));

  function parseBlock(startIdx, baseIndent){
    if(startIdx>=lines.length)return [null, startIdx];
    const firstLine=lines[startIdx];
    const indent=yamlIndent(firstLine);
    if(indent<baseIndent)return [null, startIdx];

    if(firstLine.trim().startsWith('- ')){
      const items=[];
      let i=startIdx;
      while(i<lines.length){
        const line=lines[i];
        const lineIndent=yamlIndent(line);
        if(lineIndent<indent)break;
        if(lineIndent===indent&&line.trim().startsWith('- ')){
          const item={};
          const rest=line.trim().slice(2);
          const m=rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
          if(m){
            const key=m[1], val=m[2];
            if(val.trim()===''){
              const [v, nextI]=parseBlock(i+1, indent+2);
              item[key]=v;
              i=nextI;
            } else {
              item[key]=yamlParseScalar(val);
              i++;
            }
          } else {
            i++;
          }
          while(i<lines.length){
            const cl=lines[i];
            const ci=yamlIndent(cl);
            if(ci<=indent)break;
            const km=cl.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
            if(km){
              const ckey=km[1], cval=km[2];
              if(cval.trim()===''){
                const [v, nextI]=parseBlock(i+1, ci+2);
                item[ckey]=v;
                i=nextI;
              } else {
                item[ckey]=yamlParseScalar(cval);
                i++;
              }
            } else {
              i++;
            }
          }
          items.push(item);
        } else {
          break;
        }
      }
      return [items, i];
    }

    const dict={};
    let i=startIdx;
    while(i<lines.length){
      const line=lines[i];
      const lineIndent=yamlIndent(line);
      if(lineIndent<indent)break;
      if(lineIndent>indent){i++;continue;}
      const m=line.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if(!m){i++;continue;}
      const key=m[1], val=m[2];
      if(val.trim()===''){
        const [v, nextI]=parseBlock(i+1, indent+2);
        dict[key]=v;
        i=nextI;
      } else {
        dict[key]=yamlParseScalar(val);
        i++;
      }
    }
    return [dict, i];
  }

  const [result]=parseBlock(0, 0);
  return result||{};
}

// ── YAML SERIALIZER ───────────────────────────────────────────
export function yamlSerializeScalar(v){
  if(v===null||v===undefined)return 'null';
  if(typeof v==='boolean')return v?'true':'false';
  if(typeof v==='number')return String(v);
  if(Array.isArray(v))return '[' + v.map(yamlSerializeScalar).join(', ') + ']';
  if(v instanceof Date){
    const iso=fmtISO(v);
    const t=fmtT(v);
    return t?`${iso}T${t}`:iso;
  }
  const s=String(v);
  if(s.includes(': ')||s.includes(' #')||s.startsWith('[')||s.startsWith('"')||s.startsWith("'"))return `"${s.replace(/"/g,'\\"')}"`;
  return s;
}

// ── NODE ↔ FILE ───────────────────────────────────────────────
export function nodeToFile(node){
  const lines=[];
  const push=(key, val)=>lines.push(`${key}: ${yamlSerializeScalar(val)}`);
  if(node.title)push('title', node.title);
  if(node.date)push('date', node.date);
  if(node.time)lines.push(`time: "${node.time}"`);
  if(node.timezone)push('timezone', node.timezone);
  if(node.duration)push('duration', node.duration);
  if(node.done!==undefined){push('done', node.repeat?false:node.done);}
  if(node.priority)push('priority', node.priority);
  if(node.tags&&node.tags.length)push('tags', node.tags);
  if(node.repeat){
    lines.push('repeat:');
    lines.push(`  type: ${node.repeat.type}`);
    if(node.repeat.type==='schedule'){
      const s=node.repeat;
      if(s.freq)lines.push(`  freq: ${s.freq}`);
      if(s.byweekday&&s.byweekday.length)lines.push(`  byweekday: [${s.byweekday.join(', ')}]`);
      if(s.bymonthday&&s.bymonthday.length)lines.push(`  bymonthday: [${s.bymonthday.join(', ')}]`);
      if(s.bysetpos!==undefined)lines.push(`  bysetpos: ${s.bysetpos}`);
      if(s.interval&&s.interval!==1)lines.push(`  interval: ${s.interval}`);
      if(s.end){
        lines.push(`  end:`);
        lines.push(`    type: ${s.end.type}`);
        if(s.end.date)lines.push(`    date: ${s.end.date}`);
        else if(s.end.time)lines.push(`    date: ${String(s.end.time).split('T')[0]}`);
        if(s.end.occurrences)lines.push(`    occurrences: ${s.end.occurrences}`);
      }
    } else if(node.repeat.type==='after_completion'){
      if(node.repeat.interval)lines.push(`  interval: ${node.repeat.interval}`);
    }
  }
  if(node.instances&&node.instances.length){
    lines.push('instances:');
    for(const inst of node.instances){
      if(!inst.date)continue;
      lines.push(`  - date: ${inst.date}`);
      if(inst.time)lines.push(`    time: "${inst.time}"`);
      if(inst.timezone)lines.push(`    timezone: ${inst.timezone}`);
      if(inst.done!==undefined)lines.push(`    done: ${inst.done}`);
      if(inst.priority)lines.push(`    priority: ${inst.priority}`);
      if(inst.excluded)lines.push(`    excluded: true`);
      if(inst.title)lines.push(`    title: ${yamlSerializeScalar(inst.title)}`);
      if(inst.tags)lines.push(`    tags: ${yamlSerializeScalar(inst.tags)}`);
      if(inst.duration)lines.push(`    duration: ${inst.duration}`);
      if(inst.body)lines.push(`    body: ${yamlSerializeScalar(inst.body)}`);
    }
  }
  return `---\n${lines.join('\n')}\n---\n\n${node.body||''}`;
}

export function fileToNode(path, content){
  let fm={}, body='';
  const m=content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if(m){fm=yamlParse(m[1]);body=m[2].trim();}
  else if(path.endsWith('.md')){body=content.trim();}
  else{fm=yamlParse(content);}

  const node={};
  node.id=fm.id||path.replace(/\.(md|yaml|yml)$/,'');
  node.title=fm.title||node.id;

  if(fm.date){
    node.date=String(fm.date);
  } else if(fm.time){
    const unified=String(fm.time);
    const tMatch=unified.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
    if(tMatch){node.date=tMatch[1];if(tMatch[2])node.time=tMatch[2];}
    else node.date=unified;
  }
  if(fm.date&&fm.time!==undefined){
    if(typeof fm.time==='string'&&fm.time.match(/^\d{1,2}:\d{2}/)){
      node.time=fm.time.slice(0,5);
    } else if(typeof fm.time==='number'){
      const h=Math.floor(fm.time/60),mn=fm.time%60;
      node.time=String(h).padStart(2,'0')+':'+String(mn).padStart(2,'0');
    }
  }
  if(fm.timezone)node.timezone=String(fm.timezone);
  if(fm.duration)node.duration=String(fm.duration);
  if(fm.done!==undefined)node.done=fm.done;
  if(fm.priority)node.priority=String(fm.priority);
  if(fm.tags)node.tags=Array.isArray(fm.tags)?fm.tags:[String(fm.tags)];
  if(body)node.body=body;

  if(fm.repeat&&typeof fm.repeat==='object'){
    const r=fm.repeat;
    node.repeat={type:String(r.type)};
    if(r.type==='after_completion'){
      if(r.interval)node.repeat.interval=String(r.interval);
    } else if(r.type==='schedule'){
      if(r.freq)node.repeat.freq=String(r.freq);
      if(r.byweekday)node.repeat.byweekday=Array.isArray(r.byweekday)?r.byweekday.map(String):[String(r.byweekday)];
      if(r.bymonthday)node.repeat.bymonthday=Array.isArray(r.bymonthday)?r.bymonthday.map(Number):[Number(r.bymonthday)];
      if(r.bysetpos!==undefined)node.repeat.bysetpos=Number(r.bysetpos);
      if(r.interval)node.repeat.interval=Number(r.interval);
      if(r.end&&typeof r.end==='object'){
        const end={type:String(r.end.type)};
        if(r.end.date)end.date=String(r.end.date);
        else if(r.end.time)end.date=String(r.end.time).split('T')[0];
        if(r.end.occurrences)end.occurrences=Number(r.end.occurrences);
        node.repeat.end=end;
      }
    }
  }

  if(Array.isArray(fm.instances)){
    node.instances=fm.instances.map(inst=>{
      const r={};
      if(inst.date){
        r.date=String(inst.date);
      } else if(inst.time){
        const unified=String(inst.time);
        const tMatch=unified.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
        if(tMatch){r.date=tMatch[1];if(tMatch[2])r.time=tMatch[2];}
        else r.date=unified;
      }
      if(!r.date)return null;
      if(inst.date&&inst.time!==undefined){
        if(typeof inst.time==='string'&&inst.time.match(/^\d{1,2}:\d{2}/))r.time=inst.time.slice(0,5);
        else if(typeof inst.time==='number'){const h=Math.floor(inst.time/60),mn=inst.time%60;r.time=String(h).padStart(2,'0')+':'+String(mn).padStart(2,'0');}
      }
      if(inst.timezone)r.timezone=String(inst.timezone);
      if(inst.done!==undefined)r.done=inst.done;
      if(inst.priority)r.priority=String(inst.priority);
      if(inst.excluded)r.excluded=true;
      if(inst.title)r.title=String(inst.title);
      if(inst.tags)r.tags=Array.isArray(inst.tags)?inst.tags:[String(inst.tags)];
      if(inst.duration)r.duration=String(inst.duration);
      if(inst.body)r.body=String(inst.body);
      return r;
    }).filter(Boolean);
  }

  node.type=node.done!==undefined?'task':'event';
  node._path=path;
  return node;
}

export function titleToSlug(title){
  return (title||'untitled')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-|-$/g,'')
    .slice(0,60)||'untitled';
}
