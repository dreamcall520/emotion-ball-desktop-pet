'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),plist=require('plist');
const {createHash}=require('node:crypto');
const release=require('../scripts/mas-release-profile');
function fixture(t){const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mas-languages-test-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));const app=path.join(temp,'Qiuqiu.app');fs.mkdirSync(path.join(app,'Contents/Resources'),{recursive:true});return{temp,app,put(rel,value){const p=path.join(app,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value);return p;}};}
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
test('allowlist保留简中/繁中/英文与Base原生资源，不保留其他Electron语言',()=>{
 for(const name of ['Base','en','en_GB','en-US','zh_CN','zh-TW','zh-Hans','zh_Hant','zh-HK'])assert.equal(release.keepElectronLanguage(name),true,name);
 for(const name of ['fr','de','ja','ar','fr_FR','not-a-language','',null])assert.equal(release.keepElectronLanguage(name),false,String(name));
});
test('非首发profile不触碰输出目录，首发删除完整lproj并同步显式语言声明',t=>{
 const f=fixture(t),contents='Contents/Frameworks/Electron Framework.framework/Versions/A/Resources';
 const mainPlist=f.put('Contents/Info.plist',plist.build({CFBundleLocalizations:['en','zh-Hans','zh-Hant','fr','ja'],CFBundleDevelopmentRegion:'fr'}));
 for(const lang of ['en','en_GB','zh_CN','zh_TW','Base','fr','ja']){f.put(`${contents}/${lang}.lproj/locale.pak`,lang);f.put(`Contents/Resources/${lang}.lproj/InfoPlist.strings`,lang);}
 const helperPlist=f.put('Contents/Frameworks/Qiuqiu Helper.app/Contents/Info.plist',plist.build({CFBundleLocalizations:['en','fr'],CFBundleDevelopmentRegion:'en'}));
 const before=hash(mainPlist);assert.equal(release.trimElectronLocales(f.app,{}).applied,false);assert.equal(hash(mainPlist),before);assert.ok(fs.existsSync(path.join(f.app,`${contents}/fr.lproj`)));
 const report=release.trimElectronLocales(f.app,{releaseProfile:'mas-first'});assert.equal(report.applied,true);assert.equal(report.removedDirectories,4);assert.equal(report.removedBytes,8);assert.equal(report.updatedPlists,2);
 for(const lang of ['en','en_GB','zh_CN','zh_TW','Base']){assert.ok(fs.existsSync(path.join(f.app,`${contents}/${lang}.lproj/locale.pak`)));assert.ok(fs.existsSync(path.join(f.app,`Contents/Resources/${lang}.lproj/InfoPlist.strings`)));}
 for(const lang of ['fr','ja'])assert.equal(fs.existsSync(path.join(f.app,`${contents}/${lang}.lproj`)),false);
 assert.deepEqual(plist.parse(fs.readFileSync(mainPlist,'utf8')).CFBundleLocalizations,['en','zh-Hans','zh-Hant']);assert.equal(plist.parse(fs.readFileSync(mainPlist,'utf8')).CFBundleDevelopmentRegion,'en');assert.deepEqual(plist.parse(fs.readFileSync(helperPlist,'utf8')).CFBundleLocalizations,['en']);
});
test('不改官方binary/素材/未声明的plist，不跟随Framework目录链接到包外',t=>{
 const f=fixture(t),binary=f.put('Contents/Resources/qiuqiu-codex/darwin-arm64/codex','official binary'),asset=f.put('Contents/Resources/app.asar','all original partners and animations'),info=f.put('Contents/Info.plist',plist.build({CFBundleName:'球球桌宠'}));
 const outside=path.join(f.temp,'outside');fs.mkdirSync(path.join(outside,'fr.lproj'),{recursive:true});fs.writeFileSync(path.join(outside,'fr.lproj/locale.pak'),'external file');fs.mkdirSync(path.join(f.app,'Contents/Frameworks'));fs.symlinkSync(outside,path.join(f.app,'Contents/Frameworks/External.framework'));
 const before=[binary,asset,info].map(hash);release.trimElectronLocales(f.app,{releaseProfile:'mas-first'});assert.deepEqual([binary,asset,info].map(hash),before);assert.equal(fs.readFileSync(path.join(outside,'fr.lproj/locale.pak'),'utf8'),'external file');assert.equal(plist.parse(fs.readFileSync(info,'utf8')).CFBundleLocalizations,undefined);
});
test('开发和正式打包脚本在packager输出后、签名之前调用同一首发语言裁剪',()=>{
 for(const file of ['package-mas.js','package-mas-development.js']){const source=fs.readFileSync(path.join(__dirname,'../scripts',file),'utf8'),trim=source.indexOf('release.trimElectronLocales(appPath');const outputPositions=['const appPath =','const appPath='].map(x=>source.indexOf(x)).filter(x=>x>=0);assert.ok(outputPositions.length>0);assert.ok(trim>Math.min(...outputPositions));assert.ok(trim<source.indexOf('await sign('));assert.match(source,/languageResources/);}
});
