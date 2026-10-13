import http from 'node:http';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {excerpt} from './context.mjs';
export function normalizePush(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('正文必须是 JSON 对象');
  for(const [key,max] of [['title',120],['body',4000],['source',64],['id',128]])if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>max))throw new Error(key+' 格式或长度错误');
  if(!value.title?.trim()||!value.body?.trim())throw new Error('title 和 body 必填');
  const kind=value.kind||'info';if(!['info','active','completed','failed','waitingOnApproval','interrupted'].includes(kind))throw new Error('kind 不支持');
  const source=value.source?.trim()||'自定义';
  return {key:'custom:'+source+':'+(value.id||randomUUID()),threadId:'custom:'+source,source,kind,title:excerpt(value.title,120),taskName:excerpt(value.title,64),progress:excerpt(value.body,600),time:Date.now()};
}
export async function startPushApi(options,enqueue){
  const token=options.token;if(typeof token!=='string'||token.length<24)throw new Error('本地接口 token 至少 24 位');
  const port=options.port||17863;if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('本地接口端口无效');
  const server=http.createServer(async(req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    if(req.headers.origin)return send(403,{error:'不允许浏览器跨站请求'});
    const auth=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
    if(auth.length!==expected.length||!timingSafeEqual(auth,expected))return send(401,{error:'需要有效 Bearer token'});
    if(req.method==='GET'&&req.url==='/api/health')return send(200,{ok:true});
    if(req.method!=='POST'||req.url!=='/api/push')return send(404,{error:'接口不存在'});
    if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'请发送 application/json'});
    try{
      const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>16384){send(413,{error:'正文最大 16KB'});req.destroy();return;}chunks.push(c);}
      const event=normalizePush(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const result=await enqueue(event);send(202,{accepted:typeof result==='object'?result.accepted:result!==false,duplicate:result===false,muted:result?.muted===true,id:event.key});
    }catch(e){send(400,{error:e instanceof SyntaxError?'无效 JSON':e.message});}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.maxConnections=32;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return server;
}
