const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const M=require('../lib/notes-model');

function renderer(save,mode='note'){
  const nodes=new Map();
  const make=(tag='div')=>({tag,scrollHeight:24,value:'',textContent:'',hidden:true,disabled:false,open:false,children:[],dataset:{},
    style:{},events:{},attributes:{},classList:{toggle(){}},setAttribute(name,value){this.attributes[name]=String(value)},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},
    queries:{},focus(){},select(){},showModal(){this.open=true},close(){this.open=false},querySelector(selector){return this.queries[selector]||(this.queries[selector]=make())},addEventListener(name,fn){this.events[name]=fn}});
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,make());return nodes.get(id)},createElement:make,activeElement:null,documentElement:{dataset:{}},body:{dataset:{}},events:{},addEventListener(name,fn,capture){this.events[`${name}:${!!capture}`]=fn},querySelector(selector){return selector==='dialog[open]'?[...nodes.values()].find(n=>n.open):make()}};
  const clipboard=[];const bridge={save,async copyText(text){clipboard.push(text);return{ok:true}},async closeWindow(){return{ok:true}},async pinPanel(value){return{ok:true,pinned:value}},async load(){return {state:{schema:1,revision:0,notes:[],todos:[]},mode:'panel'}},onState(){},onReminder(){},onOpen(){},onBeforeClose(){}};
  const source=fs.readFileSync(path.join(__dirname,'../notes-renderer.js'),'utf8').replace('start();',
    'window.check={commit,inputNote,flushNote,flushAll,copyNote,beforeClose,acceptState,start,showStorageError,cancelClose,openNoteEditor,openOrganize,generateOrganized,applyOrganized,closeOrganize,render,state:()=>state,draft:id=>drafts.get(id)};');
  const window={QiuModel:M,qiuNotes:bridge,addEventListener(){}};
  vm.runInNewContext(source,{window,document,location:{search:`?mode=${mode}&id=n1`},URLSearchParams,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},confirm:()=>false,console});
  const n=M.newNote('标题','初始内容');n.id='n1';window.check.acceptState({schema:1,revision:0,notes:[n],todos:[]});
  return {...window.check,clipboard,nodes,bridge,document};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('native save is awaited and newer input survives the in-flight save',async()=>{
  const pending=[];const r=renderer((next,revision)=>new Promise(resolve=>pending.push(()=>resolve({ok:true,state:{...next,revision:revision+1}}))));
  r.inputNote('n1','标题','第一版');const first=r.flushNote('n1');await turn();
  assert.equal(r.nodes.get('note-footer').hidden,false);assert.equal(r.nodes.get('note-save-status').textContent,'正在保存…');
  assert.equal(r.state().notes[0].body,'初始内容');assert.equal(r.draft('n1').body,'第一版');
  r.inputNote('n1','标题','保存期间输入的第二版');pending.shift()();assert.equal(await first,true);
  assert.equal(r.state().notes[0].body,'第一版');assert.equal(r.draft('n1').body,'保存期间输入的第二版');
  const second=r.flushNote('n1');await turn();pending.shift()();assert.equal(await second,true);
  assert.equal(r.state().notes[0].body,'保存期间输入的第二版');assert.equal(r.draft('n1'),undefined);assert.equal(r.nodes.get('note-footer').hidden,true);assert.equal(r.nodes.get('note-save-status').textContent,'');
});

test('failed native save retains draft, copies full draft and blocks closing',async()=>{
  const r=renderer(async()=>({ok:false,message:'磁盘不可写'}));r.inputNote('n1','新标题','草稿第一行\n完整第二行');
  assert.equal(await r.flushNote('n1'),false);assert.equal(r.nodes.get('note-footer').hidden,false);assert.equal(r.nodes.get('note-save-status').textContent,'保存失败，请重试');const next=M.copy(r.state());next.revision++;r.acceptState(next);assert.equal(r.nodes.get('note-save-status').textContent,'保存失败，请重试');assert.equal(r.state().notes[0].body,'初始内容');
  assert.equal(await r.copyNote('n1'),true);assert.equal(r.clipboard[0],'新标题\n草稿第一行\n完整第二行');
  assert.equal(await r.beforeClose(),false);assert.equal(r.nodes.get('save-guard').open,true);
  assert.equal(r.draft('n1').body,'草稿第一行\n完整第二行');
});

test('another window content edit is not overwritten and current draft remains copyable',async()=>{
  let saves=0;const r=renderer(async()=>{saves++;return{ok:true}});r.inputNote('n1','标题','本窗草稿');
  const other=M.copy(r.state());other.revision++;other.notes[0].body='另一窗口的新内容';other.notes[0].updatedAt+=100;r.acceptState(other);
  assert.equal(await r.flushNote('n1'),false);assert.equal(saves,0);assert.equal(r.state().notes[0].body,'另一窗口的新内容');
  await r.copyNote('n1');assert.equal(r.clipboard[0],'标题\n本窗草稿');
});

test('editing an open desktop note focuses its existing window instead of opening a second editor',async()=>{
  const r=renderer(async()=>assert.fail('定位已打开窗口不能保存内容'));
  const state=M.copy(r.state());state.notes[0].desktopOpen=true;r.acceptState(state);
  let opened;r.bridge.openNote=async id=>{opened=id;return {ok:true}};
  await r.openNoteEditor('n1');
  assert.equal(opened,'n1');assert.equal(r.nodes.has('editor'),false);
});

test('unrelated note broadcasts do not rebuild reminder buttons or lose their focus',()=>{
  const r=renderer(async()=>assert.fail('刷新不能保存内容'),'reminder');r.render();
  const children=r.nodes.get('reminder').children;
  const next=M.copy(r.state());next.revision++;next.notes[0].title='便签另一窗口更新';r.acceptState(next);
  assert.equal(r.nodes.get('reminder').children,children);
});

test('quick add waits for IPC, blocks duplicate submit and keeps input typed during save',async()=>{
  const pending=[];const r=renderer((next,revision)=>new Promise(resolve=>pending.push(()=>resolve({ok:true,state:{...next,revision:revision+1}}))));
  await r.start();r.nodes.get('notes-tab').onclick();const input=r.nodes.get('quick-title'),submit=r.nodes.get('quick-add').onsubmit;
  const add=r.nodes.get('quick-add').querySelector('button');assert.equal(add.textContent,'保存');assert.equal(add.disabled,true);
  input.value='  ';input.oninput();assert.equal(add.disabled,true);
  input.value='快速便签';const first=submit({preventDefault(){}});await turn();
  assert.equal(add.disabled,true);
  assert.equal(r.state().notes.length,0);await submit({preventDefault(){}});assert.equal(pending.length,1);
  input.value='保存过程中输入下一条';pending.shift()();await first;
  assert.equal(add.disabled,false);
  assert.equal(r.state().notes.length,1);assert.equal(r.state().notes[0].body,'快速便签');assert.equal(input.value,'保存过程中输入下一条');
  input.events.compositionstart();await submit({preventDefault(){}});assert.equal(pending.length,0);input.events.compositionend();
  input.value='';input.oninput();assert.equal(add.disabled,true);
});

test('mouse selection clears the focus ring while keyboard navigation retains a visible target',async()=>{
  const r=renderer(async()=>assert.fail('导航无需保存'));await r.start();
  const key=r.document.events['keydown:true'],pointer=r.document.events['pointerdown:true'];
  key({key:'Tab'});assert.equal(r.document.documentElement.dataset.inputMode,'keyboard');
  pointer();assert.equal(r.document.documentElement.dataset.inputMode,'pointer');
  key({key:'a'});assert.equal(r.document.documentElement.dataset.inputMode,'pointer');
  key({key:'ArrowDown'});assert.equal(r.document.documentElement.dataset.inputMode,'keyboard');
});

test('corrupt-data actions distinguish cancel, failure and successful export/reset',async()=>{
  const r=renderer(async()=>({ok:false}));r.showStorageError('原记录读取失败',true);const box=r.nodes.get('storage-alert');
  r.bridge.exportRaw=async()=>({ok:false,cancelled:true});await box.children[1].onclick();assert.equal(r.nodes.has('toast'),false);assert.equal(box.hidden,false);
  r.bridge.exportRaw=async()=>({ok:false,message:'目录不可写'});await box.children[1].onclick();assert.equal(r.nodes.get('toast').children[0].textContent,'导出失败：目录不可写');
  r.bridge.exportRaw=async()=>({ok:true});await box.children[1].onclick();assert.equal(r.nodes.get('toast').children[0].textContent,'原数据已导出');assert.equal(box.hidden,false);
  r.bridge.reset=async()=>({ok:false,message:'磁盘不可写'});await box.children[2].onclick();assert.equal(r.nodes.get('toast').children[0].textContent,'重置失败：磁盘不可写');assert.equal(r.state().notes.length,1);
  r.bridge.reset=async()=>({ok:true,state:{schema:1,revision:1,notes:[],todos:[]}});await box.children[2].onclick();assert.equal(r.state().notes.length,0);assert.equal(box.hidden,true);assert.equal(r.nodes.get('toast').children[0].textContent,'便签与待办已重置');
});

test('quick todo created from future/search becomes visible in today with query cleared',async()=>{
  const r=renderer(async(next,revision)=>({ok:true,state:{...next,revision:revision+1}}));await r.start();
  r.nodes.get('filter').value='future';r.nodes.get('filter').onchange();r.nodes.get('search').value='搜不到新待办';r.nodes.get('search').oninput();
  r.nodes.get('quick-title').value='新待办';await r.nodes.get('quick-add').onsubmit({preventDefault(){}});
  assert.equal(r.nodes.get('filter').value,'today');assert.equal(r.nodes.get('search').value,'');assert.equal(r.nodes.get('group-title').textContent,'今天');assert.equal(r.state().todos[0].title,'新待办');assert.equal(r.state().todos[0].dueDate,M.day());
});

test('approved quit guard holds inputs while other windows wait, cancellation restores editing',async()=>{
  const r=renderer(async(next,revision)=>({ok:true,state:{...next,revision:revision+1}}));
  assert.equal(await r.beforeClose({token:'quit-1',hold:true}),true);assert.equal(r.nodes.get('desktop-note').inert,true);
  r.inputNote('n1','标题','另一窗口等待期间的输入');assert.equal(r.draft('n1'),undefined);
  r.cancelClose('unrelated-token');assert.equal(r.nodes.get('desktop-note').inert,true);
  r.cancelClose('quit-1');assert.equal(r.nodes.get('desktop-note').inert,false);r.inputNote('n1','标题','取消后继续编辑');assert.equal(r.draft('n1').body,'取消后继续编辑');
});

test('cancel arriving during flush prevents a late approval from freezing the window again',async()=>{
  const pending=[];const r=renderer((next,revision)=>new Promise(resolve=>pending.push(()=>resolve({ok:true,state:{...next,revision:revision+1}}))));
  r.inputNote('n1','标题','第一份末段');const close=r.beforeClose({token:'quit-2',hold:true});await turn();
  r.cancelClose('quit-2');r.inputNote('n1','标题','取消后新增末段');pending.shift()();await turn();pending.shift()();
  assert.equal(await close,false);assert.equal(r.nodes.get('desktop-note').inert,false);assert.equal(r.state().notes[0].body,'取消后新增末段');
});

test('active notes expose independent favorite and pin toggles, while trash and todos have neither',async()=>{
  const r=renderer(async(next,revision)=>({ok:true,state:{...next,revision:revision+1}}));await r.start();
  const note=M.newNote('常用便签','正文');note.id='n1';r.acceptState({schema:1,revision:1,notes:[note],todos:[]});r.nodes.get('notes-tab').onclick();
  const buttons=className=>{const found=[];const visit=el=>{if(el.className===className)found.push(el);for(const child of el.children||[])visit(child)};visit(r.nodes.get('records'));return found};
  const stars=()=>buttons('favorite-button'),pins=()=>buttons('pin-button');
  const heading=r.nodes.get('records').children[0].children[0].children[0];
  assert.deepEqual(Array.from(heading.children,item=>item.className),['record-title','pin-button','favorite-button']);
  assert.equal(stars().length,1);assert.equal(stars()[0].attributes['aria-pressed'],'false');assert.equal(stars()[0].attributes['aria-label'],'收藏：常用便签');assert.equal(stars()[0].title,'收藏便签 · 优先显示');
  assert.equal(pins().length,1);assert.equal(pins()[0].attributes['aria-pressed'],'false');assert.equal(pins()[0].attributes['aria-label'],'置顶：常用便签');
  await pins()[0].onclick();assert.equal(r.state().notes[0].pinned,true);assert.equal(r.state().notes[0].favorite,false);assert.equal(pins()[0].attributes['aria-pressed'],'true');assert.equal(pins()[0].attributes['aria-label'],'取消置顶：常用便签');
  await stars()[0].onclick();assert.equal(r.state().notes[0].favorite,true);assert.equal(r.state().notes[0].pinned,true);assert.equal(stars()[0].attributes['aria-pressed'],'true');assert.equal(stars()[0].attributes['aria-label'],'取消收藏：常用便签');assert.equal(stars()[0].title,'已收藏 · 点击取消');
  await pins()[0].onclick();assert.equal(r.state().notes[0].pinned,false);assert.equal(r.state().notes[0].favorite,true);assert.equal(pins()[0].attributes['aria-pressed'],'false');
  await stars()[0].onclick();assert.equal(r.state().notes[0].favorite,false);assert.equal(stars()[0].attributes['aria-pressed'],'false');assert.equal(r.state().notes[0].updatedAt,note.updatedAt);
  r.acceptState(M.change(r.state(),'note','n1','trash'));r.nodes.get('filter').value='trash';r.nodes.get('filter').onchange();assert.equal(stars().length,0);assert.equal(pins().length,0);
  const next=M.copy(r.state());next.revision++;next.todos.push(M.newTodo('今天的待办'));r.acceptState(next);r.nodes.get('todos-tab').onclick();assert.equal(r.nodes.get('records').children.length,1);assert.equal(stars().length,0);assert.equal(pins().length,0);
});

test('note ordering follows pin then favorite then updated time and repositions on cancellation',async()=>{
  const r=renderer(async(next,revision)=>({ok:true,state:{...next,revision:revision+1}}));await r.start();
  const notes=[M.newNote('固定旧','',10),M.newNote('固定收藏','',5),M.newNote('常用收藏','',20),M.newNote('新普通','',100),M.newNote('旧普通','',50)];
  notes[0].pinned=true;notes[1].pinned=true;notes[1].favorite=true;notes[2].favorite=true;
  r.acceptState({schema:1,revision:1,notes,todos:[]});r.nodes.get('notes-tab').onclick();
  const rows=()=>r.nodes.get('records').children,heading=row=>row.children[0].children[0],names=()=>Array.from(rows(),row=>heading(row).children[0].textContent);
  const toggle=(title,className)=>heading(rows().find(row=>heading(row).children[0].textContent===title)).children.find(item=>item.className===className).onclick();
  assert.deepEqual(names(),['固定收藏','固定旧','常用收藏','新普通','旧普通']);
  await toggle('旧普通','pin-button');assert.deepEqual(names(),['固定收藏','旧普通','固定旧','常用收藏','新普通']);
  await toggle('旧普通','pin-button');assert.deepEqual(names(),['固定收藏','固定旧','常用收藏','新普通','旧普通']);
  await toggle('常用收藏','favorite-button');assert.deepEqual(names(),['固定收藏','固定旧','新普通','旧普通','常用收藏']);
  const trash=M.copy(r.state());trash.revision++;trash.notes.forEach((note,index)=>note.deletedAt=1000+index);r.acceptState(trash);r.nodes.get('filter').value='trash';r.nodes.get('filter').onchange();
  assert.deepEqual(names(),['新普通','旧普通','常用收藏','固定旧','固定收藏']);
});


test('organize previews without saving, applies only after confirmation and undo restores text',async()=>{
  let saves=0;const r=renderer(async(next,revision)=>{saves++;return{ok:true,state:{...next,revision:revision+1}}});
  r.bridge.organizeNote=async snapshot=>{assert.equal(snapshot.body,'初始内容');return{ok:true,result:{title:'整理标题',body:'1. 初始内容'}}};
  await r.openOrganize('n1');assert.equal(await r.generateOrganized(),true);assert.equal(saves,0);assert.equal(r.state().notes[0].body,'初始内容');assert.equal(r.nodes.get('organize-result-body').value,'1. 初始内容');
  assert.equal(await r.applyOrganized(),true);assert.equal(saves,1);assert.equal(r.state().notes[0].body,'1. 初始内容');
  await r.nodes.get('toast').children[1].onclick();assert.equal(r.state().notes[0].title,'标题');assert.equal(r.state().notes[0].body,'初始内容');assert.equal(saves,2);
});

test('organize failure and cancellation preserve content and ignore late results',async()=>{
  const r=renderer(async()=>assert.fail('整理失败或取消不应写入'));r.bridge.organizeNote=async()=>({ok:false,message:'请先登录 Codex'});
  await r.openOrganize('n1');assert.equal(await r.generateOrganized(),false);assert.equal(r.nodes.get('organize-error').textContent,'请先登录 Codex');assert.equal(r.state().notes[0].body,'初始内容');
  let resolve,cancelled=0;r.bridge.organizeNote=()=>new Promise(r=>resolve=r);r.bridge.cancelOrganize=async()=>{cancelled++};
  const generating=r.generateOrganized();await r.closeOrganize();resolve({ok:true,result:{title:'迟到',body:'不应出现'}});assert.equal(await generating,false);assert.equal(cancelled,1);assert.equal(r.nodes.get('organize').open,false);assert.equal(r.state().notes[0].body,'初始内容');
});

test('organize does not overwrite edits made during generation or accept empty output',async()=>{
  let saves=0;const r=renderer(async(next,revision)=>{saves++;return{ok:true,state:{...next,revision:revision+1}}});
  r.bridge.organizeNote=async()=>({ok:true,result:{title:'整理',body:'原文整理'}});await r.openOrganize('n1');await r.generateOrganized();
  const changed=M.copy(r.state());changed.revision++;changed.notes[0].body='另一窗口的新内容';changed.notes[0].updatedAt++;r.acceptState(changed);
  assert.equal(await r.applyOrganized(),false);assert.equal(saves,0);assert.equal(r.state().notes[0].body,'另一窗口的新内容');assert.match(r.nodes.get('organize-error').textContent,/未覆盖/);assert.equal(await r.beforeClose(),true);
  r.bridge.organizeNote=async()=>({ok:true,result:{title:'',body:''}});await r.openOrganize('n1');assert.equal(await r.generateOrganized(),false);assert.equal(saves,0);
});

test('note rows label only notes currently displayed on desktop',async()=>{
  const r=renderer(async()=>assert.fail('状态展示不应写入'),'panel');await r.start();
  const hidden=M.newNote('列表便签','正文'),shown=M.newNote('桌面便签','正文');shown.desktopOpen=true;shown.pinned=true;
  r.acceptState({schema:1,revision:1,notes:[hidden,shown],todos:[]});r.nodes.get('notes-tab').onclick();
  const status=[];const visit=el=>{if(el.className==='note-status is-open')status.push(el.textContent);for(const child of el.children||[])visit(child)};visit(r.nodes.get('records'));
  assert.deepEqual(status,['桌面显示中 · 置顶']);
});


test('group counts match full lists and remain visible during search; empty descriptions take no space',async()=>{
  const r=renderer(async(next,revision)=>({ok:true,state:{...next,revision:revision+1}}));await r.start();
  const notes=[M.newNote('桌面常用','正文'),M.newNote('普通','正文'),M.newNote('删除','正文')];notes[0].desktopOpen=true;notes[0].favorite=true;notes[2].favorite=true;notes[2].deletedAt=notes[2].createdAt;
  const todos=['今天','明天','逾期','无日期','完成','归档','删除'].map(title=>M.newTodo(title));todos[1].dueDate=M.plusDay(1);todos[2].dueDate=M.plusDay(-1);todos[3].dueDate='';
  for(const index of [4,5]){todos[index].completed=true;todos[index].completedAt=todos[index].createdAt}todos[5].archived=true;todos[6].deletedAt=todos[6].createdAt;
  r.acceptState({schema:1,revision:1,notes,todos});r.nodes.get('notes-tab').onclick();
  const labels=()=>Array.from(r.nodes.get('filter').children,n=>n.textContent),setFilter=value=>{r.nodes.get('filter').value=value;r.nodes.get('filter').onchange()};
  assert.deepEqual(labels(),['全部便签 2','收藏 1','桌面显示中 1','回收站 1']);
  r.nodes.get('search').value='没有匹配';r.nodes.get('search').oninput();assert.deepEqual(labels(),['全部便签 2','收藏 1','桌面显示中 1','回收站 1']);
  r.nodes.get('todos-tab').onclick();assert.deepEqual(labels(),['全部待办 6','今天 2','逾期 1','未来 1','无日期 1','已完成 1','已归档 1','回收站 1']);
  assert.equal(r.nodes.get('records').children.length,2);assert.equal(r.nodes.get('group-count').hidden,false);assert.equal(r.nodes.get('list-description').hidden,true);assert.equal(Array.from(r.nodes.get('progress-text').children,n=>n.textContent).join(''),'已完成 2 / 3');
  setFilter('future');assert.equal(r.nodes.get('records').children.length,1);assert.equal(r.nodes.get('list-description').hidden,true);assert.equal(r.nodes.get('progress-text').hidden,true);
  setFilter('all');assert.equal(r.nodes.get('records').children.length,6);assert.equal(r.nodes.get('group-title').textContent,'全部待办');assert.equal(r.nodes.get('list-description').hidden,true);
});


test('panel front toggle acknowledges native state and never changes note ordering or pin state',async()=>{
  const r=renderer(async()=>assert.fail('面板置顶不能写入便签'),'panel');await r.start();
  const n=M.newNote('普通便签','正文');r.acceptState({schema:1,revision:1,notes:[n],todos:[]});const before=JSON.stringify(r.state());
  const button=r.nodes.get('pin-panel');assert.equal(button.attributes['aria-pressed'],'false');assert.equal(button.textContent,'窗口置顶');
  await button.onclick();assert.equal(button.attributes['aria-pressed'],'true');assert.equal(button.title,'取消主面板置顶');assert.equal(button.textContent,'取消置顶');assert.equal(JSON.stringify(r.state()),before);
  r.bridge.pinPanel=async()=>({ok:false,message:'窗口已关闭'});await button.onclick();assert.equal(button.attributes['aria-pressed'],'true');assert.equal(button.disabled,false);assert.equal(JSON.stringify(r.state()),before);
  r.bridge.pinPanel=async value=>({ok:true,pinned:value});await button.onclick();assert.equal(button.attributes['aria-pressed'],'false');
});

test('single and summary reminders use a clear label and keep their original action routing',async()=>{
  const r=renderer(async()=>assert.fail('提醒不能覆盖记录'),'reminder'),calls=[];let listener;
  const todo=M.newTodo('给妈妈打电话');todo.reminderAt=Date.now();todo.occurrenceId='occurrence';
  r.bridge.load=async()=>({mode:'reminder',state:r.state(),reminder:{items:[todo],activeId:todo.id,occurrenceId:todo.occurrenceId}});
  r.bridge.onReminder=fn=>{listener=fn};r.bridge.actionReminder=async(...args)=>{calls.push(args);return{ok:true}};await r.start();
  const box=r.nodes.get('reminder'),heading=box.children[0].children[0];assert.equal(heading.children[0].children[0].textContent,'待办提醒');assert.match(heading.children[1].textContent,/今天/);assert.equal(box.children[1].textContent,todo.title);
  await box.children[2].children[1].onclick();assert.deepEqual(calls[0],[todo.id,todo.occurrenceId,'snooze']);
  listener({summary:true,items:[todo]});assert.equal(box.children[0].children[0].children[0].children[0].textContent,'待办提醒');assert.equal(Array.from(box.children[0].children[0].children[1].children,n=>n.textContent).join(''),'1 项未处理');assert.equal(box.children[0].children[0].children[1].children[0].className,'reminder-count');await box.children[3].onclick();assert.deepEqual(calls[1],[null,null,'process']);
});

test('quick textarea grows with input, keeps Shift+Enter native and saves Enter without submitting IME composition',async()=>{
  let saves=0;const r=renderer(async(next,revision)=>{saves++;return{ok:true,state:{...next,revision:revision+1}}},'panel');await r.start();r.nodes.get('notes-tab').onclick();
  const input=r.nodes.get('quick-title'),form=r.nodes.get('quick-add');let requests=0,submitted,prevented=0;form.requestSubmit=()=>{requests++;submitted=form.onsubmit({preventDefault(){}})};
  input.value='第一行\n第二行\n第三行';input.scrollHeight=72;input.oninput();assert.equal(input.style.height,'72px');const key=extra=>({key:'Enter',preventDefault(){prevented++},...extra});
  input.onkeydown(key({shiftKey:true}));assert.equal(requests,0);assert.equal(prevented,0);assert.equal(input.value,'第一行\n第二行\n第三行');
  input.events.compositionstart();input.onkeydown(key());assert.equal(requests,0);input.events.compositionend();input.onkeydown(key({isComposing:true}));input.onkeydown(key({keyCode:229}));assert.equal(requests,0);assert.equal(saves,0);
  r.nodes.get('todos-tab').onclick();assert.equal(input.value,'第一行\n第二行\n第三行');assert.equal(saves,0);r.nodes.get('notes-tab').onclick();input.scrollHeight=24;input.onkeydown(key());await submitted;
  assert.equal(requests,1);assert.equal(prevented,1);assert.equal(saves,1);assert.equal(r.state().notes[0].body,'第一行\n第二行\n第三行');assert.equal(input.value,'');assert.equal(input.style.height,'24px');
});

test('quick textarea retains long multiline input on write failure and keeps note/todo length limits',async()=>{
  let saves=0;const r=renderer(async()=>{saves++;return{ok:false,message:'磁盘不可写'}},'panel');await r.start();r.nodes.get('notes-tab').onclick();const input=r.nodes.get('quick-title'),form=r.nodes.get('quick-add');let submitted;form.requestSubmit=()=>submitted=form.onsubmit({preventDefault(){}});
  const text='需要完整保留的长便签\n'.repeat(100);input.value=text;input.scrollHeight=600;input.oninput();input.onkeydown({key:'Enter',preventDefault(){}});await submitted;
  assert.equal(saves,1);assert.equal(input.value,text);assert.equal(input.style.height,'600px');assert.equal(r.state().notes.length,0);assert.equal(r.nodes.get('quick-add').querySelector('button').disabled,false);assert.equal(r.nodes.get('storage-alert').hidden,false);
  input.value='字'.repeat(20001);await form.onsubmit({preventDefault(){}});assert.equal(saves,1);assert.equal(input.value.length,20001);assert.match(r.nodes.get('toast').children[0].textContent,/20,000/);
  r.nodes.get('todos-tab').onclick();input.value='字'.repeat(201);await form.onsubmit({preventDefault(){}});assert.equal(saves,1);assert.equal(input.value.length,201);assert.match(r.nodes.get('toast').children[0].textContent,/200 字/);
});
