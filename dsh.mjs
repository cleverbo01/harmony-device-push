import fs from 'node:fs/promises';
import path from 'node:path';
import {zstdDecompressSync} from 'node:zlib';
import {excerpt} from './context.mjs';
// Parse the public Zstandard frame/block layout before decoding: incomplete tails stay unread.
function frameEnd(b,start){
  let p=start;if(b.length-p<5)return null;
  if(b.readUInt32LE(p)!==0xfd2fb528)throw new Error('DSH Zstd 帧头损坏');p+=4;
  const d=b[p++];if(d&24)throw new Error('DSH Zstd 保留位无效');
  const single=!!(d&32),flag=d>>>6,dict=d&3;
  p+=(single?0:1)+(dict===3?4:dict)+(flag===0?(single?1:0):2**flag);
  if(p>b.length)return null;
  for(;;){if(p+3>b.length)return null;const h=b.readUIntLE(p,3);p+=3;const type=(h>>>1)&3;if(type===3)throw new Error('DSH Zstd 块损坏');p+=type===1?1:h>>>3;if(p>b.length)return null;if(h&1)break;}
  if(d&4)p+=4;return p<=b.length?p:null;
}
export function decodeFrames(buffer){
  const rows=[];let consumed=0;
  while(consumed<buffer.length){const end=frameEnd(buffer,consumed);if(end===null)break;
    const out=zstdDecompressSync(buffer.subarray(consumed,end),{maxOutputLength:32*1024*1024});
    rows.push(...out.toString('utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x)));consumed=end;
  }return {rows,consumed};
}
export function applyDsh(row,s,since){
  const d=row.data||{},time=Number(row.time)||0;let kind;
  if(row.type==='session'){s.id='dsh:'+row.id;s.cwd=row.cwd;s.taskName=s.taskName||'DSH 未命名任务';return null;}
  if(row.type==='session/title')s.taskName=excerpt(d.title,64);
  if(row.type==='turn/start'){s.status={type:'active',activeFlags:[]};s.turn=d.turn;s.pending=new Set();}
  if(row.type==='assistant/message'){
    const text=(d.message?.content||[]).filter(x=>x.type==='text').map(x=>x.text).join(' ');
    if(text){const summary=excerpt(text,360);s.progress=summary.length<70&&s.progress?excerpt(summary+' 上一步：'+s.progress,360):summary;s.rounds.push({id:row.seq,text:summary,time});s.rounds=s.rounds.slice(-12);}
  }
  if(row.type==='approval/asked'){s.pending.add(d.id);s.status={type:'active',activeFlags:['waitingOnApproval']};kind='waitingOnApproval';}
  if(row.type==='approval/decided'){s.pending.delete(d.id);s.status={type:'active',activeFlags:s.pending.size?['waitingOnApproval']:[]};}
  if(row.type==='turn/end'){
    s.pending.clear();kind={completed:'completed',error:'failed',aborted:'interrupted'}[d.reason?.kind];
    s.status={type:kind==='completed'?'completed':kind==='failed'?'systemError':kind==='interrupted'?'interrupted':'idle'};
  }
  return kind&&time>=since?{key:'dsh:'+s.id+':'+row.seq,threadId:s.id,source:'DSH',kind,time,taskName:s.taskName,progress:s.progress||(kind==='waitingOnApproval'?'等待授权工具：'+excerpt(d.toolName,80):'本轮结束状态：'+excerpt(d.reason?.kind,60))}:null;
}
export class DshWatcher{
  constructor(root,since){this.root=root;this.since=since;this.files=new Map();this.paths=[];this.discovered=0;}
  async scan(refresh=false){
    const events=[];
    if(refresh||Date.now()-this.discovered>30000){
      this.discovered=Date.now();this.paths=[];
      let projects;try{projects=await fs.readdir(this.root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}
      for(const p of projects.filter(x=>x.isDirectory()))for(const dir of await fs.readdir(path.join(this.root,p.name),{withFileTypes:true})){
        if(!dir.isDirectory())continue;const folder=path.join(this.root,p.name,dir.name);
        const files=(await fs.readdir(folder)).filter(x=>/^session.v[34].jsonl(?:.zstd)?$/.test(x)).sort((a,b)=>Number(b.match(/v(\d)/)[1])-Number(a.match(/v(\d)/)[1]));
        if(files[0]){const file=path.join(folder,files[0]),stat=await fs.stat(file);if(stat.mtimeMs>=this.since-86400000||this.files.has(file))this.paths.push(file);}
      }
    }
    for(const file of this.paths){
      const stat=await fs.stat(file);let s=this.files.get(file);
      if(!s||stat.size<s.offset){s={offset:0,stamp:0,pending:new Set(),rounds:[],source:'DSH',mode:'DeepSeek Harness · 日志授权和完成提醒',status:{type:'idle'}};this.files.set(file,s);}
      if(s.stamp===stat.mtimeMs&&s.offset===stat.size)continue;
      const h=await fs.open(file,'r');let data;try{data=Buffer.alloc(stat.size-s.offset);await h.read(data,0,data.length,s.offset);}finally{await h.close();}
      let parsed;if(file.endsWith('.zstd'))parsed=decodeFrames(data);else{const end=data.lastIndexOf(10)+1;parsed={rows:data.subarray(0,end).toString().split('\n').filter(Boolean).map(x=>JSON.parse(x)),consumed:end};}
      for(const row of parsed.rows){const e=applyDsh(row,s,this.since);if(e)events.push(e);}
      s.offset+=parsed.consumed;s.stamp=stat.mtimeMs;
    }return events;
  }
  get sessions(){return [...this.files.values()].filter(s=>s.id).map(({pending,offset,stamp,...s})=>s);}
}
