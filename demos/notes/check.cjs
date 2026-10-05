const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const model = require('./lib/notes-model.js');
const manifest = require('./source-manifest.json');
for (const file of manifest.unchangedCopies) {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, file))).digest('hex');
  assert.equal(digest, manifest.originalFiles.find(item => item.file === file).sha256, `${file} must match the official source`);
}
const events = [], parent = { postMessage: value => events.push(value) }, handlers = {};
const context = { window: { QiuModel: model, addEventListener: (name, callback) => handlers[name] = callback }, location: { search: '?demoScope=test', pathname: '/demos/notes/panel.html', origin: 'https://example.test' }, parent, crypto, URLSearchParams, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval, navigator: { clipboard: { writeText: async () => {} } } };
vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname,'demo-bridge.js'),'utf8'),context);
(async () => {
  const api = context.window.qiuNotes;
  let loaded = await api.load(); model.validate(loaded.state); assert.equal(loaded.state.notes.length,4);
  const changed = structuredClone(loaded.state); changed.notes[0].title = '示例修改';
  assert.equal((await api.save(changed,loaded.state.revision)).ok,true);
  assert.equal((await api.save(changed,loaded.state.revision)).ok,false,'stale write must be rejected');
  assert.equal((await api.openNote('sample-note-trash')).ok,false);
  assert.equal((await api.openNote('sample-reading')).ok,true);
  loaded = await api.load(); assert.equal(loaded.state.notes.find(item => item.id==='sample-reading').desktopOpen,true);
  const preview = await api.organizeNote({title:'示例',body:'带水；带相机。'}); assert.equal(preview.result.body,'• 带水\n• 带相机');
  assert.notEqual((await api.load()).state.notes[0].body,preview.result.body,'preview must not apply automatically');
  await handlers.message({ origin:'https://foreign.test', source:parent, data:{type:'qiuqiu-demo-theme',appearance:'dark'} });
  assert.equal((await api.load()).notesAppearance,'light','foreign theme message must be ignored');
  await handlers.message({ origin:'https://example.test', source:parent, data:{type:'qiuqiu-demo-theme',appearance:'dark',colorMode:'accessible'} });
  assert.equal((await api.load()).notesAppearance,'dark');
  await handlers.message({ origin:'https://example.test', source:parent, data:{type:'qiuqiu-notes-demo',scope:'test',kind:'show-reminder'} });
  assert.ok(events.some(event=>event.kind==='view'&&event.view==='reminder'));
  const task = (await api.load()).state.todos.find(item=>item.id==='sample-rest');
  assert.equal((await api.actionReminder(task.id,'wrong-occurrence','snooze')).ok,false);
  assert.equal((await api.actionReminder(task.id,task.occurrenceId,'snooze')).ok,true);
  assert.ok((await api.load()).state.todos.find(item=>item.id===task.id).reminderAt > Date.now());
  let opened; api.onOpen(value => { opened = value; });
  await api.actionReminder(null,null,'list'); assert.equal(opened.tab,'todo');
  assert.ok(events.some(event=>event.kind==='panel-visibility'&&event.open));
  const closed = structuredClone((await api.load()).state); closed.notes.forEach(note=>{ note.desktopOpen=false; });
  await api.save(closed,closed.revision); await api.actionReminder(null,null,'list');
  assert.equal(events.filter(event=>event.kind==='view').at(-1).open,false,'reminders must not reopen closed notes');
  console.log('Passed: exact official assets, memory state, stale-write guard, restore/open, preview-only organizer, trusted theme, reminder occurrence and snooze.');
  if (!process.argv.includes('--serve')) return;
  const http = require('node:http'), website = path.resolve(__dirname,'../..');
  const fragment = fs.readFileSync(path.join(__dirname,'embed-fragment.html'),'utf8').replaceAll('src="demos/','src="/demos/');
  const fixture = `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font:14px sans-serif}.notes-native-windows{display:flex;gap:20px;align-items:flex-start}.notes-native-panel{width:min(100%,380px);min-width:0}.notes-native-desktop{width:min(100%,360px);min-width:0}iframe{display:block;border:0;max-width:100%;width:100%}.notes-native-desktop iframe{width:min(100%,300px)}[hidden]{display:none!important}@media(max-width:700px){.notes-native-windows{display:grid;grid-template-columns:minmax(0,1fr)}}</style></head><body>${fragment}<script src="/demos/notes/embed.js"></script></body></html>`;
  http.createServer((request,response)=>{
    const pathname = new URL(request.url,'http://127.0.0.1:9062').pathname;
    if(pathname==='/__notes-check'){response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(fixture);return}
    const file = path.resolve(website,'.'+decodeURIComponent(pathname));
    if(!file.startsWith(website+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return}
    const type = file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream';
    response.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});response.end(fs.readFileSync(file));
  }).listen(9062,'127.0.0.1',()=>console.log('Browser fixture: http://127.0.0.1:9062/__notes-check'));
})().catch(error=>{console.error(error);process.exitCode=1});
