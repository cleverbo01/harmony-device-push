import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export async function sendNotification(payload){
  const config=JSON.parse(await fs.readFile(new URL('../config.json',import.meta.url),'utf8'));
  const api=config.localApi;if(!api?.enabled)throw new Error('请开启接口并开始监控');
  const response=await fetch('http://127.0.0.1:'+api.port+'/api/push',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+api.token},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'接口调用失败');return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [title,body,source='自定义',id,kind='info']=process.argv.slice(2);
  try{console.log(await sendNotification({title,body,source,id,kind}));}catch(e){console.error(e.message);process.exitCode=1;}
}
