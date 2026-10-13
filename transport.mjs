import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

export class CodexConnection extends EventEmitter {
  constructor(config) { super(); this.config=config; this.pending=new Map(); this.nextId=1; this.buffer=Buffer.alloc(0); this.fragments=[]; }
  async connect() {
    const c=this.config;
    if(!c.codexExecutable&&!c.codexEntry)throw new Error('未检测到 Codex；本地记录和 DIY 接口仍可使用');
    this.child=spawn(c.codexExecutable||c.nodePath,[...(c.codexExecutable?[]:[c.codexEntry]),'app-server','proxy',...(c.socketPath?['--sock',c.socketPath]:[])],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child.stdin.on('error',e=>this.fail(e));
    this.child.on('error',e=>this.fail(e));
    this.child.on('exit',()=>this.fail(new Error('Codex 控制通道断开')));
    this.child.stderr.resume();
    this.child.stdout.on('data',b=>{try {this.receive(b);} catch(e){this.fail(e);}});
    const handshake=new Promise((resolve,reject)=>{this.resolveHandshake=resolve;this.rejectHandshake=reject;});
    this.key=randomBytes(16).toString('base64');
    this.child.stdin.write('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+this.key+'\r\nSec-WebSocket-Version: 13\r\n\r\n');
    const timer=setTimeout(()=>this.fail(new Error('控制通道握手超时，请先启动 Codex CLI')),10000);
    try {
      await handshake;
      await this.request('initialize',{clientInfo:{name:'gpt_notifier',title:null,version:'1.0.0'},capabilities:{experimentalApi:true,requestAttestation:false}});
      this.send({method:'initialized'});
    } finally {clearTimeout(timer);}
    return this;
  }
  frame(data,opcode=1) {
    const b=Buffer.isBuffer(data)?data:Buffer.from(data),m=randomBytes(4);let h;
    if(b.length<126)h=Buffer.from([128|opcode,128|b.length]);
    else if(b.length<65536){h=Buffer.alloc(4);h[0]=128|opcode;h[1]=254;h.writeUInt16BE(b.length,2);}
    else {h=Buffer.alloc(10);h[0]=128|opcode;h[1]=255;h.writeBigUInt64BE(BigInt(b.length),2);}
    const d=Buffer.from(b);for(let i=0;i<d.length;i++)d[i]^=m[i%4];
    this.child.stdin.write(Buffer.concat([h,m,d]));
  }
  send(obj){this.frame(JSON.stringify(obj));}
  request(method,params) {
    const id=this.nextId++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Codex 请求超时: '+method));},10000);
      this.pending.set(id,{resolve,reject,timer});this.send({id,method,params});
    });
  }
  receive(b) {
    this.buffer=Buffer.concat([this.buffer,b]);
    if(!this.ready){
      const i=this.buffer.indexOf('\r\n\r\n');if(i<0)return;
      const header=this.buffer.subarray(0,i).toString();
      const expected=createHash('sha1').update(this.key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      if(!header.startsWith('HTTP/1.1 101 ')||!header.toLowerCase().includes('sec-websocket-accept: '+expected.toLowerCase()))throw new Error('Codex WebSocket 握手失败');
      this.buffer=this.buffer.subarray(i+4);this.ready=true;this.resolveHandshake();
    }
    while(this.buffer.length>=2){
      const a=this.buffer[0],masked=Boolean(this.buffer[1]&128);let length=this.buffer[1]&127,offset=2;
      if(length===126){if(this.buffer.length<4)return;length=this.buffer.readUInt16BE(2);offset=4;}
      else if(length===127){if(this.buffer.length<10)return;length=Number(this.buffer.readBigUInt64BE(2));offset=10;}
      if(length>32*1024*1024)throw new Error('Codex 消息过大');
      if(masked)offset+=4;if(this.buffer.length<offset+length)return;
      const d=Buffer.from(this.buffer.subarray(offset,offset+length));
      if(masked)for(let i=0;i<d.length;i++)d[i]^=this.buffer[offset-4+i%4];
      this.buffer=this.buffer.subarray(offset+length);const opcode=a&15;
      if(opcode===8){this.fail(new Error('Codex 关闭连接'));return;}
      if(opcode===9){this.frame(d,10);continue;}if(opcode===10)continue;
      if(opcode===1||opcode===0){this.fragments.push(d);if(a&128){const obj=JSON.parse(Buffer.concat(this.fragments).toString());this.fragments=[];this.message(obj);}}
    }
  }
  message(obj){
    if(obj.id!==undefined&&!obj.method){
      const p=this.pending.get(obj.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(obj.id);
      obj.error?p.reject(new Error(obj.error.message||'Codex 接口错误')):p.resolve(obj.result);
    } else this.emit('notification',obj); // Never answer approval requests.
  }
  fail(e){
    if(this.closed)return;this.closed=true;this.rejectHandshake?.(e);
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();
    this.child?.kill();this.emit('disconnected',e);
  }
  close(){this.fail(new Error('提醒器停止'));}
}
