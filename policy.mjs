export function sourceGroup(event){
  if(event.group)return event.group;
  if(String(event.threadId||event.id).startsWith('custom:'))return 'DIY';
  if(event.source==='DSH'||String(event.threadId||event.id).startsWith('dsh:'))return 'DSH';
  return 'Codex';
}
export function pushAllowed(event,policy={}){
  const id=event.threadId||event.id;
  return policy.sources?.[sourceGroup(event)]!==false && !(policy.mutedTasks||[]).includes(id);
}
