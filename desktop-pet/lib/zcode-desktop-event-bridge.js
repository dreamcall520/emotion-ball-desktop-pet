'use strict';
const http=require('node:http');
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const {TextDecoder}=require('node:util');
const SCOPE='authorized-original-zcode-hook-metadata';
const PHASES=Object.freeze({SessionStart:'session-opened',UserPromptSubmit:'submitted',Stop:'stop-observed'});
const failure=code=>Object.assign(new Error(code),{code});
// A tiny restrictive metadata parser, not a general JSON deserializer. Unknown
// property names are rejected before their values are interpreted. In particular
// prompt/reply/tool/transcript fields are never parsed or published.
function parseMetadata(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length>2048)throw failure('INVALID_METADATA');
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw failure('INVALID_METADATA');}
 let at=0;const value={};const white=()=>{while(/[\t\n\r ]/.test(text[at]||'!'))at++;};
 function quoted(){if(text[at++]!=='"')throw failure('INVALID_METADATA');const start=at;while(at<text.length&&text[at]!=='"'){if(!/[A-Za-z0-9_-]/.test(text[at])||at-start>=160)throw failure('INVALID_METADATA');at++;}if(text[at++]!=='"'||at-start<=1)throw failure('INVALID_METADATA');return text.slice(start,at-1);}
 white();if(text[at++]!=='{')throw failure('INVALID_METADATA');white();
 for(let count=0;;count++){
  if(count>4)throw failure('INVALID_METADATA');
  const key=quoted();if(!['version','sessionId','turnId','event','phase'].includes(key)||Object.hasOwn(value,key))throw failure('INVALID_METADATA');
  white();if(text[at++]!==':')throw failure('INVALID_METADATA');white();
  if(key==='version'){if(text[at++]!=='1')throw failure('INVALID_METADATA');value.version=1;}else value[key]=quoted();
  white();const next=text[at++];if(next==='}')break;if(next!==',')throw failure('INVALID_METADATA');white();
 }
 white();if(at!==text.length||value.version!==1||!value.sessionId||!Object.hasOwn(PHASES,value.event)||value.phase!==PHASES[value.event])throw failure('INVALID_METADATA');
 return value;
}
function createZcodeDesktopEventBridge({onEvent=()=>{},onChange=()=>{},now=Date.now,staleAfterMs=60000,maxRequestsPerWindow=60,windowMs=10000}={}){
 if(!Number.isSafeInteger(staleAfterMs)||staleAfterMs<20||staleAfterMs>600000||!Number.isSafeInteger(maxRequestsPerWindow)||maxRequestsPerWindow<1||maxRequestsPerWindow>1000||!Number.isSafeInteger(windowMs)||windowMs<100||windowMs>60000)throw failure('INVALID_OPTIONS');
 let server=null,token=null,privateConfig=null,startFlight=null,closeFlight=null,closed=false,timer=null,lastEventAt=null,sequence=0,windowStart=0,windowCount=0;
 const sockets=new Set(),rows=new Map(),seen=new Map();
 const clock=()=>{const value=Number(now());return Number.isFinite(value)&&value>=0?Math.trunc(value):Date.now();};
 function getState(){const time=clock(),enabled=Boolean(privateConfig)&&!closed;
  return{enabled,status:closed?'closed':!enabled?'disabled':lastEventAt===null?'waiting':time-lastEventAt>staleAfterMs?'unknown':'observing',source:'zcode-desktop-hook',scope:SCOPE,accountAttributionVerified:false,desktopRealtimeVerified:false,terminalTaskStateVerified:false,lastEventAt,
   observations:[...rows.values()].map(row=>({...row,...(!enabled||time-row.observedAt>staleAfterMs?{...(row.terminalConfirmed?{}:{state:'unknown'}),realtime:false}:{})}))};
 }
 function notify(){try{onChange(getState());}catch{}}
 function authorize(raw){if(!token||typeof raw!=='string')return false;const received=Buffer.from(raw),expected=Buffer.from('Bearer '+token);return received.length===expected.length&&timingSafeEqual(received,expected);}
 function reply(res,status){if(!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});res.end(JSON.stringify({ok:status===202||status===208}));}}
 function accept(metadata){
  const time=clock(),fingerprint=createHash('sha256').update(JSON.stringify([metadata.sessionId,metadata.turnId||null,metadata.event,metadata.phase])).digest('hex');
  for(const[key,when]of seen)if(time-when>300000)seen.delete(key);
  if(seen.has(fingerprint)&&time-seen.get(fingerprint)<(metadata.turnId?300000:1000))return false;
  seen.set(fingerprint,time);while(seen.size>256)seen.delete(seen.keys().next().value);
  lastEventAt=time;const correlated=Boolean(metadata.turnId),id=createHash('sha256').update(metadata.sessionId+'\0'+(metadata.turnId||'uncorrelated-'+(++sequence))).digest('hex').slice(0,32);
  // Official ZCode Stop hooks can request continuation. No supported hook
  // proves final turn or background-team completion; never invent a terminal.
  const row={id,phase:metadata.phase,state:'observed',running:null,realtime:true,correlated,terminalConfirmed:false,terminalKind:null,overallTaskVerified:false,observedAt:time,source:'zcode-desktop-hook',scope:SCOPE,evidence:metadata.event==='Stop'?'hook-stop-before-final-decision':'hook-metadata-observed'};
  rows.delete(id);rows.set(id,row);while(rows.size>32)rows.delete(rows.keys().next().value);
  const event={...metadata,type:'metadata',source:'zcode-desktop-hook',scope:SCOPE,correlated,terminalConfirmed:false,terminalKind:null,overallTaskVerified:false,taskState:null,observedAt:time,observationId:id};
  try{onEvent(structuredClone(event));}catch{}notify();return true;
 }
 function handler(req,res){
  if(closed){reply(res,503);req.resume();return;}
  if(Object.hasOwn(req.headers,'origin')){reply(res,403);req.resume();return;}
  if(!authorize(req.headers.authorization)){reply(res,401);req.resume();return;}
  if(req.url!=='/zcode/events'){reply(res,404);req.resume();return;}
  if(req.method!=='POST'){reply(res,405);req.resume();return;}
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')){reply(res,415);req.resume();return;}
  const time=clock();if(time<windowStart||time-windowStart>=windowMs){windowStart=time;windowCount=0;}
  if(++windowCount>maxRequestsPerWindow){reply(res,429);req.resume();return;}
  const length=req.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>2048)){reply(res,413);req.resume();return;}
  let bytes=0,chunks=[],ended=false;
  const deadline=setTimeout(()=>{ended=true;chunks=[];reply(res,408);req.resume();},1500);deadline.unref?.();
  const stop=()=>{clearTimeout(deadline);chunks=[];ended=true;};req.on('error',stop);req.on('aborted',stop);
  req.on('data',chunk=>{if(ended)return;bytes+=chunk.length;if(bytes>2048){stop();reply(res,413);req.resume();}else chunks.push(chunk);});
  req.on('end',()=>{if(ended)return;clearTimeout(deadline);ended=true;if(closed){chunks=[];reply(res,503);return;}try{const metadata=parseMetadata(Buffer.concat(chunks,bytes));chunks=[];reply(res,accept(metadata)?202:208);}catch{chunks=[];reply(res,400);}});
 }
 function start(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['port','token'].includes(key)))return Promise.reject(failure('INVALID_OPTIONS'));
  const restoring=Object.hasOwn(options,'port')||Object.hasOwn(options,'token');
  if(restoring&&(!Number.isInteger(options.port)||options.port<1024||options.port>65535||typeof options.token!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(options.token)))return Promise.reject(failure('INVALID_OPTIONS'));
  if(privateConfig&&restoring&&(new URL(privateConfig.endpoint).port!==String(options.port)||privateConfig.token!==options.token))return Promise.reject(failure('ALREADY_STARTED'));
  if(closed)return Promise.reject(failure('CLOSED'));if(privateConfig)return Promise.resolve({...privateConfig});if(startFlight)return startFlight;
  token=restoring?options.token:randomBytes(32).toString('base64url');server=http.createServer(handler);server.maxConnections=16;server.headersTimeout=2500;server.requestTimeout=3000;server.keepAliveTimeout=1;
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  startFlight=new Promise((resolve,reject)=>{const fail=error=>{token=null;reject(failure(error?.code==='EADDRINUSE'?'BRIDGE_PORT_UNAVAILABLE':'BRIDGE_START_FAILED'));};server.once('error',fail);server.listen(restoring?options.port:0,'127.0.0.1',()=>{server.removeListener('error',fail);server.on('error',()=>{});if(closed){server.close();reject(failure('CLOSED'));return;}privateConfig={version:1,enabled:true,endpoint:`http://127.0.0.1:${server.address().port}/zcode/events`,token};let prior='waiting';timer=setInterval(()=>{const state=getState();if(state.status!==prior){prior=state.status;notify();}},Math.max(20,Math.min(5000,Math.floor(staleAfterMs/2))));timer.unref?.();notify();resolve({...privateConfig});});});return startFlight;
 }
 function close(){if(closeFlight)return closeFlight;closed=true;token=null;privateConfig=null;clearInterval(timer);for(const socket of sockets)socket.destroy();closeFlight=new Promise(resolve=>{if(!server)return resolve();try{server.close(()=>resolve());}catch{resolve();}});notify();return closeFlight;}
 return{start,getState,close};
}
module.exports={createZcodeDesktopEventBridge,parseMetadata};
