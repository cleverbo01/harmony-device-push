import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexConnection } from './transport.mjs';
import { eventForTurn, waitingKinds, notificationText, push, pushUrl } from './core.mjs';
import { RecordWatcher } from './records.mjs';
import { DshWatcher } from './dsh.mjs';
import { startPushApi } from './接口.mjs';
import os from 'node:os';
import { taskContext } from './context.mjs';
import { discoverCodex } from './discovery.mjs';
import { pushAllowed,sourceGroup } from './policy.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
let config=JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8'));
if(!config.pushBaseUrl)throw new Error('请先在窗口填写 MeoW 设备 ID');
pushUrl(config.pushBaseUrl,'测试','测试');
config.nodePath=process.execPath;
config.pollSeconds=config.pollSeconds||8;
config.sourceKinds=config.sourceKinds||['cli','vscode','exec','appServer'];
let configStamp=(await fs.stat(path.join(root,'config.json'))).mtimeMs;
async function reloadPushConfig(){const file=path.join(root,'config.json'),stamp=(await fs.stat(file)).mtimeMs;if(stamp===configStamp)return;const next=JSON.parse(await fs.readFile(file,'utf8'));pushUrl(next.pushBaseUrl,'检查','检查');config.pushBaseUrl=next.pushBaseUrl;config.pushPolicy=next.pushPolicy;configStamp=stamp;}
const statePath=path.join(root,'运行记录','state.json');
const stopPath=path.join(root,'运行记录','stop.request');
await fs.mkdir(path.dirname(statePath),{recursive:true});
let state={sent:[],queue:[]};
try {state=JSON.parse(await fs.readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('运行状态文件损坏，请备份后检查 state.json');}
const dryRun=process.argv.includes('--dry-run');
const sent=new Set(state.sent),waits=new Map(),labels=new Map();
const contexts=new Map(), contextTimes=new Map();
let lastProcessScan=0,lastHistoryScan=0,cachedHistory=[],lastReport="",wakeScan=null;
const watcher=new RecordWatcher(config.codexHome||process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),Date.now());
const dshWatcher=new DshWatcher(config.dshSessionsPath||path.join(os.homedir(),'.dsh','sessions'),Date.now());
const customSessions=new Map();
const receipts=new Map();
try{for(const line of (await fs.readFile(path.join(root,'运行记录','push-history.jsonl'),'utf8')).split('\n').filter(Boolean)){try{const r=JSON.parse(line);if(r.status==='sent'){r.sentAt=r.sentAt||r.time;receipts.set(r.threadId||'name:'+r.taskName,r);}}catch{}}}catch{}
let apiServer,discovery={candidates:[],processes:[]},candidateIndex=0;
const policy=()=>config.pushPolicy||{};
let runtime={connected:false,sessions:[],queue:state.queue.length,lastScan:null,error:null};
async function report(){const content=JSON.stringify({...runtime,sessions:runtime.sessions.map(s=>({...s,pushEnabled:pushAllowed(s,policy()),lastPush:receipts.get(s.id)||receipts.get('name:'+s.taskName)||null})),lastScan:undefined,pid:process.pid,queue:state.queue.length});if(content===lastReport)return;lastReport=content;const file=path.join(root,'运行记录','status.json');await fs.writeFile(file+'.tmp',content);await fs.rename(file+'.tmp',file);}
let connection,stopping=false,since=Date.now(),lastError='',draining=false,saveChain=Promise.resolve();
if(!Number.isFinite(config.pollSeconds)||config.pollSeconds<1)throw new Error('pollSeconds 必须至少为 1 秒');
const log=async text=>{
  const line=new Date().toLocaleString('zh-CN')+' '+text;
  console.log(line);await fs.appendFile(path.join(root,'运行记录','events.log'),line+'\n').catch(()=>{});
};
const save=()=>{
  const snapshot=JSON.stringify({sent:[...sent].slice(-20000),queue:state.queue},null,2);
  const operation=saveChain.then(async()=>{const tmp=statePath+'.tmp';await fs.writeFile(tmp,snapshot);await fs.rename(tmp,statePath);});
  saveChain=operation.catch(()=>{});return operation;
};
function label(id){if(!labels.has(id))labels.set(id,String(labels.size+1));return labels.get(id);}
let enqueueChain=Promise.resolve();
function enqueue(event){const operation=enqueueChain.then(()=>enqueueOne(event));enqueueChain=operation.catch(()=>{});return operation;}
async function enqueueOne(event){
  if(!event||sent.has(event.key)||state.queue.some(e=>e.key===event.key))return false;
  const context=event.source?{}:contexts.get(event.threadId)||{};event.taskName=context.taskName||event.taskName;event.progress=event.progress||context.progress;
  if(String(event.threadId).startsWith('custom:')){const old=customSessions.get(event.threadId);customSessions.set(event.threadId,{id:event.threadId,taskName:event.taskName,source:event.source,mode:'通用接口 · '+event.source,cwd:'本机接口',status:{type:{info:'idle',active:'active',completed:'completed',failed:'systemError',interrupted:'interrupted',waitingOnApproval:'active'}[event.kind],activeFlags:event.kind==='waitingOnApproval'?['waitingOnApproval']:[]},progress:event.progress,rounds:[...(old?.rounds||[]),{id:event.key,time:event.time,text:event.progress}].slice(-12)});if(customSessions.size>100)customSessions.delete(customSessions.keys().next().value);wakeScan?.();}
  if(!pushAllowed(event,policy())){sent.add(event.key);await save();await log('已静音，跳过推送：'+(event.taskName||event.threadId));return {accepted:false,muted:true};}
  event.label=event.taskName||label(event.threadId);state.queue.push({...event,attempts:0,nextTry:0});
  await fs.appendFile(path.join(root,'运行记录','push-history.jsonl'),JSON.stringify({key:event.key,taskName:event.taskName||event.label,kind:event.kind,threadId:event.threadId,sentAt:Date.now(),time:event.time,text:event.progress||notificationText(event).body,status:'queued'})+'\n');
  await save();await log('检测到：'+notificationText(event).title+'（会话 '+event.label+'）');return true;
}
async function drain(){
  if(draining)return;draining=true;
  try {
    for(const event of [...state.queue]){
      if(stopping)continue;
      await reloadPushConfig();
      if(!pushAllowed(event,policy())){state.queue=state.queue.filter(e=>e.key!==event.key);sent.add(event.key);await save();await log('已静音，取消待发送通知：'+(event.taskName||event.threadId));continue;}
      if(event.nextTry>Date.now())continue;
      try {
        if(dryRun)await log('演练发送（未请求手机服务）：'+notificationText(event).title);else await push(config,event);sent.add(event.key);state.queue=state.queue.filter(e=>e.key!==event.key);
        await fs.appendFile(path.join(root,'运行记录','push-history.jsonl'),JSON.stringify({key:event.key,taskName:event.taskName||event.label,kind:event.kind,time:event.time,text:event.progress||notificationText(event).body,status:'sent'})+'\n');
        if(!dryRun)receipts.set(event.threadId,{threadId:event.threadId,text:event.progress||notificationText(event).body,sentAt:Date.now(),kind:event.kind});
        await log((dryRun?'演练处理完成：':'推送服务已接收：')+notificationText(event).title);
      }catch(e){
        event.attempts++;event.nextTry=Date.now()+Math.min(300000,5000*2**Math.min(event.attempts,6));
        await log(e.message+'；将自动重试（第 '+event.attempts+' 次失败）');
      }
      await save();
    }
  } finally {draining=false;}
}
async function getThreads(){
  const threads=new Map();let cursor=null;
  do{
    const r=await connection.request('thread/loaded/list',{cursor,limit:100});
    for(const id of r.data){const t=(await connection.request('thread/read',{threadId:id,includeTurns:false})).thread;threads.set(id,t);}
    cursor=r.nextCursor;
  }while(cursor&&!stopping);
  // Completed threads may have been unloaded before the next poll.
  if(Date.now()-lastHistoryScan<30000){for(const t of cachedHistory)if(!threads.has(t.id))threads.set(t.id,t);return [...threads.values()].filter(t=>config.sourceKinds.includes(t.source)&&!t.parentThreadId);}
  lastHistoryScan=Date.now();cachedHistory=[];cursor=null;
  do{
    const r=await connection.request('thread/list',{cursor,limit:100,sortKey:'updated_at',sortDirection:'desc',sourceKinds:config.sourceKinds,useStateDbOnly:true});
    for(const t of r.data)if(t.updatedAt*1000>=since-5000){cachedHistory.push({...t,status:{type:"notLoaded"}});if(!threads.has(t.id))threads.set(t.id,{...t,status:{type:"notLoaded"}});}
    if(r.data.length && r.data.at(-1).updatedAt*1000<since-5000)break;
    cursor=r.nextCursor;
  }while(cursor&&!stopping);
  return [...threads.values()].filter(t=>config.sourceKinds.includes(t.source)&&!t.parentThreadId);
}
async function scan(){
  const threads=await getThreads(),currentIds=new Set(threads.map(t=>t.id));
  runtime.sessions=[];
  for(const id of waits.keys())if(!currentIds.has(id))waits.delete(id);
  for(const t of threads){
    let context=contexts.get(t.id);
    const signature=JSON.stringify(t.status);
    if(!context||Date.now()-(contextTimes.get(t.id)?.time||0)>30000||contextTimes.get(t.id)?.status!==signature){
      let entries=[];try{entries=(await connection.request('thread/items/list',{threadId:t.id,limit:20,sortDirection:'desc'})).data;}catch{}
      context=taskContext(t,entries);contexts.set(t.id,context);contextTimes.set(t.id,{time:Date.now(),status:signature});
    }
    if(t.status.type!=='notLoaded')runtime.sessions.push({id:t.id,source:t.source,cwd:t.cwd,status:t.status.type==='idle'?{type:'idle'}:t.status,current:true,mode:'共享后台 · 授权和完成提醒',...context});
    const previous=waits.get(t.id)||new Map(),active=waitingKinds(t.status);
    for(const kind of active)if(!previous.has(kind)){
      const time=Date.now();previous.set(kind,time);
      await enqueue({key:`wait:${t.id}:${kind}:${time}`,kind,threadId:t.id,time});
    }
    for(const kind of previous.keys())if(!active.includes(kind))previous.delete(kind);
    waits.set(t.id,previous);
    let cursor=null;
    do{
      const r=await connection.request('thread/turns/list',{threadId:t.id,cursor,limit:20,sortDirection:'desc',itemsView:'summary'});
      for(const turn of r.data){await enqueue(eventForTurn(t.id,turn,since));if(!cursor&&r.data[0]===turn&&t.status.type==='idle'){const row=runtime.sessions.find(x=>x.id===t.id);if(row&&['completed','failed','interrupted'].includes(turn.status))row.status={type:{completed:'completed',failed:'systemError',interrupted:'interrupted'}[turn.status]};}}
      if(r.data.some(turn=>(turn.completedAt||turn.startedAt||0)*1000<since))break;
      cursor=r.nextCursor;
    }while(cursor&&!stopping);
  }
}
async function main(){
  if(process.argv.includes('--stop')){await fs.writeFile(stopPath,'stop');console.log('已请求停止提醒器，将在当前检测或推送请求结束后退出。');return;}
  if(process.argv.includes('--test-push')){
    const result=await push(config,{kind:'test',time:Date.now()});
    console.log('测试通知已提交推送服务。');return;
  }
  if(process.argv.includes('--check')){
    const found=await discoverCodex(config);connection=await new CodexConnection({...config,...found.candidates[0]}).connect();
    try{const threads=await getThreads();console.log('连接成功；可监控会话数：'+threads.length);for(const t of threads)await connection.request('thread/turns/list',{threadId:t.id,limit:1,itemsView:'summary'});console.log('状态与完成记录接口验证通过。');}finally{connection.close();}return;
  }
  let lock;
  try{lock=await fs.open(path.join(root,'运行记录','monitor.lock'),'wx');await lock.writeFile(String(process.pid));}
  catch(e){
    if(e.code!=='EEXIST')throw e;
    const pid=Number(await fs.readFile(path.join(root,'运行记录','monitor.lock'),'utf8'));
    try{process.kill(pid,0);throw new Error('提醒器已在运行，请先关闭原窗口。');}catch(e){if(e.code!=='ESRCH')throw e;}
    await fs.unlink(path.join(root,'运行记录','monitor.lock'));return main();
  }
  const stop=()=>{stopping=true;connection?.close();};
  await fs.unlink(stopPath).catch(e=>{if(e.code!=='ENOENT')throw e;});
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  await log('鸿蒙设备信息推送工具已启动；每 '+config.pollSeconds+' 秒检测；Ctrl+C 停止。');
  await log('自动监控共享服务，并读取本地会话记录补充独立会话完成提醒。');
  const retryTimer=setInterval(()=>drain().catch(e=>log(e.message)),2000);
  try{
    if(config.localApi?.enabled){try{apiServer=await startPushApi(config.localApi,enqueue);runtime.api='http://127.0.0.1:'+config.localApi.port+'/api/push';await log('通用推送接口已启动：'+runtime.api);}catch(e){runtime.apiError=e.message;await log('通用接口异常：'+e.message);}}
    while(!stopping){
      try{await reloadPushConfig();}catch(e){await log("推送设置读取失败，保留原地址："+e.message);}
      const refreshPath=path.join(root,'运行记录','refresh.request');if(await fs.stat(refreshPath).then(()=>true).catch(()=>false)){lastProcessScan=0;lastHistoryScan=0;contextTimes.clear();dshWatcher.discovered=0;await fs.unlink(refreshPath).catch(()=>{});}
      if(await fs.stat(stopPath).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;})){stop();break;}
      let recordEvents=[];
      try{
        recordEvents=await watcher.scan();
      }catch(e){await log('本地记录检测失败：'+e.message);}
      if(Date.now()-lastProcessScan>=30000){lastProcessScan=Date.now();discovery=await discoverCodex(config);runtime.processes=discovery.processes;runtime.detected=discovery.candidates.map(c=>c.label);}
      try{
        if(!connection||connection.closed){
          if(config.codexConnect===false)throw new Error('Codex 服务连接已关闭，仍检测本地记录');
          const candidate=discovery.candidates[candidateIndex%Math.max(1,discovery.candidates.length)];candidateIndex++;
          connection=new CodexConnection({...config,...candidate});
          connection.on('notification',obj=>{if(['thread/status/changed','thread/started','turn/completed','thread/closed'].includes(obj.method)){lastHistoryScan=0;const id=obj.params?.threadId||obj.params?.thread?.id;if(id)contextTimes.delete(id);wakeScan?.();}});
          await connection.connect();
          await log('Codex 连接成功，正在监控授权与任务完成。');
        }
        await scan();lastError='';await drain();
        runtime.connected=true;runtime.error=null;
      }catch(e){
        if(stopping)break;
        if(lastError!==e.message){await log(e.message+'；请确保 Codex CLI 已启动，将自动重连。');lastError=e.message;}
        connection?.close();connection=null;
        runtime.connected=false;runtime.error=e.message;runtime.sessions=[];
      }
      if(config.dshEnabled!==false){try{for(const event of await dshWatcher.scan())await enqueue(event);runtime.dshError=null;}catch(e){runtime.dshError=e.message;await log('DSH 日志异常：'+e.message);}}
      runtime.sessions.push(...dshWatcher.sessions,...customSessions.values());
      for(const event of recordEvents){
        if(!contexts.has(event.threadId)&&connection&&!connection.closed){try{const t=(await connection.request('thread/read',{threadId:event.threadId,includeTurns:false})).thread;contexts.set(event.threadId,taskContext(t));}catch{}}
        await enqueue(event);
      }
      for(const row of watcher.sessions)if(!runtime.sessions.some(s=>s.id===row.id))runtime.sessions.push({...row,current:false,mode:row.mode+' · 历史记录'});
      runtime.refreshInfo="状态 8 秒兜底 · 进展/进程 30 秒 · 变化时重绘";runtime.lastScan=Date.now();await report();
      await new Promise(resolve=>{const end=()=>{wakeScan=null;clearTimeout(timer);process.removeListener('SIGINT',end);process.removeListener('SIGTERM',end);resolve();};const timer=setTimeout(end,config.pollSeconds*1000);wakeScan=end;process.once('SIGINT',end);process.once('SIGTERM',end);});
    }
  }finally{
    clearInterval(retryTimer);if(apiServer)await new Promise(r=>{apiServer.close(r);apiServer.closeAllConnections();});await enqueueChain;connection?.close();while(draining)await new Promise(r=>setTimeout(r,50));await saveChain;await lock.close();await fs.unlink(path.join(root,'运行记录','monitor.lock')).catch(()=>{});await fs.unlink(stopPath).catch(()=>{});runtime.connected=false;runtime.stopped=true;await report();await log('提醒器已停止。');
  }
}
main().catch(async e=>{console.error(e.message);await fs.writeFile(path.join(root,'运行记录','startup-error.log'),new Date().toISOString()+' '+e.stack).catch(()=>{});process.exitCode=1;});
