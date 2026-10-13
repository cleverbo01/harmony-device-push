import https from 'node:https';

export function eventForTurn(threadId, turn, since) {
  if (!turn.completedAt || turn.completedAt * 1000 < since) return null;
  const kind = {completed:'completed',failed:'failed',interrupted:'interrupted'}[turn.status];
  return kind ? {key:`turn:${threadId}:${turn.id}`,kind,threadId,time:turn.completedAt*1000} : null;
}
export function waitingKinds(status) {
  return status?.type==='active' ? (status.activeFlags||[]).filter(x=>['waitingOnApproval','waitingOnUserInput'].includes(x)) : [];
}
export function notificationText(event) {
  const titles={completed:'Codex 任务完成',failed:'Codex 任务失败',interrupted:'Codex 任务已中断',waitingOnApproval:'Codex 需要授权',waitingOnUserInput:'Codex 等待你的答复',test:'Codex 推送测试'};
  const bodies={completed:'本轮任务已完成，请回到电脑查看结果。',failed:'本轮任务失败，请回到电脑查看原因。',interrupted:'本轮任务已中断。',waitingOnApproval:'任务正在等待授权，请回到 Codex CLI 确认。',waitingOnUserInput:'任务正在等待你的答复，请回到 Codex CLI 查看。',test:'鸿蒙设备信息推送工具链路测试。'};
  const date=new Date(event.time);
  const time=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')+' '+[date.getHours(),date.getMinutes(),date.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':');
  const name=event.taskName||event.label;
  const source=event.source||'Codex'; const title=event.title||(titles[event.kind]||'信息通知').replace(/^Codex/,source);
  return {title:title+(name&&name!==title?' · '+name:''),body:(event.progress||bodies[event.kind]||'新通知')+' 时间：'+time};
}
export function safeSegment(text) {
  // Some gateways decode %2F before routing; encodeURIComponent alone is insufficient.
  return String(text).replace(/\//g,'／').replace(/\\/g,'＼').replace(/[\r\n\t]+/g,' ').replace(/[\x00-\x1f\x7f]/g,'');
}
export function pushUrl(base,title,body) {
  const url=new URL(base);
  if(url.protocol!=='https:'||url.hostname!=='api.chuckfang.com'||!/^\/[a-zA-Z0-9]+\/?$/.test(url.pathname)||url.search||url.hash)throw new Error('推送地址必须是 https://api.chuckfang.com/设备ID/');
  return url.href.replace(/\/$/,'')+'/'+encodeURIComponent(safeSegment(title))+'/'+encodeURIComponent(safeSegment(body));
}
export function push(config,event) {
  const {title,body}=notificationText(event),url=pushUrl(config.pushBaseUrl,title,body);
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{timeout:10000},res=>{
      let data='';res.setEncoding('utf8');
      res.on('data',s=>{data+=s;if(data.length>65536)res.destroy(new Error('推送服务响应过大'));});
      res.on('error',()=>reject(new Error('推送服务响应中断')));
      res.on('end',()=>{
        if(res.statusCode<200||res.statusCode>=300)return reject(new Error('推送服务 HTTP '+res.statusCode));
        let obj;try{obj=JSON.parse(data);}catch{}
        if(obj && (obj.success===false || obj.data===false || (obj.status!==undefined && ![200,'200'].includes(obj.status)) || (obj.code!==undefined && ![0,200,'0','200'].includes(obj.code))))return reject(new Error('推送服务报告失败'));
        if(/"(?:error|fail)"\s*:|推送失败|发送失败/i.test(data))return reject(new Error('推送服务报告失败'));
        resolve({status:res.statusCode,response:data.slice(0,500)});
      });
    });
    req.on('timeout',()=>req.destroy());req.on('error',()=>reject(new Error('推送网络连接失败或超时')));
  });
}
