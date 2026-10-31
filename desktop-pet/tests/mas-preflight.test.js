'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {inspect}=require('../scripts/mas-preflight');
const root=path.resolve(__dirname,'../..');
function mocked({identities=0,securityOk=true,xcodeOk=true,missing=[]}={}){
 const commands=[],reads=[];
 const run=(name,args)=>{commands.push([name,args]);return {ok:name==='security'?securityOk:name==='xcodebuild'?xcodeOk:true,output:name==='security'?`1) ${'A'.repeat(40)} "Apple Development: Private Fixture Person (ABCDEF1234)"\n${identities} valid identities found\n`:name==='xcodebuild'?'Xcode fixture':'fixture-commit'};};
 const io={readFileSync(file,encoding){reads.push(file);if(missing.includes(path.basename(file)))throw Error('missing fixture');return fs.readFileSync(file,encoding);}};
 return {report:inspect({root,run,io}),commands,reads};
}
test('已实现的MAS开发与分发入口不会再被默认Darwin候选打包器误判为未实现',()=>{
 const {report:r}=mocked();assert.equal(r.masBuildPipeline.development.implementationPresent,true);assert.equal(r.masBuildPipeline.distribution.implementationPresent,true);
 assert.equal(r.masBuildPipeline.development.executedByPreflight,false);assert.equal(r.masBuildPipeline.distribution.executedByPreflight,false);
 assert.match(r.packagerInventoryScope,/separate/);assert.equal(r.blockers.some(v=>/not implemented|updater require MAS adaptation/.test(v)),false);
 assert.equal(r.blockers.includes('No valid local code signing identity'),true);
});
test('有有效身份也不冒充匹配的MAS签名、profile、本机注册或实际沙盒验收',()=>{
 const {report:r}=mocked({identities:1});assert.equal(r.validCodeSigningIdentityCount,1);assert.equal(r.developerMembership,'not-verified');assert.equal(r.provisioningProfile,'not-verified');assert.match(r.signingReadiness,/not-verified/);
 assert.equal(r.signedMasRuntimeAcceptance,'not-verified-by-preflight');assert.equal(r.chatTaskAndDirectorySandboxAcceptance,'not-verified-by-preflight');assert.equal(r.appStoreConnectMetadata,'not-verified');assert.equal(r.submissionReady,false);
 assert.ok(r.blockers.some(v=>/matching provisioning profile/.test(v)));assert.ok(r.blockers.some(v=>/Actual signed MAS runtime/.test(v)));assert.ok(r.blockers.some(v=>/Automatic external plugin installation/.test(v)));
 assert.equal(JSON.stringify(r).includes('Private Fixture Person'),false);assert.equal(JSON.stringify(r).includes('ABCDEF1234'),false);
});
test('预检仅清点源码与已有工具，不解密profile、读取设备账号、构建签名或上传',()=>{
 const {commands,reads}=mocked();assert.deepEqual(commands.map(v=>v[0]),['security','xcodebuild','git']);assert.deepEqual(commands[0][1],['find-identity','-v','-p','codesigning']);
 assert.deepEqual(reads.map(v=>path.basename(v)),['package.json','package-mac.js','package-mas-development.js','package-mas.js']);
});
test('入口缺失和环境检查不可用准确显示，不伪装已完成',()=>{
 const {report:r}=mocked({securityOk:false,xcodeOk:false,missing:['package-mas-development.js']});assert.equal(r.masBuildPipeline.development.implementationPresent,false);assert.equal(r.masBuildPipeline.distribution.implementationPresent,true);
 assert.ok(r.blockers.includes('MAS development build entrypoint missing or incomplete'));assert.ok(r.blockers.includes('Xcode command-line build unavailable'));assert.ok(r.blockers.includes('Code signing identity check unavailable'));assert.equal(r.validCodeSigningIdentityCount,null);assert.equal(r.blockers.includes('No valid local code signing identity'),false);assert.equal(r.submissionReady,false);
});
