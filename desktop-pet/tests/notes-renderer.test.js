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
    'window.check={commit,inputNote,flushNote,flushAll,copyNote,beforeClose,acceptState,start,showStorageError,cancelClose,openNoteEditor,openCategoryManager,openNewCategory,openDeleteCategory,openMoveCategory,submitQuick,openOrganize,generateOrganized,applyOrganized,closeOrganize,render,state:()=>state,draft:id=>drafts.get(id)};');
  const window={QiuModel:M,qiuNotes:bridge,addEventListener(){}};
  vm.runInNewContext(source,{window,document,location:{search:`?mode=${mode}&id=n1`},URLSearchParams,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},confirm:()=>false,console});
  const n=M.newNote('标题','初始内容');n.id='n1';window.check.acceptState({schema:1,revision:0,notes:[n],todos:[]});
  return {...window.check,clipboard,nodes,bridge,document};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const menuItem=(r,id,label)=>{const item=r.nodes.get(id).children.find(n=>n.children?.[1]?.textContent===label);assert.ok(item,`${id}: ${label}`);return item};
const menuLabels=(r,id)=>Array.from(r.nodes.get(id).children.filter(n=>n.children?.some(c=>c.className==='view-count')),n=>`${n.children[1].textContent} ${n.children[2].textContent}`);
const manageEntry=r=>r.nodes.get('category-menu').children[0]?.children?.find(n=>n.id==='manage-categories');

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
  const add=r.nodes.get('quick-save');assert.equal(add.textContent,'保存');assert.equal(add.disabled,true);
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
  const labels=()=>Array.from(r.nodes.get('filter-menu').children.filter(n=>n.children?.some(c=>c.className==='view-count')).slice(0,r.nodes.get('notes-tab').attributes['aria-selected']==='true'?4:8),n=>n.children[1].textContent+' '+n.children[2].textContent),setFilter=value=>{r.nodes.get('filter').value=value;r.nodes.get('filter').onchange()};
  assert.deepEqual(labels(),['全部便签 2','收藏 1','桌面显示中 1','回收站 1']);
  r.nodes.get('search').value='没有匹配';r.nodes.get('search').oninput();assert.deepEqual(labels(),['全部便签 2','收藏 1','桌面显示中 1','回收站 1']);
  r.nodes.get('todos-tab').onclick();assert.deepEqual(labels(),['全部待办 6','今天 2','逾期 1','未来 1','无日期 1','已完成 1','已归档 1','回收站 1']);
  assert.equal(r.nodes.get('records').children.length,2);assert.equal(r.nodes.has('group-count'),false);assert.equal(r.nodes.get('list-description').hidden,true);assert.equal(Array.from(r.nodes.get('progress-text').children,n=>n.textContent).join(''),'已完成 2 / 3');
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
  assert.equal(saves,1);assert.equal(input.value,text);assert.equal(input.style.height,'88px');assert.equal(r.state().notes.length,0);assert.equal(r.nodes.get('quick-save').disabled,false);assert.equal(r.nodes.get('storage-alert').hidden,false);
  input.value='字'.repeat(20001);await form.onsubmit({preventDefault(){}});assert.equal(saves,1);assert.equal(input.value.length,20001);assert.match(r.nodes.get('toast').children[0].textContent,/20,000/);
  r.nodes.get('todos-tab').onclick();input.value='字'.repeat(201);await form.onsubmit({preventDefault(){}});assert.equal(saves,1);assert.equal(input.value.length,201);assert.match(r.nodes.get('toast').children[0].textContent,/200 字/);
});

test('status and category filters intersect with reciprocal counts, including trash, without changing notes',async()=>{
  const r=renderer(async()=>assert.fail('筛选分类不能保存或关闭窗口'),'panel');await r.start();let s=M.addCategory(r.state(),'工作');s=M.addCategory(s,'生活');const [work,life]=s.categories;
  const notes=['工作常用','工作普通','生活常用','未分类常用','删除工作','删除生活'].map(title=>M.newNote(title,'正文'));
  for(const i of [0,1,4])notes[i].categoryId=work.id;for(const i of [2,5])notes[i].categoryId=life.id;for(const i of [0,2,3])notes[i].favorite=true;notes[0].desktopOpen=true;for(const i of [4,5])notes[i].deletedAt=notes[i].createdAt;s.notes=notes;r.acceptState(s);r.nodes.get('notes-tab').onclick();const before=JSON.stringify(r.state());
  assert.equal(r.nodes.get('group-heading').hidden,true);assert.equal(r.nodes.get('filter-label').textContent,'状态');assert.equal(r.nodes.get('filter').title,'状态：全部便签 · 4 条');assert.equal(r.nodes.get('category-filter-label').textContent,'分类');assert.equal(r.nodes.get('category-filter').title,'分类：全部分类');
  assert.deepEqual(menuLabels(r,'filter-menu'),['全部便签 4','收藏 3','桌面显示中 1','回收站 2']);assert.deepEqual(menuLabels(r,'category-menu'),['全部分类 4','未分类 1','工作 2','生活 1']);
  await menuItem(r,'category-menu','工作').onclick();assert.equal(r.nodes.get('group-heading').hidden,false);assert.equal(r.nodes.get('records').children.length,2);assert.equal(r.nodes.get('group-title').textContent,'全部便签 · 工作');assert.equal(r.nodes.get('quick-category-select').value,work.id);
  assert.deepEqual(menuLabels(r,'filter-menu'),['全部便签 2','收藏 1','桌面显示中 1','回收站 1']);
  await menuItem(r,'filter-menu','收藏').onclick();assert.equal(r.nodes.get('records').children.length,1);assert.equal(r.nodes.get('filter-label').textContent,'状态');assert.equal(r.nodes.get('filter').title,'状态：收藏 · 1 条');assert.deepEqual(menuLabels(r,'category-menu'),['全部分类 3','未分类 1','工作 1','生活 1']);
  await manageEntry(r).onclick();assert.equal(r.nodes.get('uncategorized-count').textContent,'1 条 · 固定分类');assert.equal(r.nodes.get('category-list').children[0].children[1].textContent,'2 条');r.nodes.get('category-manager-done').onclick();
  await menuItem(r,'filter-menu','回收站').onclick();assert.equal(r.nodes.get('records').children.length,1);assert.equal(r.nodes.get('group-title').textContent,'回收站 · 工作');assert.deepEqual(menuLabels(r,'category-menu'),['全部分类 2','未分类 0','工作 1','生活 1']);
  await menuItem(r,'category-menu','生活').onclick();assert.equal(r.nodes.get('group-title').textContent,'回收站 · 生活');assert.equal(r.nodes.get('records').children.length,1);
  await menuItem(r,'category-menu','全部分类').onclick();assert.equal(r.nodes.get('records').children.length,2);assert.equal(JSON.stringify(r.state()),before);await menuItem(r,'filter-menu','全部便签').onclick();assert.equal(r.nodes.get('group-heading').hidden,true);r.nodes.get('todos-tab').onclick();assert.equal(r.nodes.get('group-heading').hidden,false);
});

test('quick notes inherit category, keep explicit override for another entry, and reset on switching views',async()=>{
  const r=renderer(async(next,revision)=>({ok:true,state:{...next,revision:revision+1}}),'panel');await r.start();let s=M.addCategory(r.state(),'工作');s=M.addCategory(s,'生活');r.acceptState(s);r.nodes.get('notes-tab').onclick();const [work,life]=r.state().categories;
  await menuItem(r,'category-menu','工作').onclick();r.nodes.get('quick-title').value='工作正文';assert.equal(await r.submitQuick(),true);assert.equal(r.state().notes[0].categoryId,work.id);assert.equal(r.nodes.get('filter').value,'all');assert.equal(r.nodes.get('category-filter-label').textContent,'分类');assert.equal(r.nodes.get('category-filter').title,'分类：工作');
  const picker=r.nodes.get('quick-category-select');picker.value=life.id;picker.onchange();r.nodes.get('quick-title').value='生活正文';await r.submitQuick();assert.equal(r.state().notes[1].categoryId,life.id);assert.equal(picker.value,life.id);
  await menuItem(r,'category-menu','全部分类').onclick();assert.equal(picker.value,'');r.nodes.get('quick-title').value='未分类正文';await r.submitQuick();assert.equal(r.state().notes[2].categoryId,'');
  await menuItem(r,'category-menu','工作').onclick();r.nodes.get('todos-tab').onclick();assert.equal(r.nodes.get('category-filter-control').hidden,true);r.nodes.get('notes-tab').onclick();assert.equal(picker.value,'');assert.equal(r.nodes.get('category-filter-label').textContent,'分类');assert.equal(r.nodes.get('category-filter').title,'分类：全部分类');
});

test('filter popovers are mutually exclusive and close on Escape, outside click and tab changes',async()=>{
  const r=renderer(async()=>assert.fail('菜单开关不应保存'),'panel');await r.start();r.nodes.get('notes-tab').onclick();
  const status=r.nodes.get('filter'),category=r.nodes.get('category-filter'),statusMenu=r.nodes.get('filter-menu'),categoryMenu=r.nodes.get('category-menu');
  status.onclick();assert.equal(statusMenu.hidden,false);assert.equal(categoryMenu.hidden,true);assert.equal(status.attributes['aria-expanded'],'true');
  category.onclick();assert.equal(statusMenu.hidden,true);assert.equal(categoryMenu.hidden,false);assert.equal(status.attributes['aria-expanded'],'false');
  let prevented=0;categoryMenu.onkeydown({key:'Escape',preventDefault(){prevented++}});assert.equal(categoryMenu.hidden,true);assert.equal(category.attributes['aria-expanded'],'false');assert.equal(prevented,1);
  status.onclick();status.onkeydown({key:'Escape',preventDefault(){prevented++}});assert.equal(statusMenu.hidden,true);assert.equal(prevented,2);
  category.onclick();const pointer=r.document.events['pointerdown:false'];pointer({target:{closest:()=>({})}});assert.equal(categoryMenu.hidden,false);pointer({target:{closest:()=>null}});assert.equal(categoryMenu.hidden,true);assert.equal(statusMenu.hidden,true);
  status.onclick();r.document.events['keydown:false']({key:'Escape',preventDefault(){prevented++}});assert.equal(statusMenu.hidden,true);
  category.onclick();r.nodes.get('todos-tab').onclick();assert.equal(categoryMenu.hidden,true);assert.equal(statusMenu.hidden,true);assert.equal(r.nodes.get('category-filter-control').hidden,true);assert.equal(categoryMenu.children.length,0);category.onclick();assert.equal(categoryMenu.hidden,true);assert.equal(statusMenu.children.length,8);
});

test('deleting the selected category falls back to uncategorized without changing the status filter or note contents',async()=>{
  let saves=0;const r=renderer(async(next,revision)=>{saves++;return{ok:true,state:{...next,revision:revision+1}}},'panel');await r.start();let s=M.addCategory(r.state(),'工作');s=M.addCategory(s,'生活');const [work,life]=s.categories;
  const active=M.newNote('工作便签','完整正文'),trashed=M.newNote('删除便签','回收站正文'),other=M.newNote('生活便签','生活正文');active.categoryId=trashed.categoryId=work.id;trashed.deletedAt=trashed.createdAt;other.categoryId=life.id;s.notes=[active,trashed,other];r.acceptState(s);r.nodes.get('notes-tab').onclick();
  await menuItem(r,'category-menu','工作').onclick();await r.openNoteEditor();assert.equal(r.nodes.get('edit-note-category').value,work.id);await r.nodes.get('editor-close').onclick();
  await menuItem(r,'filter-menu','回收站').onclick();r.openDeleteCategory(work.id);await r.nodes.get('delete-category-confirm').onclick();
  assert.equal(saves,1);assert.equal(r.nodes.get('filter').value,'trash');assert.equal(r.nodes.get('category-filter-label').textContent,'分类');assert.equal(r.nodes.get('category-filter').title,'分类：未分类');assert.equal(r.nodes.get('group-title').textContent,'回收站 · 未分类');assert.equal(r.nodes.get('records').children.length,1);assert.equal(r.nodes.get('quick-category-select').value,'');
  assert.equal(r.state().notes[0].body,'完整正文');assert.equal(r.state().notes[1].body,'回收站正文');assert.equal(r.state().notes[1].deletedAt,trashed.deletedAt);assert.equal(r.state().notes[0].categoryId,'');assert.equal(r.state().notes[1].categoryId,'');assert.deepEqual(menuLabels(r,'category-menu'),['全部分类 1','未分类 1','生活 0']);
  await menuItem(r,'category-menu','生活').onclick();r.acceptState(M.deleteCategory(r.state(),life.id));assert.equal(r.nodes.get('category-filter-label').textContent,'分类');assert.equal(r.nodes.get('category-filter').title,'分类：未分类');assert.equal(r.nodes.get('filter').value,'trash');assert.equal(saves,1);
});

test('category menu heading exposes management only for notes and saves a new category',async()=>{
  let saves=0;const r=renderer(async(next,revision)=>{saves++;return{ok:true,state:{...next,revision:revision+1}}},'panel');await r.start();
  assert.equal(r.nodes.get('category-filter-control').hidden,true);assert.equal(manageEntry(r),undefined);
  r.nodes.get('notes-tab').onclick();const entry=manageEntry(r);assert.equal(r.nodes.get('category-filter-control').hidden,false);assert.equal(r.nodes.get('category-menu').children[0].className,'category-menu-heading');assert.equal(entry.textContent,'管理');assert.equal(entry.attributes['aria-label'],'管理分类');assert.equal(typeof entry.onclick,'function');assert.equal(r.nodes.get('filter-menu').children.length,4);
  r.nodes.get('category-filter').onclick();await entry.onclick();assert.equal(r.nodes.get('category-menu').hidden,true);assert.equal(r.nodes.get('filter-menu').hidden,true);assert.equal(r.nodes.get('category-manager').open,true);assert.equal(saves,0);
  r.nodes.get('category-add').onclick();assert.equal(r.nodes.get('category-manager').open,false);assert.equal(r.nodes.get('new-category').open,true);
  r.nodes.get('new-category-name').value='旅行';await r.nodes.get('new-category-form').onsubmit({preventDefault(){}});
  assert.equal(saves,1);assert.equal(r.state().categories[0].name,'旅行');assert.equal(r.nodes.get('new-category').open,false);assert.equal(r.nodes.get('category-manager').open,true);assert.ok(menuItem(r,'category-menu','旅行'));
  r.nodes.get('category-manager-done').onclick();r.nodes.get('todos-tab').onclick();assert.equal(r.nodes.get('category-filter-control').hidden,true);assert.equal(manageEntry(r),undefined);
  r.nodes.get('notes-tab').onclick();await manageEntry(r).onclick();assert.equal(r.nodes.get('category-manager').open,true);assert.equal(saves,1);
});

test('category manager supports inline validation, Enter save, Escape cancel, and sorting',async()=>{
  let saves=0;const r=renderer(async(next,revision)=>{saves++;return{ok:true,state:{...next,revision:revision+1}}},'panel');await r.start();let s=M.addCategory(r.state(),'工作');s=M.addCategory(s,'生活');r.acceptState(s);r.nodes.get('notes-tab').onclick();await manageEntry(r).onclick();
  const list=r.nodes.get('category-list');assert.equal(list.children[0].children[2].disabled,true);await list.children[0].children[4].onclick();await list.children[1].children[0].onclick();
  const input=list.children[0].children[0];input.value='生活';input.oninput();await list.children[0].children[1].onclick();assert.equal(saves,0);assert.match(list.children[1].textContent,/已存在/);assert.equal(input.value,'生活');assert.equal(r.nodes.get('storage-alert')?.hidden??true,true);
  input.value='新的工作';input.oninput();input.onkeydown({key:'Enter',preventDefault(){}});await turn();assert.equal(r.state().categories[0].name,'新的工作');assert.equal(saves,1);
  await list.children[0].children[4].onclick();await list.children[1].children[0].onclick();const rename=list.children[0].children[0];rename.value='不应保存';rename.oninput();rename.onkeydown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(r.state().categories[0].name,'新的工作');
  const first=r.state().categories[0].id;await list.children[0].children[3].onclick();assert.equal(r.state().categories[1].id,first);assert.equal(saves,2);
});

test('add category failure keeps the independent dialog and name, cancellation returns to management',async()=>{
  const r=renderer(async()=>({ok:false,message:'磁盘不可写'}),'panel');await r.start();r.openCategoryManager();r.openNewCategory();const input=r.nodes.get('new-category-name');input.value='旅行';await r.nodes.get('new-category-form').onsubmit({preventDefault(){}});
  assert.equal(r.nodes.get('new-category').open,true);assert.equal(input.value,'旅行');assert.match(r.nodes.get('new-category-error').textContent,/磁盘不可写/);assert.equal(r.state().categories.length,0);r.nodes.get('new-category-cancel').onclick();assert.equal(r.nodes.get('new-category').open,false);assert.equal(r.nodes.get('category-manager').open,true);assert.equal(await r.beforeClose(),true);
});

test('category movement and deletion never overwrite an unsaved desktop body or other note fields',async()=>{
  const r=renderer(async(next,revision)=>({ok:true,state:{...next,revision:revision+1}}),'note');await r.start();let s=M.addCategory(r.state(),'工作');const category=s.categories[0].id,n=M.newNote('标题','已保存正文');n.id='n1';n.categoryId=category;n.desktopOpen=true;n.pinned=true;n.favorite=true;const deleted=M.newNote('删除便签','回收站正文');deleted.categoryId=category;deleted.deletedAt=deleted.createdAt;s.notes=[n,deleted];r.acceptState(s);r.inputNote('n1','标题','桌面正在输入的完整正文');
  const moved=M.moveNoteCategory(r.state(),'n1','');r.acceptState(moved);assert.equal(await r.flushNote('n1'),true);assert.equal(r.state().notes[0].body,'桌面正在输入的完整正文');assert.equal(r.state().notes[0].categoryId,'');assert.equal(r.state().notes[0].desktopOpen,true);assert.equal(r.state().notes[0].pinned,true);assert.equal(r.state().notes[0].favorite,true);
  r.inputNote('n1','标题','删除分类期间继续输入');r.openDeleteCategory(category);await r.nodes.get('delete-category-confirm').onclick();assert.equal(await r.flushNote('n1'),true);assert.equal(r.state().notes[0].body,'删除分类期间继续输入');assert.equal(r.state().notes[1].body,'回收站正文');assert.equal(r.state().notes[1].deletedAt,deleted.deletedAt);assert.equal(r.state().notes[1].categoryId,'');
});

test('new note category chosen before text survives an empty autosave',async()=>{
  const r=renderer(async(next,revision)=>({ok:true,state:{...next,revision:revision+1}}),'panel');await r.start();r.acceptState(M.addCategory(r.state(),'灵感'));await r.openNoteEditor();const select=r.nodes.get('edit-note-category');select.value=r.state().categories[0].id;select.onchange();
  // Empty note autosave does not create a record; later input uses the same editor seed.
  assert.equal(await r.flushAll(),true);assert.equal(r.state().notes.length,0);r.nodes.get('edit-note-body').value='后来输入的正文';r.nodes.get('edit-note-body').oninput();assert.equal(await r.flushAll(),true);assert.equal(r.state().notes[0].body,'后来输入的正文');assert.equal(r.state().notes[0].categoryId,select.value);
});

test('quick deadline and reminder save independently, reject past time and reset only saved reminder',async()=>{
  const r=renderer(async(next,revision)=>({ok:true,state:{...next,revision:revision+1}}),'panel');await r.start();r.nodes.get('quick-due').onclick();r.nodes.get('quick-due-date').value='';r.nodes.get('quick-due-form').onsubmit({preventDefault(){}});
  r.nodes.get('quick-reminder').onclick();r.nodes.get('quick-reminder-date').value=M.plusDay(-1);r.nodes.get('quick-reminder-time').value='09:00';r.nodes.get('quick-reminder-form').onsubmit({preventDefault(){}});assert.match(r.nodes.get('quick-reminder-error').textContent,/已过去/);assert.equal(r.nodes.get('quick-reminder-dialog').open,true);
  r.nodes.get('quick-reminder-date').value=M.plusDay(1);r.nodes.get('quick-reminder-time').value='09:00';r.nodes.get('quick-reminder-form').onsubmit({preventDefault(){}});r.nodes.get('quick-title').value='有提醒无截止';await r.submitQuick();const item=r.state().todos[0];assert.equal(item.dueDate,'');assert.equal(item.reminderAt,new Date(M.plusDay(1)+'T09:00').getTime());assert.equal(item.reminderState,'pending');assert.ok(item.occurrenceId);assert.equal(r.nodes.get('quick-reminder-label').textContent,'提醒');
  r.nodes.get('quick-title').value='第二项没有提醒';await r.submitQuick();assert.equal(r.state().todos[1].dueDate,'');assert.equal(r.state().todos[1].reminderAt,null);assert.equal(r.state().todos[1].reminderState,'none');
});

test('closing saves quick input including typing during an in-flight write, and failure keeps the text',async()=>{
  const pending=[];const r=renderer((next,revision)=>new Promise(resolve=>pending.push(()=>resolve({ok:true,state:{...next,revision:revision+1}}))),'panel');await r.start();r.nodes.get('notes-tab').onclick();const input=r.nodes.get('quick-title');input.value='关闭前第一条';const closing=r.beforeClose();await turn();input.value='保存时输入的最后一条';pending.shift()();await turn();pending.shift()();assert.equal(await closing,true);assert.deepEqual(Array.from(r.state().notes,n=>n.body),['关闭前第一条','保存时输入的最后一条']);assert.equal(input.value,'');
  const failed=renderer(async()=>({ok:false,message:'磁盘不可写'}),'panel');await failed.start();failed.nodes.get('quick-title').value='未保存的新待办';assert.equal(await failed.beforeClose(),false);assert.equal(failed.nodes.get('quick-title').value,'未保存的新待办');assert.equal(failed.nodes.get('save-guard').open,true);
});

test('notes appearance initializes and broadcasts for panel, desktop note and reminder without saving',async()=>{
  for(const mode of ['panel','note','reminder']){const r=renderer(async()=>assert.fail('主题切换不能写入便签'),mode);let update;r.bridge.onAppearance=fn=>{update=fn};r.bridge.load=async()=>({mode,state:r.state(),notesAppearance:'dark'});await r.start();assert.equal(r.document.documentElement.dataset.notesAppearance,'dark');update('light');assert.equal(r.document.documentElement.dataset.notesAppearance,'light');r.document.documentElement.dataset.colorMode='accessible';update('dark');assert.equal(r.document.documentElement.dataset.colorMode,'accessible')}
  for(const file of ['notes.css','chat.css']){
    const css=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    assert.match(css,/animation: inputBeamOrbit 5\.625s linear infinite/);
    assert.doesNotMatch(css,/:hover[^{}]*\{[^}]*animation(?:-duration)?\s*:/,'hover must preserve the orbit phase');
    assert.match(css,/:hover::after\s*\{\s*opacity: \.76/);
    assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);assert.match(css,/pointer-events: none/);
  }
});

test('moving a note through its picker saves only category and keeps selection on failure',async()=>{
  let fail=true;const r=renderer(async(next,revision)=>fail?{ok:false,message:'磁盘不可写'}:{ok:true,state:{...next,revision:revision+1}},'panel');await r.start();let s=M.addCategory(r.state(),'工作');const category=s.categories[0].id,note=M.newNote('正文不能变化','完整正文');s.notes.push(note);r.acceptState(s);r.openMoveCategory(note.id);const list=r.nodes.get('move-category-list'),selected=list.children[1].children[0];selected.checked=true;list.queries['input:checked']=selected;const before=M.copy(r.state().notes[0]);await r.nodes.get('move-category-form').onsubmit({preventDefault(){}});assert.equal(r.nodes.get('move-category').open,true);assert.equal(selected.value,category);assert.match(r.nodes.get('move-category-error').textContent,/磁盘不可写/);assert.deepEqual(r.state().notes[0],before);
  fail=false;await r.nodes.get('move-category-form').onsubmit({preventDefault(){}});assert.equal(r.nodes.get('move-category').open,false);assert.deepEqual({...r.state().notes[0],categoryId:''},before);
});
