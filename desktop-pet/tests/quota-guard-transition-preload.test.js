const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('guard transition bridge copies only bounded numeric card geometry',()=>{
 let bridge, listener, model;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../quota-label-preload.js'),'utf8'),{process:{argv:[]},require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{on:(_name,value)=>listener=value,removeListener(){}}})});
 bridge.onModel(value=>model=value);
 const transition={from:{left:34,top:20,width:124,height:28},to:{left:0,top:18,width:196,height:131},host:{width:218,height:149},duration:180};
 listener(null,{state:'ready',items:[],cardTransition:transition,cardViewport:{host:transition.host,face:transition.to}});
 assert.deepEqual(JSON.parse(JSON.stringify(model.cardViewport)),{host:transition.host,face:transition.to});assert.deepEqual(JSON.parse(JSON.stringify(model.cardTransition)),transition);
 for(const invalid of [{...transition,duration:0},{...transition,from:{...transition.from,left:-1}},{...transition,host:{width:Infinity,height:149}},{...transition,to:{...transition.to,width:5000}}]){listener(null,{cardTransition:invalid});assert.equal(model.cardTransition,undefined);}
});
