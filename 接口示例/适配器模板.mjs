import {sendNotification} from './发送通知.mjs';
// 用自己的行情、任务或系统信息读取逻辑替换。
async function detectEvent(){return null;}
const event=await detectEvent();
if(event){
  // 同一条件触发期间重复检测，使用相同 event.id。
  console.log(await sendNotification({source:'我的来源',kind:'info',...event}));
}
