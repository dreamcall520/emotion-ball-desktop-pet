'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {formatBuildFailure}=require('../scripts/package-mas-first-distribution');
const parse=(error,fallback)=>JSON.parse(formatBuildFailure(error,fallback));
test('数字code保留原始退出码、status、signal和工具stderr，不被startsWith异常覆盖',()=>{
 const error=Object.assign(Error('Command failed: /usr/bin/codesign '+ 'very-long-arg '.repeat(2000)),{code:1,status:1,signal:'SIGTERM',stderr:Buffer.from('errSecInternalComponent\nThe specified item could not be found in the keychain.\n')});
 const result=parse(error);assert.equal(result.code,'MAS_FIRST_DISTRIBUTION_FAILED');assert.equal(result.originalCode,1);assert.equal(result.status,1);assert.equal(result.signal,'SIGTERM');assert.match(result.reason,/errSecInternalComponent/);assert.doesNotMatch(result.reason,/very-long-arg|TypeError/);
});
test('合法MAS字符串保留，有效ENOENT等非MAS字符串可定位且不冒充已分类失败',()=>{
 assert.deepEqual(parse({code:'MAS_PROFILE_EXPIRED',message:'profile expired'}),{code:'MAS_PROFILE_EXPIRED',originalCode:'MAS_PROFILE_EXPIRED',reason:'profile expired'});
 assert.equal(parse({code:'ENOENT',message:'binary unavailable'}).originalCode,'ENOENT');
 assert.equal(parse({code:'ENOENT'},'MAS_FIRST_DEVELOPMENT_FAILED').code,'MAS_FIRST_DEVELOPMENT_FAILED');
});
test('无code与空error安全输出，消息中巨长命令过滤，诊断长度受控并净化凭据',()=>{
 assert.deepEqual(parse(null),{code:'MAS_FIRST_DISTRIBUTION_FAILED'});assert.deepEqual(parse(undefined),{code:'MAS_FIRST_DISTRIBUTION_FAILED'});assert.equal(parse(Error('signature validation failed')).reason,'signature validation failed');
 const result=parse({message:'Command failed: /usr/bin/productbuild '+ 'argument '.repeat(3000)+'\n'+ 'detail '.repeat(1000)+'\nsigning failed: invalid certificate\ntoken=must-not-leak Authorization: Bearer abc.def.ghi'});
 assert.match(result.reason,/invalid certificate/);assert.doesNotMatch(result.reason,/argument|must-not-leak|abc.def.ghi/);assert.ok(result.reason.length<=2000);assert.ok(formatBuildFailure({code:{startsWith(){throw Error();}}}).length<100);
});
async function invokeCLI(file,error){
 const filename=path.join(__dirname,'../scripts',file),source=fs.readFileSync(filename,'utf8'),nativeRequire=createRequire(filename),module={exports:{}};
 let stderr='',stdout='',commands=0;
 const process={arch:'arm64',argv:['node',filename,'--build'],stderr:{write:s=>{stderr+=s;}},stdout:{write:s=>{stdout+=s;}},exitCode:0};
 const require=name=>{
  if(name==='node:fs')return{readFileSync:()=>JSON.stringify({version:'0.4.10',qiuqiuReleaseProfile:'mas-first',devDependencies:{electron:'43.4.1'}})};
  if(name==='node:child_process')return{execFileSync(){commands++;throw error;}};
  return nativeRequire(name);
 };
 require.main=module;
 vm.runInNewContext(source,{require,module,__dirname:path.dirname(filename),process,Buffer,console},{filename});
 await new Promise(resolve=>setImmediate(resolve));
 return{stderr,stdout,exitCode:process.exitCode,commands};
}
test('分发与开发CLI对数字code/字符串MAS/无code/空拒绝均退出2；不真实调用签名或钥匙串',async()=>{
 for(const file of ['package-mas-first-distribution.js','package-mas-first-development.js']){
  const fallback=file.includes('distribution')?'MAS_FIRST_DISTRIBUTION_FAILED':'MAS_FIRST_DEVELOPMENT_FAILED';
  for(const error of [{code:1,status:1,stderr:'certificate chain validation failed'},{code:'MAS_CERTIFICATE_INVALID'},Error('signature failed'),null]){
   const result=await invokeCLI(file,error),info=JSON.parse(result.stderr);
   assert.equal(result.exitCode,2);assert.equal(result.stdout,'');assert.equal(result.commands,1);assert.equal(info.code,error?.code==='MAS_CERTIFICATE_INVALID'?'MAS_CERTIFICATE_INVALID':fallback);assert.doesNotMatch(result.stderr,/startsWith is not a function|TypeError/);
   if(error?.code===1){assert.equal(info.originalCode,1);assert.equal(info.status,1);assert.match(info.reason,/certificate chain validation failed/);}
  }
 }
});
