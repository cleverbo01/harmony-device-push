export function excerpt(text,max=180){
  const clean=String(text||'').replace(/https?:\/\/\S+/g,'[链接]').replace(/\b(?:sk-|Bearer\s+)[\w.-]+/gi,'[已隐藏密钥]').replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi,'$1[已隐藏]').replace(/\s+/g,' ').trim();
  if(clean.length<=max)return clean;
  const range=clean.slice(0,max),ends=[...range.matchAll(/[。！？!?](?:[”’」』])?/g)];
  const last=ends.at(-1);
  if(last&&last.index>=Math.min(60,max/3))return range.slice(0,last.index+last[0].length);
  // Finish the first sentence when its terminator is close; never split mid-sentence silently.
  const next=clean.slice(max,Math.min(clean.length,max+100)).search(/[。！？!?]/);
  return next>=0?clean.slice(0,max+next+1):range+'…';
}
export function taskContext(thread,entries=[]){
  const items=entries.map(e=>e.item||e);
  const message=items.find(i=>i.type==='agentMessage'&&i.text);
  const command=items.find(i=>i.type==='commandExecution');
  const rounds=[];
  for(const entry of entries){const item=entry.item||entry;if(item.type!=='agentMessage'||!item.text)continue;const key=entry.turnId||item.id||'recent';if(rounds.some(r=>r.id===key))continue;rounds.push({id:key,time:entry.completedAtMs||entry.startedAtMs||null,text:excerpt(item.text,360)});if(rounds.length>=6)break;}
  let progress=message?excerpt(message.text,360):command?'当前步骤：执行命令（'+excerpt(command.status||'处理中',30)+'）':'尚未获取到当前步骤';
  if(message&&progress.length<70){const extra=items.find(i=>i!==message&&i.type==='agentMessage'&&i.text);if(extra)progress=excerpt(progress+' 上一步：'+extra.text,360);}
  return {taskName:excerpt(thread.name||thread.preview||'未命名任务',64),progress,rounds:rounds.reverse(),titleSource:thread.name?'Codex 任务名称':'首条任务描述'};
}
