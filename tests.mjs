import test from 'node:test';
import assert from 'node:assert/strict';
import { eventForTurn, waitingKinds, pushUrl, notificationText } from './core.mjs';
import { CodexConnection } from './transport.mjs';
import { recordEvent, RecordWatcher } from './records.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { taskContext, excerpt } from './context.mjs';
test('正式任务名与进展摘要，隐藏密钥且不发送原始命令',()=>{
  const c=taskContext({name:'实现 Codex 通知',preview:'first'},[{item:{type:'agentMessage',text:'正在验证推送。 api_key=secret123'}}]);
  assert.equal(c.taskName,'实现 Codex 通知');assert.ok(c.progress.includes('正在验证推送'));assert.ok(!c.progress.includes('secret123'));
  assert.ok(!taskContext({name:'t'},[{item:{type:'commandExecution',command:'secret command',status:'inProgress'}}]).progress.includes('secret command'));
  assert.equal(excerpt('a\nb'),'a b');
});
test('长摘要截在完整句子，短摘要保留并补充上一条进展',()=>{
  const sentence='已经完成这一项验证。';const text=sentence.repeat(50);
  const result=excerpt(text,180);assert.ok(result.endsWith('。'));assert.ok(result.length<=180);
  const c=taskContext({name:'任务'},[{turnId:'2',item:{type:'agentMessage',text:'检查完成。'}},{turnId:'1',item:{type:'agentMessage',text:'正在处理配置与推送内容。'}}]);
  assert.ok(c.progress.includes('上一步'));assert.equal(c.rounds.length,2);assert.equal(c.rounds[0].id,'1');
});
test('只把实际终态当作完成，启动前历史不推送',()=>{
  assert.equal(eventForTurn('t',{id:'1',status:'inProgress',completedAt:null},1000),null);
  assert.equal(eventForTurn('t',{id:'1',status:'completed',completedAt:1},2000),null);
  assert.equal(eventForTurn('t',{id:'1',status:'completed',completedAt:2},1000).kind,'completed');
  assert.equal(eventForTurn('t',{id:'1',status:'failed',completedAt:2},1000).kind,'failed');
  assert.equal(eventForTurn('t',{id:'1',status:'completed',completedAt:2},1000).key,eventForTurn('t',{id:'1',status:'completed',completedAt:2},1000).key);
});
test('只识别真实授权和等待用户状态',()=>{
  assert.deepEqual(waitingKinds({type:'active',activeFlags:['waitingOnApproval']}),['waitingOnApproval']);
  assert.deepEqual(waitingKinds({type:'active',activeFlags:[]}),[]);
  assert.deepEqual(waitingKinds({type:'idle'}),[]);
});
test('标题与正文逐段编码，日期不产生路径斜杠',()=>{
  const msg=notificationText({kind:'test',time:0});assert.ok(!msg.body.includes('/'));
  const url=pushUrl('https://api.chuckfang.com/example/','标题','正文 & ? #');
  assert.equal(new URL(url).pathname.split('/').length,4);
  assert.equal(decodeURIComponent(new URL(url).pathname.split('/')[3]),'正文 & ? #');
  assert.throws(()=>pushUrl('http://api.chuckfang.com/example/','a','b'));
});
test('正文路径、网址和反斜杠不会在服务解码后产生额外路径段',()=>{
  const url=pushUrl('https://api.chuckfang.com/example/','完成/授权','https://a.test/foo/bar C:\\work\\a 50%\n下一行');
  const decoded=decodeURIComponent(new URL(url).pathname);
  assert.equal(decoded.split('/').length,4);
  assert.ok(decoded.includes('https:／／a.test／foo／bar'));
  assert.ok(decoded.includes('C:＼work＼a'));
  assert.ok(!decoded.includes('\n'));
});
test('WebSocket 拆包、碎片和 ping；授权请求不发送回应',()=>{
  const c=new CodexConnection({});c.ready=true;let count=0;const replies=[];
  c.child={stdin:{write:b=>replies.push(b)}};
  c.on('notification',obj=>{assert.equal(obj.method,'item/commandExecution/requestApproval');count++;});
  const text=Buffer.from(JSON.stringify({id:7,method:'item/commandExecution/requestApproval',params:{}}));
  const frame=Buffer.concat([Buffer.from([129,text.length]),text]);
  c.receive(frame.subarray(0,1));c.receive(frame.subarray(1,9));c.receive(frame.subarray(9));
  assert.equal(count,1);assert.equal(replies.length,0);
  const half=Math.floor(text.length/2);
  c.receive(Buffer.concat([Buffer.from([1,half]),text.subarray(0,half)]));
  c.receive(Buffer.concat([Buffer.from([128,text.length-half]),text.subarray(half)]));
  assert.equal(count,2);c.receive(Buffer.from([137,0]));assert.equal(replies.length,1);assert.equal(replies[0][0]&15,10);
});
test('独立会话记录：旧事件不补发，拆开的新完成事件只读一次',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gpt-record-test-'));
  try{
    const date=new Date(),dir=path.join(root,'sessions',String(date.getUTCFullYear()),String(date.getUTCMonth()+1).padStart(2,'0'),String(date.getUTCDate()).padStart(2,'0'));
    await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'test.jsonl'),since=Date.now();
    const meta={type:'session_meta',payload:{id:'independent',source:'cli',cwd:'test'}};
    const old={type:'event_msg',timestamp:new Date(since-10000).toISOString(),payload:{type:'task_complete',turn_id:'old'}};
    await fs.writeFile(file,JSON.stringify(meta)+'\n'+JSON.stringify(old)+'\n');
    const watcher=new RecordWatcher(root,since);assert.deepEqual(await watcher.scan(),[]);
    const line=JSON.stringify({type:'event_msg',timestamp:new Date(since+100).toISOString(),payload:{type:'task_complete',turn_id:'new'}})+'\n';
    await fs.appendFile(file,line.slice(0,30));assert.deepEqual(await watcher.scan(),[]);
    await fs.appendFile(file,line.slice(30));const events=await watcher.scan();assert.equal(events.length,1);assert.equal(events[0].key,'turn:independent:new');
    assert.deepEqual(await watcher.scan(),[]);assert.equal(recordEvent({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'task_started'}},'t',since),null);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

import {decodeFrames,applyDsh,DshWatcher} from './dsh.mjs';
import {zstdCompressSync} from 'node:zlib';
import {startPushApi,normalizePush} from './接口.mjs';
test('DSH 多帧、断尾和真实终态；不发送推理或命令',()=>{
  const a=zstdCompressSync(Buffer.from(JSON.stringify({type:'session',id:'a',cwd:'test'})+'\n'));
  const b=zstdCompressSync(Buffer.from(JSON.stringify({type:'turn/start',time:2000,data:{turn:1}})+'\n'));
  assert.equal(decodeFrames(Buffer.concat([a,b])).rows.length,2);
  assert.equal(decodeFrames(Buffer.concat([a,b.subarray(0,8)])).consumed,a.length);
  const s={pending:new Set(),rounds:[]};applyDsh({type:'session',id:'a'},s,1000);
  assert.equal(applyDsh({type:'turn/end',time:500,data:{reason:{kind:'completed'}}},s,1000),null);
  applyDsh({type:'turn/start',time:2000,data:{turn:1}},s,1000);
  const wait=applyDsh({type:'approval/asked',seq:2,time:2000,data:{id:'req',toolName:'pwsh'}},s,1000);
  assert.equal(wait.kind,'waitingOnApproval');assert.deepEqual(s.status.activeFlags,['waitingOnApproval']);
  applyDsh({type:'approval/decided',data:{id:'req'}},s,1000);assert.deepEqual(s.status.activeFlags,[]);
  applyDsh({type:'assistant/message',seq:3,data:{message:{content:[{type:'reasoning',text:'private reasoning'},{type:'text',text:'检查完成。'},{type:'tool-call',arguments:'secret command'}]}}},s,1000);
  assert.equal(s.progress,'检查完成。');
  assert.equal(applyDsh({type:'turn/end',seq:4,time:2100,data:{reason:{kind:'completed'}}},s,1000).kind,'completed');
  assert.equal(s.status.type,'completed');assert.equal(applyDsh({type:'turn/end',seq:5,time:2200,data:{reason:{kind:'error'}}},s,1000).kind,'failed');
  assert.equal(applyDsh({type:'turn/end',seq:6,time:2300,data:{reason:{kind:'blocked'}}},s,1000),null);
});
test('DSH 实际目录布局增量读取，旧记录不补发且新事件只读一次',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-adapter-test-'));
  try{const dir=path.join(temp,'project','session-a');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'session.v4.jsonl.zstd'),since=Date.now();
    const frame=row=>zstdCompressSync(Buffer.from(JSON.stringify(row)+'\n'));
    await fs.writeFile(file,Buffer.concat([frame({type:'session',id:'a',cwd:temp}),frame({type:'turn/end',seq:1,time:since-1000,data:{reason:{kind:'completed'}}})]));
    const w=new DshWatcher(temp,since);assert.deepEqual(await w.scan(),[]);
    const next=frame({type:'turn/end',seq:2,time:since+100,data:{reason:{kind:'completed'}}});await fs.appendFile(file,next.subarray(0,8));assert.deepEqual(await w.scan(),[]);await fs.appendFile(file,next.subarray(8));assert.equal((await w.scan()).length,1);assert.deepEqual(await w.scan(),[]);assert.equal(w.sessions[0].status.type,'completed');
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('通用接口认证、跨站阻止、校验与重复 ID',async()=>{
  const seen=new Set(),events=[];let server;
  for(let port=17901;port<17920;port++){try{server=await startPushApi({port,token:'test-token-with-at-least-24-characters'},async e=>{if(seen.has(e.key))return false;seen.add(e.key);events.push(e);return true;});break;}catch(e){if(e.code!=='EADDRINUSE')throw e;}}
  assert.ok(server);const url='http://127.0.0.1:'+server.address().port+'/api/push';
  const headers={'Content-Type':'application/json',Authorization:'Bearer test-token-with-at-least-24-characters'};
  try{assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
    assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://example.com'},body:'{}'})).status,403);
    assert.equal((await fetch(url,{method:'POST',headers,body:'{}'})).status,400);
    const payload={title:'股价到达提醒条件',body:'示例价：100／股',source:'股价',id:'price-1',kind:'completed'};
    assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(payload)})).status,202);
    assert.equal((await (await fetch(url,{method:'POST',headers,body:JSON.stringify(payload)})).json()).duplicate,true);
    assert.equal(events.length,1);assert.equal(events[0].source,'股价');assert.ok(!notificationText(events[0]).title.includes('undefined'));
    assert.throws(()=>normalizePush({...payload,kind:'unknown'}));assert.throws(()=>normalizePush({...payload,body:'a'.repeat(4001)}));
  }finally{await new Promise(r=>{server.close(r);server.closeAllConnections();});}
});

import {pushAllowed,sourceGroup} from './policy.mjs';
test('五个 Codex 只静音一个；关闭 DSH 不影响 Codex/DIY',()=>{
  const policy={sources:{DSH:false},mutedTasks:['codex-2']};
  for(let i=0;i<5;i++)assert.equal(pushAllowed({threadId:'codex-'+i},policy),i!==2);
  assert.equal(pushAllowed({threadId:'dsh:a',source:'DSH'},policy),false);
  assert.equal(pushAllowed({threadId:'custom:price',source:'DSH'}, {sources:{DIY:false}}),false);
  assert.equal(pushAllowed({threadId:'custom:price',source:'股价'},policy),true);
  assert.equal(sourceGroup({threadId:'custom:price'}),'DIY');
  assert.equal(pushAllowed({threadId:'dsh:a'}, {sources:{DSH:true},mutedTasks:['dsh:a']}),false);
});
