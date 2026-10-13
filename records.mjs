import fs from 'node:fs/promises';
import path from 'node:path';
import { excerpt } from './context.mjs';

export function recordEvent(obj,threadId,since){
  const p=obj.payload,time=Date.parse(obj.timestamp);
  if(obj.type!=='event_msg'||!Number.isFinite(time)||time<since)return null;
  const kind={task_complete:'completed',turn_aborted:'interrupted'}[p?.type];
  if(!kind)return null;
  return {key:p.turn_id?`turn:${threadId}:${p.turn_id}`:`record:${threadId}:${time}:${kind}`,kind,threadId,time,progress:excerpt(p.last_agent_message,360)||undefined};
}
export class RecordWatcher {
  constructor(home,since){this.home=home;this.since=since;this.files=new Map();this.sessions=[];this.discovered=0;this.paths=[];}
  async scan(){
    const events=[],sessions=[];
    const files=[];
    const walk=async dir=>{for(const e of await fs.readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})){const f=path.join(dir,e.name);if(e.isDirectory())await walk(f);else if(e.name.endsWith('.jsonl'))files.push(f);}};
    if(Date.now()-this.discovered>30000){
      this.discovered=Date.now();await walk(path.join(this.home,'sessions'));
      this.paths=[];for(const file of files){const s=await fs.stat(file);if(s.mtimeMs>=this.since-86400000||this.files.has(file))this.paths.push(file);}
    }
    for(const file of this.paths){
      const stat=await fs.stat(file);let state=this.files.get(file);
      if(!state||stat.size<state.offset){
        const h=await fs.open(file,'r');let first;
        try{const b=Buffer.alloc(65536);const r=await h.read(b,0,b.length,0);first=JSON.parse(b.subarray(0,r.bytesRead).toString().split('\n')[0]);}catch{continue;}finally{await h.close();}
        if(first.type!=='session_meta'||!first.payload?.id)continue;
        const m=first.payload;state={offset:0,carry:Buffer.alloc(0),id:m.id,source:m.source,cwd:m.cwd};this.files.set(file,state);
      }
      
      if(stat.size>state.offset){
        const h=await fs.open(file,'r');
        try{
          while(state.offset<stat.size){
            const b=Buffer.alloc(Math.min(256*1024,stat.size-state.offset));const r=await h.read(b,0,b.length,state.offset);if(!r.bytesRead)break;state.offset+=r.bytesRead;
            const data=Buffer.concat([state.carry,b.subarray(0,r.bytesRead)]);let start=0,index;
            while((index=data.indexOf(10,start))>=0){try{
              const obj=JSON.parse(data.subarray(start,index).toString());
              if(obj.type==='event_msg'){const p=obj.payload||{};if(p.type==='task_started')state.status={type:'active'};if(p.type==='task_complete')state.status={type:'completed'};if(p.type==='turn_aborted')state.status={type:'interrupted'};if(p.last_agent_message)state.progress=excerpt(p.last_agent_message,360);}
              if(obj.type==='response_item'&&obj.payload?.type==='message'&&obj.payload.role==='assistant'){const text=(obj.payload.content||[]).filter(c=>c.type==='output_text'||c.type==='text').map(c=>c.text||'').join(' ');if(text)state.progress=excerpt(text,360);}
              if(!state.taskName&&obj.type==='response_item'&&obj.payload?.type==='message'&&obj.payload.role==='user'){
                const text=(obj.payload.content||[]).map(c=>c.text||'').join(' ');
                if(text&&!/^(# AGENTS|<environment_context>|<INSTRUCTIONS>)/.test(text))state.taskName=excerpt(text,64);
              }
              const event=recordEvent(obj,state.id,this.since);
              if(event&&!String(state.source).includes('subagent')){event.taskName=state.taskName;events.push(event);}
            }catch{}start=index+1;}
            state.carry=data.subarray(start);if(state.carry.length>16*1024*1024)throw new Error('会话记录单行过大');
          }
        }finally{await h.close();}
      }
      if(!String(state.source).includes('subagent'))sessions.push({id:state.id,source:state.source,group:'Codex',cwd:state.cwd,taskName:state.taskName||'Codex 未命名任务',progress:state.progress||'等待新的公开任务信息',status:state.status||{type:'idle'},updatedAt:stat.mtimeMs,mode:'Codex CLI / 桌面版 · 本地完成记录（授权未接入）'});
    }
    this.sessions=sessions.sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,30);return events;
  }
}
