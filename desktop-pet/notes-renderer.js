(() => {
'use strict';
const M=window.QiuModel,api=window.qiuNotes,$=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
let mode=params.get('mode')||'panel',noteId=params.get('id'),state={schema:2,revision:0,categories:[],notes:[],todos:[]};
let tab='todo',filter='today',noteCategoryFilter=null,query='',editorContext=null,actionsContext=null,organizeContext=null,reminder={items:[]};
let blocked=false,pendingWrite=null,writeChain=Promise.resolve(),saveTimer,toastTimer,closing=false,reminderBusy=false,heldCloseToken=null,panelPinned=false;
const drafts=new Map(),unsubscribers=[];
let quickCategory=null,quickDue=M.day(),quickReminder=null,quickComposing=false,quickSaving=false,quickSavePromise=null,categoryRename=null,categoryMenu=null,categoryDeleteId=null,categoryMoveId=null;
function node(tag,classes='',text=''){const el=document.createElement(tag);el.className=classes;el.textContent=text;return el}
function button(text,fn,classes=''){const el=node('button',classes,text);el.type='button';if(fn)el.onclick=async()=>{if(el.disabled||heldCloseToken!==null)return;el.disabled=true;try{await fn()}catch(error){notify(error.message||'操作未完成，请重试')}finally{el.disabled=false}};return el}
function bellText(text,classes='bell-line'){const el=node('span',classes);el.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 17h12l-2-3V9a4 4 0 0 0-8 0v5l-2 3Zm4 3h4"></path></svg>';el.append(node('span','',text));return el}
function find(kind,id){return (kind==='note'?state.notes:state.todos).find(r=>r.id===id)}
function titleOf(n){return n.title.trim()||n.body.trim().split('\n')[0]||'无标题便签'}
function dateLabel(date){return date===M.day()?'今天':date===M.plusDay(1)?'明天':date||'无日期'}
function reminderLabel(time){if(time===null)return '';const d=new Date(time);return `${dateLabel(M.day(time))} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
function notify(message,undo){clearTimeout(toastTimer);$('toast').replaceChildren(node('span','',message));if(undo)$('toast').append(button('撤销',undo));$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,6000)}
async function storageAction(name){const label=name==='exportRaw'?'导出':'重置';try{const result=await api[name]();if(result?.cancelled)return false;if(!result?.ok){notify(`${label}失败：${result?.message||'操作未完成，请重试'}`);return false}if(name==='reset'){blocked=false;pendingWrite=null;acceptState(result.state);$('storage-alert').hidden=true}notify(name==='exportRaw'?'原数据已导出':'便签与待办已重置');return true}catch(error){notify(`${label}失败：${error.message||'操作未完成，请重试'}`);return false}}
function showStorageError(message,corrupt=false){const box=$('storage-alert');box.replaceChildren(node('span','',message));box.hidden=false;if(corrupt){box.append(button('导出原数据',()=>storageAction('exportRaw')),button('重置记录…',()=>storageAction('reset')))}else box.append(button('重试保存',()=>retryWrite()),button('关闭提示',()=>box.hidden=true))}
function acceptState(next){if(!next||next.revision<state.revision)return;try{state=M.migrate(next);if(editorContext?.kind==='note'){const d=drafts.get(editorContext.id),n=find('note',editorContext.id);categoryOptions($('edit-note-category'),d?.categoryChanged?d.categoryId:n?(n.categoryId||''):(d?.categoryId||''))}if(mode!=='reminder')render();if($('category-manager').open&&!categoryRename)renderCategoryManager()}catch(error){blocked=true;showStorageError(error.message,true)}}
// Produce the write only after earlier IPC writes settle; never report a Promise as a saved record.
function commit(produce,onSuccess=()=>{},onError=()=>{},retain=true){
  const run=async()=>{const revision=state.revision;try{
    if(blocked)throw Error('原记录读取失败，无法保存，请先导出原数据');
    const next=typeof produce==='function'?produce():produce;if(!next)return true;M.validate(next);
    const result=await api.save(next,revision);if(result?.state)acceptState(result.state);
    if(!result?.ok)throw Error(result?.message||'写入未完成');
    pendingWrite=null;$('storage-alert').hidden=true;onSuccess(result.state);render();return true;
  }catch(error){if(!retain||error.code?.startsWith('CATEGORY_')){onError(error.message);return false}pendingWrite={produce,onSuccess,onError,revision};showStorageError(`${error.message}；输入已保留。`,blocked);onError(error.message);return false}};
  const result=writeChain.then(run,run);writeChain=result.catch(()=>false);return result;
}
async function retryWrite(){if(!pendingWrite)return true;const p=pendingWrite;if(p.revision!==state.revision){showStorageError('记录已有变化，请在原编辑位置重新保存，避免覆盖新内容。');return false}return commit(p.produce,p.onSuccess,p.onError)}
function render(){if(mode==='panel')renderList();if(mode==='note')renderDesktop();if(mode==='reminder')renderReminder()}
async function action(kind,id,name){
  if(kind==='note'&&drafts.has(id)&&!await flushNote(id))return false;
  const item=find(kind,id);if(!item)return false;
  if(name==='erase'&&!confirm(`永久删除“${kind==='note'?titleOf(item):item.title}”？此操作无法恢复。`))return false;
  return commit(()=>M.change(state,kind,id,name),()=>{
    if(name==='trash')drafts.delete(id);
    const messages={uncomplete:'已恢复未完成；已处理或已过期的提醒不会重新启用',tomorrow:'截止日期已改为明天；提醒时间未更改',snooze:'将在 10 分钟后提醒',dismiss:'已关闭本次提醒，待办仍未完成',archive:'已归档，保留完成记录和统计',unarchive:'已恢复到已完成列表',erase:'已永久删除',favorite:item.favorite?'已取消收藏':'已收藏，优先显示在列表中'};
    if(name==='complete')notify('已完成',()=>action('todo',id,'uncomplete'));
    else if(name==='trash')notify('已移入回收站',()=>action(kind,id,'restore'));
    else if(name==='restore')notify(kind==='note'?'便签已恢复到列表，保持收起':'待办已恢复；已处理或已过期的提醒不会重新启用');
    else if(messages[name])notify(messages[name]);
    if($('actions').open&&actionsContext?.kind===kind&&actionsContext.id===id)$('actions').close();
  });
}
function recordsInGroup(kind,group,category=noteCategoryFilter){const today=M.day();return(kind==='note'?state.notes:state.todos).filter(r=>{
  if(kind==='note'&&category!==null&&(r.categoryId||'')!==category)return false;
  if(group==='trash')return !!r.deletedAt;if(r.deletedAt)return false;
  if(kind==='note')return group==='favorites'?!!r.favorite:group!=='desktop'||r.desktopOpen;
  if(group==='all')return true;if(group==='completed')return r.completed&&!r.archived;if(group==='archived')return r.archived;
  if(r.archived)return false;if(group==='today')return r.dueDate===today;
  if(r.completed)return false;if(group==='overdue')return !!r.dueDate&&r.dueDate<today;
  if(group==='future')return r.dueDate>today;if(group==='undated')return !r.dueDate;return true;
})}
function filteredRecords(){const text=query.trim().toLowerCase();return recordsInGroup(tab,filter).filter(r=>`${r.title}\n${r.body}`.toLowerCase().includes(text)).sort((a,b)=>tab==='note'?(filter==='trash'?0:Number(!!b.pinned)-Number(!!a.pinned)||Number(!!b.favorite)-Number(!!a.favorite))||b.updatedAt-a.updatedAt:Number(a.completed)-Number(b.completed)||(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||(a.reminderAt||Infinity)-(b.reminderAt||Infinity)||a.createdAt-b.createdAt)}
const todoFilters=[['all','全部待办'],['today','今天'],['overdue','逾期'],['future','未来'],['undated','无日期'],['completed','已完成'],['archived','已归档'],['trash','回收站']],noteFilters=[['all','全部便签'],['favorites','收藏'],['desktop','桌面显示中'],['trash','回收站']];
function categories(){return [{id:'',name:'未分类'},...(state.categories||[])]}
function categoryName(id){return M.categoryName(state,id||'')}
function categoryCount(id){return state.notes.filter(n=>!n.deletedAt&&(n.categoryId||'')===id).length}
function categoryOptions(select,value=''){select.replaceChildren(...categories().map(c=>{const option=node('option','',c.name);option.value=c.id;return option}));select.value=categories().some(c=>c.id===value)?value:''}
function assignedCategory(){const id=quickCategory??noteCategoryFilter??'';return categories().some(c=>c.id===id)?id:''}
function closeFilter(){for(const [trigger,menu] of [['filter','filter-menu'],['category-filter','category-menu']]){$(menu).hidden=true;$(trigger).setAttribute('aria-expanded','false')}}
function toggleFilter(trigger,menu){const open=$(menu).hidden;closeFilter();if(open){$(menu).hidden=false;$(trigger).setAttribute('aria-expanded','true')}}
function selectFilter(value){if(!(tab==='note'?noteFilters:todoFilters).some(([id])=>id===value))return;filter=value;quickCategory=null;closeFilter();renderList();$('filter').focus()}
function selectCategoryFilter(value){if(tab!=='note'||value!==null&&!categories().some(c=>c.id===value))return;noteCategoryFilter=value;quickCategory=null;closeFilter();renderList();$('category-filter').focus()}
function renderFilter(options){
  $('filter').value=filter;$('filter-label').textContent='状态';
  $('filter').title=`状态：${options.find(([value])=>value===filter)?.[1]||'全部便签'} · ${recordsInGroup(tab,filter).length} ${tab==='note'?'条':'项'}`;
  $('filter').setAttribute('aria-description',$('filter').title);$('filter').classList.toggle('is-filtered',filter!==(tab==='note'?'all':'today'));
  const menu=$('filter-menu');menu.replaceChildren();
  for(const [value,label] of options){const item=button('',()=>selectFilter(value));item.dataset.filter=value;item.setAttribute('aria-current',String(filter===value));item.append(node('span','view-check',filter===value?'✓':''),node('span','',label),node('span','view-count',String(recordsInGroup(tab,value).length)));menu.append(item)}
  renderCategoryFilter();
}
function renderCategoryFilter(){
  $('category-filter-control').hidden=tab!=='note';const menu=$('category-menu');menu.replaceChildren();
  if(tab!=='note'){menu.hidden=true;$('category-filter').setAttribute('aria-expanded','false');return}
  $('category-filter-label').textContent='分类';$('category-filter').title=`分类：${noteCategoryFilter===null?'全部分类':categoryName(noteCategoryFilter)}`;
  $('category-filter').setAttribute('aria-description',$('category-filter').title);$('category-filter').classList.toggle('is-filtered',noteCategoryFilter!==null);
  const heading=node('div','category-menu-heading'),manage=button('管理',()=>{closeFilter();openCategoryManager()},'category-manage');manage.id='manage-categories';manage.setAttribute('aria-label','管理分类');manage.setAttribute('aria-haspopup','dialog');manage.setAttribute('aria-controls','category-manager');heading.append(node('span','menu-label','分类'),manage);menu.append(heading);
  for(const c of [{id:null,name:'全部分类'},...categories()]){const selected=noteCategoryFilter===c.id,item=button('',()=>selectCategoryFilter(c.id));item.dataset.categoryFilter=c.id===null?'all':c.id;item.setAttribute('aria-current',String(selected));item.append(node('span','view-check',selected?'✓':''),node('span','',c.name),node('span','view-count',String(recordsInGroup('note',filter,c.id).length)));menu.append(item)}
}
function renderQuickProperties(){
  const isNote=tab==='note';$('quick-category-picker').hidden=!isNote;$('quick-due').hidden=$('quick-reminder').hidden=isNote;
  categoryOptions($('quick-category-select'),assignedCategory());
  $('quick-due-label').textContent=quickDue?`截止 ${dateLabel(quickDue)}`:'截止日期';$('quick-due').classList.toggle('is-set',!!quickDue);$('quick-due').setAttribute('aria-label',`设置截止日期：${dateLabel(quickDue)}`);
  $('quick-reminder-label').textContent=quickReminder===null?'提醒':reminderLabel(quickReminder);$('quick-reminder').classList.toggle('is-set',quickReminder!==null);$('quick-reminder').setAttribute('aria-label',`设置提醒：${quickReminder===null?'未设置':reminderLabel(quickReminder)}`);
}
function openCategoryManager(){categoryMenu=null;categoryRename=null;$('category-manager-error').textContent='';renderCategoryManager();if(!$('category-manager').open)$('category-manager').showModal()}
function renderCategoryManager(){
  $('uncategorized-count').textContent=`${categoryCount('')} 条 · 固定分类`;const list=$('category-list');list.replaceChildren();
  if(!state.categories?.length)list.append(node('p','empty','还没有自定义分类'));
  for(const [index,c] of (state.categories||[]).entries()){
    const row=node('div',`category-row${categoryRename?.id===c.id?' is-renaming':''}`);
    if(categoryRename?.id===c.id){
      const context=categoryRename,input=node('input','category-rename');input.value=context.name;input.setAttribute('aria-label',`修改分类名称：${c.name}`);input.oninput=()=>{context.name=input.value;context.error='';error.textContent=''};
      const save=async()=>{if(context.busy)return false;context.busy=true;input.disabled=true;try{return await commit(()=>M.renameCategory(state,c.id,context.name),()=>{categoryRename=null;categoryMenu=null;renderCategoryManager();notify('分类名称已更新')},message=>{context.error=message;error.textContent=message;input.disabled=false;input.focus()},false)}finally{context.busy=false}};
      const cancel=()=>{categoryRename=null;categoryMenu=null;renderCategoryManager()};input.onkeydown=e=>{if(e.isComposing||e.keyCode===229)return;if(e.key==='Enter'){e.preventDefault();save()}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel()}};
      const confirmRename=button('✓',save,'icon-button rename-save'),cancelRename=button('×',cancel,'icon-button rename-cancel');confirmRename.setAttribute('aria-label','保存分类名称');cancelRename.setAttribute('aria-label','取消改名');row.append(input,confirmRename,cancelRename);const error=node('p','error-text rename-error',context.error||'');error.setAttribute('role','alert');list.append(row,error);input.focus();continue;
    }
    row.append(node('span','category-name',c.name),node('span','category-count',`${categoryCount(c.id)} 条`));
    for(const [delta,label] of [[-1,'↑'],[1,'↓']]){const move=button(label,()=>commit(()=>M.reorderCategory(state,c.id,delta),()=>{renderCategoryManager()},message=>$('category-manager-error').textContent=message,false),'icon-button');move.disabled=delta<0?index===0:index===state.categories.length-1;move.setAttribute('aria-label',`${delta<0?'上移':'下移'}分类：${c.name}`);row.append(move)}
    const more=button('⋯',()=>{categoryMenu=categoryMenu===c.id?null:c.id;renderCategoryManager()},'icon-button row-more');more.setAttribute('aria-label',`分类 ${c.name}，更多操作`);row.append(more);list.append(row);
    if(categoryMenu===c.id){const actions=node('div','row-actions');actions.append(button('改名',()=>{categoryRename={id:c.id,name:c.name,error:'',busy:false};renderCategoryManager()}),button('删除分类…',()=>openDeleteCategory(c.id),'danger'));list.append(actions)}
  }
}
function openNewCategory(){categoryRename=null;$('category-manager').close();$('new-category-name').value='';$('new-category-error').textContent='';$('new-category').showModal();$('new-category-name').focus()}
function cancelNewCategory(){$('new-category').close();openCategoryManager()}
function openDeleteCategory(id){categoryDeleteId=id;categoryRename=null;$('category-manager').close();$('delete-category-copy').textContent=`删除「${categoryName(id)}」？`;$('delete-category-error').textContent='';$('delete-category').showModal()}
function cancelDeleteCategory(){$('delete-category').close();openCategoryManager()}
function openMoveCategory(id){const note=find('note',id);if(!note)return;categoryMoveId=id;$('actions').close();$('move-note-title').textContent=titleOf(drafts.get(id)||note);$('move-category-error').textContent='';const list=$('move-category-list');list.replaceChildren();for(const c of categories()){const label=node('label','move-option'),input=node('input');input.type='radio';input.name='move-category';input.value=c.id;input.checked=(note.categoryId||'')===c.id;label.append(input,node('span','',c.name),node('span','category-count',`${categoryCount(c.id)} 条`));list.append(label)}$('move-category').showModal()}
function futureReminder(date,time){if(!date||!time||!M.validDate(date)||!/^\d{2}:\d{2}$/.test(time))throw Error('请填写完整的提醒日期和时间');const value=new Date(`${date}T${time}`).getTime();if(!Number.isFinite(value)||M.day(value)!==date||value<=Date.now())throw Error('提醒时间已过去，请选择未来时间');return value}
function updateQuickInput(){const input=$('quick-title');$('quick-save').disabled=quickSaving||!input.value.trim();input.style.height='22px';input.style.height=`${Math.max(22,Math.min(88,input.scrollHeight))}px`}
async function flushQuick(){for(let pass=0;pass<3&&$('quick-title').value.trim();pass++)if(!await submitQuick(true))return false;return !quickComposing&&!$('quick-title').value.trim()}
async function submitQuick(allowClosing=false){
  if(quickSaving)return allowClosing?quickSavePromise:false;if(quickComposing){if(allowClosing)showStorageError('输入法仍在确认文字，请确认后再关闭；输入已保留。');return false}if(heldCloseToken!==null&&!allowClosing)return false;
  const input=$('quick-title'),raw=input.value,text=raw.trim(),isNote=tab==='note',categoryId=assignedCategory(),targetName=categoryName(categoryId),dueDate=quickDue,reminderAt=quickReminder;
  if(!text)return true;if(Array.from(text).length>(isNote?20000:200)){notify(isNote?'便签内容最多 20,000 字，输入已保留':'待办标题最多 200 字，输入已保留');return false}
  if(!isNote&&(!M.validDate(dueDate)||reminderAt!==null&&reminderAt<=Date.now())){notify(reminderAt!==null&&reminderAt<=Date.now()?'提醒时间已过去，请重新设置；输入已保留':'请填写有效的截止日期；输入已保留');return false}
  const item=isNote?M.newNote('',text):M.newTodo(text);quickSaving=true;updateQuickInput();quickSavePromise=commit(()=>{if(!isNote&&reminderAt!==null&&reminderAt<=Date.now())throw Error('提醒时间已过去，请重新设置');const next=M.copy(state);if(isNote){categoryName(categoryId);item.categoryId=categoryId}else{item.dueDate=dueDate;item.reminderAt=reminderAt;item.occurrenceId=M.uid();item.reminderState=reminderAt===null?'none':'pending'}const items=isNote?next.notes:next.todos;if(!items.some(record=>record.id===item.id))items.push(M.copy(item));return next},()=>{
    if(input.value===raw)input.value='';if(quickReminder===reminderAt)quickReminder=null;
    if(tab===(isNote?'note':'todo')){if(!isNote)filter=dueDate===M.day()?'today':dueDate===''?'undated':dueDate>M.day()?'future':'overdue';query='';$('search').value=''}input.focus();notify(isNote?`已保存到「${targetName}」`:`待办已添加 · ${dueDate?'截止 '+dateLabel(dueDate):'无截止日期'}${reminderAt===null?'，无提醒':''}`)
  });try{return await quickSavePromise}finally{quickSaving=false;quickSavePromise=null;updateQuickInput()}
}
function renderList(){
  $('notes-tab').classList.toggle('active',tab==='note');$('todos-tab').classList.toggle('active',tab==='todo');$('notes-tab').setAttribute('aria-selected',tab==='note');$('todos-tab').setAttribute('aria-selected',tab==='todo');
  $('records').setAttribute('aria-labelledby',tab==='note'?'notes-tab':'todos-tab');
  if(noteCategoryFilter!==null&&!categories().some(c=>c.id===noteCategoryFilter))noteCategoryFilter='';const options=tab==='note'?noteFilters:todoFilters;renderFilter(options);
  $('filter').setAttribute('aria-label',tab==='note'?'便签状态':'待办分组');$('search').placeholder=tab==='note'?'搜索便签':'搜索待办';$('new-button').setAttribute('aria-label',tab==='note'?'新建便签':'新建待办');$('new-button').title=tab==='note'?'新建便签 · 完整编辑':'新建待办 · 设置日期和提醒';
  $('group-heading').hidden=tab==='note'?filter==='all'&&noteCategoryFilter===null:filter==='today';
  $('group-title').textContent=`${options.find(([v])=>v===filter)?.[1]||'今天'}${tab==='note'&&noteCategoryFilter!==null?' · '+categoryName(noteCategoryFilter):''}`;const p=M.progress(state);const today=tab==='todo'&&filter==='today';$('progress-text').hidden=!today||!p.total;$('progress-text').title=`今天已完成 ${p.done} 项，共 ${p.total} 项`;$('progress-text').setAttribute('aria-label',$('progress-text').title);$('progress-text').replaceChildren(node('span','completed-count',String(p.done)),node('span','progress-total',`/${p.total}`));
  const records=filteredRecords();$('list-description').textContent=query.trim()?`找到 ${records.length} 项记录`:filter==='trash'?'删除的记录会保留，恢复或永久删除由你决定':'';
  $('list-description').hidden=!$('list-description').textContent;
  $('records').replaceChildren();if(!records.length)$('records').append(node('p','empty',query.trim()?'没有找到相关记录':filter==='trash'?'回收站是空的':filter==='today'?'今天还没有计划，添加一件想做的事吧':'这里还没有记录'));
  for(const item of records){
    const row=node('div',`record ${tab==='note'?'note-row':''} ${item.completed?'completed':''}`),content=node('div','record-content');
    if(tab==='todo'&&filter!=='trash'){const check=button(item.completed?'✓':'',()=>action('todo',item.id,item.completed?'uncomplete':'complete'),`check ${item.completed?'done':''}`);check.setAttribute('aria-label',`${item.completed?'恢复未完成':'完成'}：${item.title}`);check.setAttribute('aria-pressed',item.completed);row.append(check)}
    const title=button(tab==='note'?titleOf(item):item.title,()=>filter==='trash'?openActions(tab,item.id):tab==='note'?openNote(item.id):openTodo(item.id),'record-title');const heading=node('div','record-heading');heading.append(title);if(tab==='note'&&!item.deletedAt){const star=button('',()=>action('note',item.id,'favorite'),'favorite-button');star.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.6-4.5 6.4-.9Z"></path></svg>';star.setAttribute('aria-label',`${item.favorite?'取消收藏':'收藏'}：${titleOf(item)}`);star.setAttribute('aria-pressed',String(!!item.favorite));star.title=item.favorite?'已收藏 · 点击取消':'收藏便签 · 优先显示';const pin=button('',()=>togglePin(item.id),'pin-button');pin.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet"><path d="M8 3h8M9 3v6l-3 4v2h12v-2l-3-4V3ZM12 15v6"></path></svg>';pin.setAttribute('aria-label',`${item.pinned?'取消置顶':'置顶'}：${titleOf(item)}`);pin.setAttribute('aria-pressed',String(!!item.pinned));pin.title=item.pinned?'已置顶 · 点击取消':'置顶便签';heading.append(pin,star)}content.append(heading);
    if(tab==='note'){const preview=(item.title.trim()?item.body:item.body.trim().split('\n').slice(1).join('\n')).trim();if(preview)content.append(node('div','note-preview',preview.split('\n').join(' · ')));const meta=node('div','note-meta'),left=node('div','note-meta-left');if(!item.deletedAt)left.append(node('span','note-category',categoryName(item.categoryId)));if(!item.deletedAt&&item.desktopOpen)left.append(node('span','note-status is-open',`桌面显示中${item.pinned?' · 置顶':''}`));meta.append(left);meta.append(node('span','note-updated',`${item.deletedAt?'删除于':'更新于'} ${reminderLabel(item.deletedAt||item.updatedAt)}`));content.append(meta)}
    else {const ringing=!item.deletedAt&&item.reminderAt!==null&&['pending','presented'].includes(item.reminderState),line=node('div','record-meta');if(item.deletedAt)line.textContent=`删除于 ${dateLabel(M.day(item.deletedAt))}`;else{const due=button(`截止 ${dateLabel(item.dueDate)}`,()=>openDuePicker(item.id),'due-button');due.setAttribute('aria-label',`修改截止日期：${item.title}`);due.title='修改截止日期 · 不更改提醒';line.append(due);if(ringing)line.append(bellText(`提醒：${reminderLabel(item.reminderAt)}`));else if(item.completed)line.append(node('span','',`完成于 ${dateLabel(M.day(item.completedAt))}`));if(item.archived)line.append(node('span','','已归档'))}content.append(line);if(item.reminderAt!==null&&['cancelled','dismissed'].includes(item.reminderState)&&!item.completed&&!item.deletedAt)content.append(node('div','record-state','提醒未启用，可重新设置'))}
    row.append(content);const more=button('⋯',()=>openActions(tab,item.id),'icon-button record-more');more.setAttribute('aria-label',`${tab==='note'?titleOf(item):item.title}，更多操作`);row.append(more);$('records').append(row);
  }
  $('quick-add').hidden=filter==='trash'||filter==='archived'||filter==='completed';$('quick-title').placeholder=tab==='note'?'写一条便签，回车保存…':'添加待办，回车保存…';$('quick-title').setAttribute('aria-label',tab==='note'?'快速便签内容':'新待办标题');const quickButton=$('quick-save');quickButton.setAttribute('aria-label',tab==='note'?'保存快速便签':'添加待办');quickButton.textContent=tab==='note'?'保存':'添加';renderQuickProperties();
}
function setSearchOpen(open){$('search-row').hidden=!open;$('toggle-search').setAttribute('aria-expanded',open);$('toggle-search').setAttribute('aria-label',open?'收起搜索':'展开搜索');if(open)$('search').focus();else{query='';$('search').value='';renderList();$('toggle-search').focus()}}
function renderPanelPin(){const button=$('pin-panel');button.textContent=panelPinned?'取消置顶':'窗口置顶';button.setAttribute('aria-pressed',String(panelPinned));button.title=panelPinned?'取消主面板置顶':'主面板保持在最前，不影响便签排序';button.setAttribute('aria-label',panelPinned?'取消主面板置顶':'主面板保持在最前')}
function noteStatus(text){$('note-save-status').textContent=text;$('note-footer').hidden=!text}
function renderDesktop(){
  const n=find('note',noteId),d=drafts.get(noteId);if(!n||n.deletedAt){noteStatus('便签已移除，未保存的输入仍可复制');return}
  document.title=`球球便签 · ${titleOf(d||n)}`;
  if(document.activeElement!==$('desktop-title'))$('desktop-title').value=d?.title??n.title;
  if(document.activeElement!==$('desktop-body'))$('desktop-body').value=d?.body??n.body;
  $('pin-note').classList.toggle('pinned-icon',n.pinned);$('pin-note').setAttribute('aria-pressed',String(!!n.pinned));$('pin-note').title=n.pinned?'取消置顶':'置顶';$('pin-note').setAttribute('aria-label',$('pin-note').title);
  noteStatus(d?(pendingWrite?'保存失败，请重试':'正在保存…'):'');
}
function noteDraft(id){if(!drafts.has(id)){const n=find('note',id)||(editorContext?.kind==='note'&&editorContext.id===id&&editorContext.isNew?editorContext.initialNote:null);if(!n)return null;drafts.set(id,{...M.copy(n),baseUpdatedAt:n.updatedAt,baseCategoryId:n.categoryId||'',categoryChanged:false,version:0})}return drafts.get(id)}
function inputNote(id,title,body){if(heldCloseToken!==null)return;const d=noteDraft(id);if(!d)return;d.title=title;d.body=body;d.updatedAt=Math.max(Date.now(),d.updatedAt+1);d.version++;if(mode==='note')noteStatus('正在保存…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>flushNote(id),500)}
function noteSaveError(message,id){if(mode==='note'&&noteId===id)noteStatus('保存失败，请重试');if(editorContext?.kind==='note'&&editorContext.id===id)$('editor-error').textContent=`${message}；输入已保留，请重试。`}
async function flushNote(id){
  clearTimeout(saveTimer);let submitted;
  return commit(()=>{
    const d=drafts.get(id);if(!d)return null;
    if(!d.title.trim()&&!d.body.trim()&&!find('note',id)){drafts.delete(id);return null}
    if(Array.from(d.title).length>200||Array.from(d.body).length>20000)throw Error('标题最多 200 字，正文最多 20,000 字');
    const next=M.copy(state),index=next.notes.findIndex(n=>n.id===id),current=next.notes[index];
    if(current?.deletedAt)throw Error('便签已移入回收站，请复制保留当前草稿');
    if(current&&current.updatedAt!==d.baseUpdatedAt)throw Error('便签在另一窗口更新，未覆盖新内容。请复制保留当前草稿后重新打开');
    submitted={version:d.version,updatedAt:d.updatedAt};
    const categoryId=d.categoryChanged?(categories().some(c=>c.id===d.categoryId)?d.categoryId:''):(current?(current.categoryId||''):(d.categoryId||''));
    if(current&&d.categoryChanged&&(current.categoryId||'')!==d.baseCategoryId&&(current.categoryId||'')!==categoryId)throw Error('分类已在另一窗口变化，输入已保留，请重新选择分类');
    const record={...(current||d),title:d.title,body:d.body,categoryId,updatedAt:d.updatedAt};delete record.baseUpdatedAt;delete record.baseCategoryId;delete record.categoryChanged;delete record.version;
    if(index>=0)next.notes[index]=record;else next.notes.push(record);return next;
  },saved=>{
    const d=drafts.get(id);if(d&&submitted){if(d.version===submitted.version)drafts.delete(id);else{const record=saved.notes.find(n=>n.id===id);d.baseUpdatedAt=record.updatedAt;d.baseCategoryId=record.categoryId||''}}
    if(editorContext?.kind==='note'&&editorContext.id===id){$('editor-error').textContent='';$('editor-save').textContent='保存并关闭'}
  },message=>noteSaveError(message,id));
}
async function flushAll(){await writeChain;if(pendingWrite&&!drafts.size&&!await retryWrite())return false;for(let pass=0;pass<3&&drafts.size;pass++)for(const id of [...drafts.keys()])if(!await flushNote(id))return false;return !drafts.size&&!pendingWrite}
function saveGuard(ids,onClose){const dialog=$('save-guard');$('guard-retry').onclick=async()=>{if(await flushAll()&&(mode!=='panel'||await flushQuick())){dialog.close();await onClose()}};$('guard-cancel').onclick=()=>dialog.close();$('guard-discard').onclick=async()=>{clearTimeout(saveTimer);for(const id of ids)drafts.delete(id);if(mode==='panel'){$('quick-title').value='';quickReminder=null;updateQuickInput()}pendingWrite=null;$('storage-alert').hidden=true;dialog.close();render();await onClose()};if(!dialog.open)dialog.showModal()}
async function openNote(id){const n=find('note',id);if(!n||n.deletedAt)return;if(n.desktopOpen){const result=await api.openNote(id);if(!result?.ok)notify(result?.message||'未能打开便签');return}await openNoteEditor(id)}
async function openNoteEditor(id){
  if(id&&find('note',id)?.desktopOpen){const result=await api.openNote(id);if(!result?.ok)notify(result?.message||'未能定位桌面便签');return}
  if($('editor').open&&!await closeEditor())return;const n=id?find('note',id):{...M.newNote(),categoryId:assignedCategory()};if(!n||n.deletedAt)return;
  editorContext={kind:'note',id:n.id,isNew:!id,initialNote:M.copy(n)};if(!id)drafts.set(n.id,{...n,baseUpdatedAt:n.updatedAt,baseCategoryId:n.categoryId||'',categoryChanged:false,version:0});
  $('editor-title').textContent=id?'编辑便签':'新建便签';$('editor-fields').innerHTML='<label class="field">标题（可留空）<input id="edit-note-title" placeholder="用一句话概括"></label><label class="field">正文<textarea id="edit-note-body" class="note-body-input" placeholder="写下想记住的事…"></textarea></label><label class="field">分类<span class="field-select"><select id="edit-note-category" aria-label="便签分类"></select><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg></span></label><p class="field-hint">停顿 500 毫秒自动保存；标题最多 200 字，正文最多 20,000 字。</p>';
  const d=drafts.get(n.id)||n;$('edit-note-title').value=d.title;$('edit-note-body').value=d.body;categoryOptions($('edit-note-category'),d.categoryId||'');$('edit-note-category').onchange=()=>{const draft=noteDraft(n.id);if(!draft)return;draft.categoryId=$('edit-note-category').value;editorContext.initialNote.categoryId=draft.categoryId;draft.categoryChanged=true;inputNote(n.id,$('edit-note-title').value,$('edit-note-body').value)};$('editor-error').textContent='';$('editor-save').textContent='保存并关闭';$('editor-cancel').textContent='关闭';
  const listener=()=>inputNote(n.id,$('edit-note-title').value,$('edit-note-body').value);$('edit-note-title').oninput=listener;$('edit-note-body').oninput=listener;$('editor').showModal();$('edit-note-title').focus();
  $('editor-fields').append(button('智能整理',()=>openOrganize(n.id),'text-button organize-entry'));
}
async function openTodo(id,sourceNote=null){
  if($('editor').open&&!await closeEditor())return;const item=id?find('todo',id):M.newTodo(sourceNote?titleOf(sourceNote):'');if(!item||item.deletedAt)return;
  if(sourceNote){item.body=sourceNote.body;item.sourceNoteId=sourceNote.id}
  editorContext={kind:'todo',id:item.id,isNew:!id,original:M.copy(item),sourceNoteId:item.sourceNoteId||null};$('editor-title').textContent=sourceNote?'便签转为待办':id?'编辑待办':'新建待办';
  $('editor-fields').innerHTML=(sourceNote?'<p class="transfer-hint">新建待办，原便签保留。超过 5,000 字时需缩减说明或另行复制，不会自动截断。</p>':'')+'<label class="field">待办标题<input id="edit-todo-title" required placeholder="想做什么？"></label><label class="field">补充说明<textarea id="edit-todo-body" placeholder="可选"></textarea></label><label class="field">截止日期<input id="edit-due" type="date"></label><label class="field-check"><input id="edit-reminder-enabled" type="checkbox">设置提醒</label><div id="reminder-fields" class="date-pair"><label class="field">提醒日期<input id="edit-reminder-date" type="date"></label><label class="field">提醒时间<input id="edit-reminder-time" type="time"></label></div><div class="field-hint reminder-help"><p>截止日期和提醒时间可以分开设置。</p><p>球球运行时才能按时提醒。退出期间错过的提醒，会在下次打开时汇总显示。</p></div>';
  $('edit-todo-title').value=item.title;$('edit-todo-body').value=item.body;$('edit-due').value=item.dueDate;
  $('edit-reminder-enabled').checked=item.reminderAt!==null&&['pending','presented'].includes(item.reminderState);const at=item.reminderAt||Date.now()+3600000,d=new Date(at);$('edit-reminder-date').value=M.day(at);$('edit-reminder-time').value=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const toggle=()=>{$('reminder-fields').hidden=!$('edit-reminder-enabled').checked};$('edit-reminder-enabled').onchange=toggle;toggle();$('editor-error').textContent='';$('editor-save').textContent=sourceNote?'确认创建':'保存';$('editor-cancel').textContent='取消';editorContext.formOriginal=todoFormValues();$('editor').showModal();$('edit-todo-title').focus();
}
function todoFormValues(){return JSON.stringify([$('edit-todo-title').value,$('edit-todo-body').value,$('edit-due').value,$('edit-reminder-enabled').checked,$('edit-reminder-date').value,$('edit-reminder-time').value])}
async function closeEditor(){
  const context=editorContext;if(!context)return true;
  if(context.kind==='note'){if(!await flushAll()){saveGuard([context.id],()=>{$('editor').close();editorContext=null});return false}}
  else if(todoFormValues()!==context.formOriginal&&!confirm('有尚未保存的修改，确认放弃本次修改？'))return false;
  $('editor').close();editorContext=null;return true;
}
async function saveTodo(){
  const context=editorContext,old=context.original,title=$('edit-todo-title').value.trim(),body=$('edit-todo-body').value,dueDate=$('edit-due').value;
  if(!title){$('editor-error').textContent='请填写待办标题';return false}
  if(Array.from(title).length>200||Array.from(body).length>5000){$('editor-error').textContent='标题最多 200 字，补充说明最多 5,000 字';return false}
  if(!M.validDate(dueDate)){$('editor-error').textContent='请填写有效的截止日期';return false}
  const enabled=$('edit-reminder-enabled').checked,rawTime=`${$('edit-reminder-date').value}T${$('edit-reminder-time').value}`,reminderAt=enabled?new Date(rawTime).getTime():null;
  const oldEnabled=old.reminderAt!==null&&['pending','presented'].includes(old.reminderState),same=enabled===oldEnabled&&(!enabled||Math.floor(old.reminderAt/60000)===Math.floor(reminderAt/60000));
  if(enabled&&(!Number.isFinite(reminderAt)||!same&&reminderAt<=Date.now())){$('editor-error').textContent='提醒时间已过去或不完整，请选择未来时间';return false}
  if(enabled&&dueDate&&M.day(reminderAt)>dueDate&&!confirm('提醒日期在截止日期之后，仍然保存吗？'))return false;
  const formSnapshot=todoFormValues();
  return commit(()=>{const next=M.copy(state),current=find('todo',old.id);if(current&&(current.updatedAt!==old.updatedAt||current.deletedAt))throw Error('待办已在另一窗口变化，输入已保留，请复制说明后重新打开');const record={...old,title,body,dueDate,updatedAt:Math.max(Date.now(),old.updatedAt+1)};
    if(!same){record.reminderAt=reminderAt;record.occurrenceId=M.uid();record.reminderState=enabled&&!record.completed?'pending':enabled?'cancelled':'none';record.reminderBeforeCancel=null}
    const index=next.todos.findIndex(t=>t.id===record.id);if(index>=0)next.todos[index]=record;else next.todos.push(record);return next;
  },saved=>{if(editorContext===context){if(todoFormValues()===formSnapshot){$('editor').close();editorContext=null}else{context.original=M.copy(saved.todos.find(t=>t.id===context.id));context.formOriginal=formSnapshot}}notify(context.sourceNoteId?'待办已创建，原便签已保留':context.isNew?'待办已创建':'待办已保存')},message=>$('editor-error').textContent=`${message}；输入已保留，请重试保存。`);
}
async function openDesktop(id){if(drafts.has(id)&&!await flushNote(id))return false;const result=await api.openNote(id);if(!result?.ok){notify(result?.message||'未能打开便签');return false}return true}
async function togglePin(id){if(!await flushNote(id))return false;return commit(()=>{const next=M.copy(state),n=next.notes.find(n=>n.id===id);if(!n||n.deletedAt)throw Error('便签已移除');n.pinned=!n.pinned;return next},saved=>notify(saved.notes.find(n=>n.id===id).pinned?'已置顶':'已取消置顶'))}
async function openOrganize(id){
  if(!await flushNote(id))return false;const item=find('note',id);if(!item||item.deletedAt)return false;
  if(!item.title.trim()&&!item.body.trim()){notify('先写一点内容，再整理吧');return false}
  if(organizeContext)await closeOrganize();organizeContext={id,original:{title:item.title,body:item.body,updatedAt:item.updatedAt},result:null,busy:false};
  $('organize-source').textContent=M.formatNote(item);$('organize-original').open=true;$('organize-result').hidden=true;$('organize-error').textContent='';$('organize-status').textContent='原文会保持不变，直到你确认替换。';
  $('organize-generate').hidden=false;$('organize-generate').disabled=false;$('organize-generate').textContent='开始整理';$('organize-copy').hidden=$('organize-apply').hidden=true;$('organize-apply').disabled=false;
  $('organize').showModal();$('organize-generate').focus();return true;
}
async function closeOrganize(){const context=organizeContext;organizeContext=null;$('organize').close();if(context?.busy)try{await api.cancelOrganize()}catch{}return true}
async function generateOrganized(){
  const context=organizeContext;if(!context||context.busy)return false;context.busy=true;context.result=null;
  $('organize-error').textContent='';$('organize-status').textContent='正在整理…';$('organize-generate').disabled=true;$('organize-copy').hidden=$('organize-apply').hidden=true;$('organize-result').hidden=true;
  try{
    const response=await api.organizeNote({id:context.id,title:context.original.title,body:context.original.body});if(organizeContext!==context)return false;
    if(!response?.ok)throw Error(response?.message||'整理暂时不可用，请重试。');const result=response.result;
    if(!result||typeof result.title!=='string'||typeof result.body!=='string'||Array.from(result.title).length>200||Array.from(result.body).length>20000||!result.title.trim()&&!result.body.trim())throw Error('整理结果不完整，原文未改变，请重新整理。');
    context.result={title:result.title,body:result.body};$('organize-result-title').value=result.title;$('organize-result-body').value=result.body;$('organize-original').open=false;$('organize-result').hidden=false;$('organize-copy').hidden=$('organize-apply').hidden=false;
    $('organize-generate').textContent='重新整理';$('organize-generate').hidden=true;$('organize-status').textContent='请核对内容；替换后可立即撤销。';return true;
  }catch(error){if(organizeContext===context){$('organize-error').textContent=error.message||'整理未完成，请重试。';$('organize-status').textContent='原文保持不变。'}return false}
  finally{context.busy=false;if(organizeContext===context)$('organize-generate').disabled=false}
}
function syncNoteEditor(id,note){if(!drafts.has(id)&&editorContext?.kind==='note'&&editorContext.id===id){$('edit-note-title').value=note.title;$('edit-note-body').value=note.body}}
async function applyOrganized(){
  const context=organizeContext;if(!context?.result||context.busy)return false;let applied;
  return commit(()=>{const next=M.copy(state),item=next.notes.find(n=>n.id===context.id),original=context.original;
    if(!item||item.deletedAt||drafts.has(context.id)||item.updatedAt!==original.updatedAt||item.title!==original.title||item.body!==original.body)throw Error('便签在整理期间有了新修改，未覆盖。可复制结果后重新整理。');
    Object.assign(item,context.result,{updatedAt:Math.max(Date.now(),item.updatedAt+1)});applied=M.copy(item);return next;
  },()=>{syncNoteEditor(context.id,applied);if(organizeContext===context){organizeContext=null;$('organize').close()}notify('已替换为整理后的内容',()=>commit(()=>{const next=M.copy(state),item=next.notes.find(n=>n.id===context.id);
    if(!item||item.deletedAt||drafts.has(context.id)||item.updatedAt!==applied.updatedAt||item.title!==applied.title||item.body!==applied.body)throw Error('便签已有新修改，不能直接撤销。');
    Object.assign(item,{title:context.original.title,body:context.original.body,updatedAt:Math.max(Date.now(),item.updatedAt+1)});return next;
  },saved=>{syncNoteEditor(context.id,saved.notes.find(n=>n.id===context.id));notify('已恢复整理前的原文')},message=>{pendingWrite=null;$('storage-alert').hidden=true;notify(message)}))},message=>{pendingWrite=null;$('storage-alert').hidden=true;$('organize-error').textContent=message});
}
function openActions(kind,id){const item=find(kind,id);if(!item)return;actionsContext={kind,id};$('actions').classList.toggle('compact-actions',true);$('actions-title').textContent=kind==='note'?titleOf(item):item.title;$('actions-list').replaceChildren();
  const add=(label,fn,danger=false)=>{$('actions-list').append(button(label,async()=>{const context=actionsContext,result=await fn();if(result!==false&&actionsContext===context)$('actions').close()},danger?'danger':''))};
  if(item.deletedAt){add('恢复到列表',()=>action(kind,id,'restore'));add('永久删除…',()=>action(kind,id,'erase'),true)}
  else if(kind==='note'){
    if(mode==='panel'){add(item.desktopOpen?'查看桌面便签':'在桌面显示',()=>openDesktop(id));add('编辑便签',async()=>{$('actions').close();await openNoteEditor(id)});$('actions-list').append(node('hr','action-separator'))}
    add('智能整理',async()=>{$('actions').close();return openOrganize(id)});add('复制便签',()=>copyNote(id));add('移动到分类…',()=>{openMoveCategory(id);return false});add(item.favorite?'取消收藏':'收藏便签',()=>action(kind,id,'favorite'));add(item.pinned?'取消置顶':'桌面置顶',()=>togglePin(id));
    add('创建待办…',async()=>{if(!await flushNote(id))return false;$('actions').close();await openTodo(null,find('note',id))});$('actions-list').append(node('hr','action-separator'));add('移到回收站',()=>action(kind,id,'trash'),true);
  }else{
    add('编辑待办',async()=>{$('actions').close();await openTodo(id)});
    if(item.completed){add('恢复未完成',()=>action(kind,id,'uncomplete'));add(item.archived?'恢复到已完成':'归档已完成',()=>action(kind,id,item.archived?'unarchive':'archive'))}
    else{add('标记完成',()=>action(kind,id,'complete'));add('延期到明天',()=>action(kind,id,'tomorrow'));add('修改截止日期…',()=>{$('actions').close();openDuePicker(id);return false})}
    $('actions-list').append(node('hr','action-separator'));add('移到回收站',()=>action(kind,id,'trash'),true);
  }if(!$('actions').open)$('actions').showModal();
}
function openDuePicker(id){const item=find('todo',id);if(!item||item.deletedAt)return;actionsContext={kind:'todo',id};$('actions').classList.toggle('compact-actions',false);$('actions-title').textContent='修改截止日期';const form=node('form','due-form'),label=node('label','field','截止日期'),input=node('input');input.type='date';input.id='inline-due';input.value=item.dueDate;label.append(input);const shortcuts=node('div','due-shortcuts'),error=node('p','error-text'),footer=node('footer','dialog-footer');error.setAttribute('role','alert');
  const save=async value=>{input.value=value;error.textContent='';return commit(()=>M.setDueDate(state,id,value),()=>{$('actions').close();notify(`截止日期：${dateLabel(value)} · 提醒时间未更改`)},message=>error.textContent=`${message}；所选日期已保留，请重试。`)};
  shortcuts.append(button('今天',()=>save(M.day())),button('明天',()=>save(M.plusDay(1))),button('无日期',()=>save('')));footer.append(button('取消',()=>$('actions').close(),'secondary'));const submit=button('保存',null,'primary');submit.type='submit';footer.append(submit);form.append(node('p','due-target',item.title),label,shortcuts,node('p','field-hint','截止日期与提醒独立，修改日期不会改变提醒时间。'),error,footer);form.onsubmit=e=>{e.preventDefault();save(input.value)};$('actions-list').replaceChildren(form);$('actions').showModal();input.focus();
}
async function copyText(text,success,manualTitle){try{const result=await api.copyText(text);if(!result?.ok)throw Error(result?.message);notify(success);return true}catch{actionsContext=null;$('actions-title').textContent=manualTitle;const field=node('label','field','待复制文本'),area=node('textarea','copy-text');area.readOnly=true;area.value=text;field.append(area);$('actions-list').replaceChildren(node('p','field-hint','自动复制未完成，请选中文本后按 ⌘/Ctrl C 复制。'),field,button('关闭',()=>$('actions').close(),'secondary'));if(!$('actions').open)$('actions').showModal();area.focus();area.select();return false}}
function copyNote(id){const n=drafts.get(id)||find('note',id);if(!n)return false;return copyText(M.formatNote(n),'便签已复制','手动复制便签')}
function renderReminder(){
  const box=$('reminder'),items=reminder.items||[],active=items.find(item=>item.id===reminder.activeId&&item.occurrenceId===reminder.occurrenceId);box.replaceChildren();const top=node('div','reminder-top'),heading=node('div','reminder-heading');heading.append(bellText('待办提醒','bell-line reminder-label'));if(reminder.summary&&items.length){const count=node('span','reminder-time');count.append(node('span','reminder-count',String(items.length)),node('span','',' 项未处理'));heading.append(count)}else if(active)heading.append(node('span','reminder-time',reminderLabel(active.reminderAt)));top.append(heading);const close=button('×',()=>api.closeWindow(),'icon-button');close.setAttribute('aria-label','关闭提醒');top.append(close);box.append(top);
  if(reminder.error){box.append(node('h3','',reminder.error),button('重试',()=>reminderAction(null,null,'process'),'primary'));return}
  if(reminder.summary&&items.length){box.append(node('h3','','回来啦，看看待办吧'));const list=node('ul','summary-list');for(const item of items)list.append(node('li','',item.title));box.append(list,button('逐项处理',()=>reminderAction(null,null,'process'),'primary'));return}
  if(!active){box.append(node('h3','','当前没有未处理提醒'),button('查看我的待办',()=>reminderAction(null,null,'list'),'secondary'));return}
  close.onclick=()=>reminderAction(active.id,active.occurrenceId,'dismiss');close.setAttribute('aria-label','关闭本次提醒，保持待办未完成');
  box.append(node('h3','',active.title));const buttons=node('div','reminder-buttons');buttons.append(button('完成',()=>reminderAction(active.id,active.occurrenceId,'complete'),'primary'),button('稍后10分钟',()=>reminderAction(active.id,active.occurrenceId,'snooze'),'secondary'));box.append(buttons);
  if(items.length>1)box.append(button(`还有 ${items.length-1} 项提醒 · 查看列表`,()=>reminderAction(null,null,'list'),'text-button reminder-queue'));
}
async function reminderAction(id,occurrenceId,name){if(reminderBusy)return false;reminderBusy=true;try{const result=await api.actionReminder(id,occurrenceId,name);if(!result?.ok){notify(result?.message||'处理未保存，请重试');return false}if(result.state)acceptState(result.state);return true}catch(error){notify(error.message||'处理未完成，请重试');return false}finally{reminderBusy=false}}
function closeLock(token){heldCloseToken=token;for(const id of ['panel','desktop-note','editor','actions','organize','storage-alert','category-manager','new-category','move-category','delete-category','quick-due-dialog','quick-reminder-dialog'])$(id).inert=true;$('close-status').hidden=false}
function cancelClose(token){if(heldCloseToken!==token)return;heldCloseToken=null;for(const id of ['panel','desktop-note','editor','actions','organize','storage-alert','category-manager','new-category','move-category','delete-category','quick-due-dialog','quick-reminder-dialog'])$(id).inert=false;$('close-status').hidden=true}
async function beforeClose(packet){
  if(closing)return false;closing=true;let allowed=false;
  const hold=packet?.hold===true&&typeof packet.token==='string',token=packet?.token;
  if(hold)closeLock(token);
  try{
    if(organizeContext)await closeOrganize();
    if(!await flushAll()||mode==='panel'&&!await flushQuick()){saveGuard([...drafts.keys()],()=>api.closeWindow());return false}
    if(hold&&heldCloseToken!==token)return false;
    if(editorContext?.kind==='todo'&&todoFormValues()!==editorContext.formOriginal&&!confirm('有尚未保存的待办修改，确认放弃并关闭？'))return false;
    allowed=true;return true;
  }finally{closing=false;if(hold&&!allowed)cancelClose(token)}
}
async function hide(){if(!await beforeClose())return false;const result=await (mode==='panel'?api.hidePanel():api.closeWindow());if(result?.ok===false){notify(result.message||'窗口尚未关闭');return false}return true}
async function handleOpen(value){if(value?.tab==='note'||value?.tab==='todo'){tab=value.tab;filter=tab==='note'?'all':'today';noteCategoryFilter=null;quickCategory=null;closeFilter()}query='';$('search').value='';if(mode==='panel')renderList();if(value?.create){if(tab==='note')await openNoteEditor();else await openTodo()}else if(value?.id){if(tab==='note')await openNote(value.id);else await openTodo(value.id)}}
function bindCategories(){
  const close=id=>()=>$(id).close();$('category-manager-close').onclick=$('category-manager-done').onclick=close('category-manager');$('category-manager').addEventListener('cancel',e=>{if(categoryRename){e.preventDefault();categoryRename=null;categoryMenu=null;renderCategoryManager()}});$('category-add').onclick=openNewCategory;
  $('new-category-cancel').onclick=$('new-category-close').onclick=cancelNewCategory;$('new-category').addEventListener('cancel',e=>{e.preventDefault();cancelNewCategory()});$('new-category-name').oninput=()=>$('new-category-error').textContent='';
  let creating=false;$('new-category-form').onsubmit=async e=>{e.preventDefault();if(creating)return;creating=true;$('new-category-save').disabled=true;const name=$('new-category-name').value;try{await commit(()=>M.addCategory(state,name),()=>{$('new-category').close();openCategoryManager();notify('分类已创建')},message=>$('new-category-error').textContent=message,false)}finally{creating=false;$('new-category-save').disabled=false}};
  $('delete-category-cancel').onclick=$('delete-category-close').onclick=cancelDeleteCategory;$('delete-category').addEventListener('cancel',e=>{e.preventDefault();cancelDeleteCategory()});$('delete-category-confirm').onclick=async()=>{const id=categoryDeleteId,control=$('delete-category-confirm');if(control.disabled)return;control.disabled=true;try{await commit(()=>M.deleteCategory(state,id),()=>{$('delete-category').close();if(noteCategoryFilter===id)noteCategoryFilter='';if(quickCategory===id)quickCategory='';openCategoryManager();notify('分类已删除，所有便签保留在未分类')},message=>$('delete-category-error').textContent=message,false)}finally{control.disabled=false}};
  $('move-category-cancel').onclick=$('move-category-close').onclick=close('move-category');$('move-category-form').onsubmit=async e=>{e.preventDefault();const control=$('move-category-save');if(control.disabled)return;const selected=$('move-category-list').querySelector('input:checked');if(!selected)return;const id=categoryMoveId,categoryId=selected.value,targetName=categories().find(c=>c.id===categoryId)?.name||'未分类';control.disabled=true;try{await commit(()=>M.moveNoteCategory(state,id,categoryId),()=>{$('move-category').close();const draft=drafts.get(id);if(draft&&!draft.categoryChanged){draft.categoryId=categoryId;draft.baseCategoryId=categoryId}notify(`已移至「${targetName}」`)},message=>$('move-category-error').textContent=message,false)}finally{control.disabled=false}};
  $('quick-category-select').onchange=()=>quickCategory=$('quick-category-select').value;
  $('quick-due').onclick=()=>{$('quick-due-date').value=quickDue;$('quick-due-error').textContent='';$('quick-due-dialog').showModal()};$('quick-due-close').onclick=$('quick-due-cancel').onclick=close('quick-due-dialog');
  $('quick-due-shortcuts').replaceChildren(...[['今天',M.day()],['明天',M.plusDay(1)],['无日期','']].map(([name,value])=>button(name,()=>{$('quick-due-date').value=value})));
  $('quick-due-form').onsubmit=e=>{e.preventDefault();const value=$('quick-due-date').value;if(!M.validDate(value)){$('quick-due-error').textContent='请填写有效的截止日期';return}quickDue=value;$('quick-due-dialog').close();renderQuickProperties();$('quick-title').focus()};
  $('quick-reminder').onclick=()=>{const value=quickReminder||Date.now()+3600000,date=new Date(value);$('quick-reminder-date').value=M.day(value);$('quick-reminder-time').value=`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;$('quick-reminder-error').textContent='';$('quick-reminder-clear').hidden=quickReminder===null;$('quick-reminder-dialog').showModal()};$('quick-reminder-close').onclick=$('quick-reminder-cancel').onclick=close('quick-reminder-dialog');
  $('quick-reminder-form').onsubmit=e=>{e.preventDefault();try{quickReminder=futureReminder($('quick-reminder-date').value,$('quick-reminder-time').value);$('quick-reminder-dialog').close();renderQuickProperties();$('quick-title').focus()}catch(error){$('quick-reminder-error').textContent=error.message}};
  $('quick-reminder-clear').onclick=()=>{quickReminder=null;$('quick-reminder-dialog').close();renderQuickProperties();$('quick-title').focus()};
}
function bind(){
  document.addEventListener('pointerdown',()=>document.documentElement.dataset.inputMode='pointer',true);document.addEventListener('keydown',e=>{if(['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))document.documentElement.dataset.inputMode='keyboard'},true);
  $('notes-tab').onclick=()=>{tab='note';filter='all';noteCategoryFilter=null;quickCategory=null;query='';closeFilter();$('search').value='';renderList()};$('todos-tab').onclick=()=>{tab='todo';filter='today';noteCategoryFilter=null;quickCategory=null;query='';closeFilter();$('search').value='';renderList()};$('filter').onchange=()=>selectFilter($('filter').value);
  for(const [trigger,menu] of [['filter','filter-menu'],['category-filter','category-menu']]){$(trigger).onclick=()=>{if(trigger==='category-filter'&&tab!=='note')return;toggleFilter(trigger,menu)};const escape=e=>{if(e.key==='Escape'){e.preventDefault();closeFilter();$(trigger).focus()}};$(trigger).onkeydown=escape;$(menu).onkeydown=escape}
  document.addEventListener('pointerdown',e=>{if(e.target?.closest&&!e.target.closest('.filter-control'))closeFilter()});$('search').oninput=()=>{query=$('search').value;renderList()};
  $('toggle-search').onclick=()=>setSearchOpen($('search-row').hidden);$('search').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();setSearchOpen(false)}};
  document.querySelector('.tabs').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const target=e.key==='Home'||e.key==='ArrowLeft'?$('notes-tab'):$('todos-tab');target.click();target.focus()};
  $('new-button').onclick=()=>tab==='note'?openNoteEditor():openTodo();$('hide-panel').onclick=hide;
  $('pin-panel').onclick=async()=>{const button=$('pin-panel');if(button.disabled||heldCloseToken!==null)return;button.disabled=true;try{const result=await api.pinPanel(!panelPinned);if(!result?.ok)throw Error(result?.message||'面板置顶未完成，请重试');panelPinned=result.pinned===true;renderPanelPin()}catch(error){notify(error.message||'面板置顶未完成，请重试')}finally{button.disabled=false}};
  const quickInput=$('quick-title');quickInput.oninput=updateQuickInput;updateQuickInput();quickInput.addEventListener('compositionstart',()=>quickComposing=true);quickInput.addEventListener('compositionend',()=>quickComposing=false);
  quickInput.onkeydown=e=>{if(e.key!=='Enter'||e.shiftKey||e.isComposing||quickComposing||e.keyCode===229)return;e.preventDefault();$('quick-add').requestSubmit()};
  $('quick-add').onsubmit=e=>{e.preventDefault();return submitQuick()};
  bindCategories();
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(!$('filter-menu').hidden||!$('category-menu').hidden)){e.preventDefault();closeFilter()}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&mode==='panel'&&heldCloseToken===null&&!document.querySelector('dialog[open]')){e.preventDefault();setSearchOpen(true);$('search').select()}});
  $('desktop-title').oninput=$('desktop-body').oninput=()=>inputNote(noteId,$('desktop-title').value,$('desktop-body').value);$('hide-note').onclick=hide;$('desktop-more').onclick=()=>openActions('note',noteId);$('pin-note').onclick=()=>togglePin(noteId);
  $('editor-close').onclick=$('editor-cancel').onclick=closeEditor;$('editor').addEventListener('cancel',e=>{e.preventDefault();closeEditor()});
  let editorSaving=false;$('editor-form').onsubmit=async e=>{e.preventDefault();if(editorSaving||!editorContext||heldCloseToken!==null)return;editorSaving=true;$('editor-save').disabled=true;try{if(editorContext.kind==='note'){const id=editorContext.id;if(await flushNote(id)&&!drafts.has(id)){$('editor').close();editorContext=null;notify('便签已保存')}}else await saveTodo()}finally{editorSaving=false;$('editor-save').disabled=false}};
  $('actions-close').onclick=()=>$('actions').close();
  $('organize-close').onclick=$('organize-cancel').onclick=closeOrganize;$('organize').addEventListener('cancel',e=>{e.preventDefault();closeOrganize()});
  $('organize-generate').onclick=generateOrganized;$('organize-apply').onclick=async()=>{if($('organize-apply').disabled)return;$('organize-apply').disabled=true;try{await applyOrganized()}finally{$('organize-apply').disabled=false}};
  $('organize-copy').onclick=()=>organizeContext?.result&&copyText(M.formatNote(organizeContext.result),'整理结果已复制','手动复制整理结果');
}
function applyAppearance(value){document.documentElement.dataset.notesAppearance=value==='dark'?'dark':'light'}
async function start(){
  if(!api||!M){showStorageError('便签窗口未能连接球球，请关闭后重试');return}
  bind();let ready=false,opening=null;
  unsubscribers.push(api.onState(acceptState),api.onReminder(value=>{reminder=value;if(mode==='reminder')renderReminder()}),api.onOpen(value=>{if(ready)handleOpen(value);else opening=value}),api.onBeforeClose(beforeClose));
  if(api.onAppearance)unsubscribers.push(api.onAppearance(applyAppearance));
  if(api.onStorageError)unsubscribers.push(api.onStorageError(message=>notify(message)));
  if(api.onCloseCancelled)unsubscribers.push(api.onCloseCancelled(cancelClose));
  let today=M.day();const refreshDay=()=>{if(today!==M.day()){today=M.day();if(mode==='panel')renderList()}};const dayTimer=setInterval(refreshDay,60000);window.addEventListener('focus',refreshDay);unsubscribers.push(()=>{clearInterval(dayTimer);window.removeEventListener('focus',refreshDay)});
  try{const loaded=await api.load();applyAppearance(loaded.notesAppearance);mode=['note','reminder'].includes(loaded.mode)?loaded.mode:'panel';noteId=loaded.id||noteId;reminder=loaded.reminder||{items:[]};panelPinned=loaded.panelPinned===true;renderPanelPin();if(loaded.state)acceptState(loaded.state);if(loaded.error){blocked=true;showStorageError(loaded.error,true)}document.body.dataset.mode=mode;document.title=mode==='reminder'?'球球 · 待办提醒':mode==='note'?'球球便签':'便签与待办';$('panel').hidden=mode!=='panel';$('desktop-note').hidden=mode!=='note';$('reminder').hidden=mode!=='reminder';ready=true;render();if(opening)await handleOpen(opening);else if(mode==='panel'&&loaded.tab)await handleOpen(loaded)}catch(error){blocked=true;showStorageError(error.message||'记录读取失败',true)}
}
window.addEventListener('beforeunload',()=>{clearTimeout(saveTimer);clearTimeout(toastTimer);for(const unsubscribe of unsubscribers)if(typeof unsubscribe==='function')unsubscribe()},{once:true});
start();
})();
