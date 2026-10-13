import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';

const exists=async p=>!!p&&await fs.stat(p).then(s=>s.isFile()).catch(()=>false);
export async function discoverCodex(config={},env=process.env,home=os.homedir()){
  const candidates=[];
  if(config.codexExecutable)candidates.push({codexExecutable:config.codexExecutable,label:'指定程序'});
  if(config.codexEntry)candidates.push({codexEntry:config.codexEntry,label:'指定 CLI'});
  // Running executables can live anywhere, including desktop app private installations.
  const processes=await new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-Command',"Get-CimInstance Win32_Process -Filter \"Name='codex.exe'\" | Where-Object { $_.CommandLine -notmatch ' sandbox |pid-update-loop|app-server proxy' } | ForEach-Object { [PSCustomObject]@{path=$_.ExecutablePath;kind=if($_.CommandLine -match '--no-daemon'){'independent'}elseif($_.CommandLine -match 'stdio://'){'desktop'}elseif($_.CommandLine -match 'app-server'){'server'}else{'cli'};pid=$_.ProcessId} } | ConvertTo-Json -Compress"],{windowsHide:true,timeout:6000,maxBuffer:65536},(e,out)=>{try{const p=JSON.parse(out);resolve(Array.isArray(p)?p:[p]);}catch{resolve([]);}}));
  for(const p of processes.filter(p=>p.kind==='server'))candidates.push({codexExecutable:p.path,label:'运行中的共享服务'});
  const dirs=[...(env.PATH||'').split(path.delimiter),path.join(env.APPDATA||path.join(home,'AppData','Roaming'),'npm')];
  for(const dir of dirs.filter(Boolean)){
    candidates.push({codexExecutable:path.join(dir,'codex.exe'),label:'PATH'});
    candidates.push({codexEntry:path.join(dir,'node_modules','@openai','codex','bin','codex.js'),label:'npm CLI'});
  }
  const homeRoot=env.CODEX_HOME||path.join(home,'.codex');
  for(const [folder,tail,label] of [[path.join(homeRoot,'packages','app-server-daemon','releases'),['bin','codex.exe'],'本机共享服务'],[path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'OpenAI','Codex','bin'),['codex.exe'],'Codex 桌面版']]){
    const entries=await fs.readdir(folder,{withFileTypes:true}).catch(()=>[]);
    const sorted=await Promise.all(entries.filter(x=>x.isDirectory()).map(async x=>({file:path.join(folder,x.name,...tail),time:(await fs.stat(path.join(folder,x.name))).mtimeMs})));
    for(const x of sorted.sort((a,b)=>b.time-a.time))candidates.push({codexExecutable:x.file,label});
  }
  for(const p of processes)candidates.push({codexExecutable:p.path,label:p.kind==='desktop'?'Codex 桌面版':'运行中的 CLI'});
  const usable=[];const seen=new Set();
  for(const c of candidates){const file=c.codexExecutable||c.codexEntry;if(!seen.has(file)&&await exists(file)){seen.add(file);usable.push(c);}}
  return {candidates:usable,processes:processes.map(({path,...p})=>p),codexHome:homeRoot};
}
