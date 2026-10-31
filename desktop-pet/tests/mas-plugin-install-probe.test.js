'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {probePluginInstallation}=require('../lib/mas-plugin-install-probe');
test('installer fixture probe refuses non-MAS without opening a picker or touching any directory',async()=>{
 const result=await probePluginInstallation({app:{getPath:()=>assert.fail('must not read profile'),startAccessingSecurityScopedResource:()=>assert.fail('must not grant')},dialog:{showOpenDialog:async()=>assert.fail('must not open')}});
 assert.equal(result.mas,false);assert.equal(result.passed,false);assert.equal(result.errorCode,'MAS_INSTALL_PROBE_FAILED');assert.equal(result.selected,false);
});
