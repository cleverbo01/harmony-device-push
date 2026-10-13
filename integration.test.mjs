import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

test('无 Codex 时接口可用；取消排队、静音和恢复不补推',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'harmony-integration-'));
  let child;
  const wait=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw new Error('条件等待超时');};
  try{
    for(const file of ['notifier.mjs','transport.mjs','records.mjs','core.mjs','context.mjs','dsh.mjs','接口.mjs','policy.mjs','discovery.mjs'])await fs.copyFile(new URL(file,import.meta.url),path.join(dir,file));
    await fs.mkdir(path.join(dir,'运行记录'));
    const config={pushBaseUrl:'https://api.chuckfang.com/integration/',pollSeconds:1,codexConnect:false,codexHome:path.join(dir,'empty'),dshSessionsPath:path.join(dir,'empty'),localApi:{enabled:true,port:17927,token:'integration-token-at-least-24-characters'},pushPolicy:{sources:{DIY:false},mutedTasks:[]}};
    const configFile=path.join(dir,'config.json');await fs.writeFile(configFile,JSON.stringify(config));
    await fs.writeFile(path.join(dir,'运行记录','state.json'),JSON.stringify({sent:[],queue:[{key:'custom:price:queued',threadId:'custom:price',source:'股价',kind:'info',time:Date.now(),taskName:'排队样例',progress:'样例正文',attempts:0,nextTry:Date.now()+60000}]}));
    child=spawn(process.execPath,[path.join(dir,'notifier.mjs'),'--dry-run'],{windowsHide:true,stdio:'ignore'});
    const state=async()=>JSON.parse(await fs.readFile(path.join(dir,'运行记录','state.json')));
    await wait(async()=>{try{return (await state()).sent.includes('custom:price:queued');}catch{return false;}});
    assert.equal((await state()).queue.length,0);
    const submit=async id=>(await fetch('http://127.0.0.1:17927/api/push',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.localApi.token},body:JSON.stringify({source:'股价',id,title:'示例股价',body:'样例通知'})})).json();
    assert.equal((await submit('muted')).muted,true);
    config.pushPolicy.sources.DIY=true;await fs.writeFile(configFile,JSON.stringify(config));
    await wait(async()=>{const status=JSON.parse(await fs.readFile(path.join(dir,'运行记录','status.json')));return status.sessions.some(x=>x.id==='custom:股价'&&x.pushEnabled===true);});
    assert.equal((await submit('muted')).duplicate,true);
    assert.equal((await submit('new')).accepted,true);
    await wait(async()=>(await state()).sent.includes('custom:股价:new'));
    const log=await fs.readFile(path.join(dir,'运行记录','events.log'),'utf8');
    assert.ok(log.includes('取消待发送'));assert.ok(log.includes('演练发送'));assert.ok(!log.includes('推送网络连接失败'));
    await fs.writeFile(path.join(dir,'运行记录','stop.request'),'stop');
    await wait(async()=>child.exitCode!==null);assert.equal(child.exitCode,0);
  }finally{
    if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
    await fs.rm(dir,{recursive:true,force:true});
  }
});
