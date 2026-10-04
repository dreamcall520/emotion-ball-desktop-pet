(function(root){
  'use strict';
  const uid=()=>root.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);
  const day=(time=Date.now())=>{const d=new Date(time);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const plusDay=(n,time=Date.now())=>{const d=new Date(time);d.setDate(d.getDate()+n);return day(d.getTime())};
  const copy=v=>JSON.parse(JSON.stringify(v));
  function validDate(v){if(v==='')return true;if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T12:00:00');return Number.isFinite(d.getTime())&&day(d.getTime())===v}
  function validateCategoryName(s,name,id){
    if(typeof name!=='string'||!name.trim())throw Object.assign(Error('请填写分类名称'),{code:'CATEGORY_NAME'});
    name=name.trim();
    if(Array.from(name).length>20)throw Object.assign(Error('分类名称最多 20 个字'),{code:'CATEGORY_NAME'});
    if(name==='未分类')throw Object.assign(Error('“未分类”是固定分类，请使用其他名称'),{code:'CATEGORY_NAME'});
    if((s.categories||[]).some(c=>c.id!==id&&c.name.toLowerCase()===name.toLowerCase()))throw Object.assign(Error('分类名称已存在'),{code:'CATEGORY_NAME'});
    return name;
  }
  function validate(s){
    if(!s||![1,2].includes(s.schema)||!Number.isSafeInteger(s.revision)||s.revision<0||!Array.isArray(s.notes)||!Array.isArray(s.todos)||s.notes.length+s.todos.length>5000)throw Error('记录格式无法读取');
    if(s.schema===2&&!Array.isArray(s.categories)||s.schema===1&&Object.hasOwn(s,'categories')&&(!Array.isArray(s.categories)||s.categories.length))throw Error('分类格式无法读取');
    const categoryIds=new Set(['']),categoryNames=new Set();
    for(const c of s.categories||[]){
      if(!c||typeof c.id!=='string'||!c.id||categoryIds.has(c.id)||typeof c.name!=='string'||c.name!==validateCategoryName({categories:[]},c.name)||categoryNames.has(c.name.toLowerCase()))throw Error('分类内容或标识不合法');
      categoryIds.add(c.id);categoryNames.add(c.name.toLowerCase());
    }
    const ids=new Set();
    for(const [kind,items] of [['note',s.notes],['todo',s.todos]])for(const item of items){
      if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||typeof item.title!=='string'||typeof item.body!=='string'||Array.from(item.title).length>200||Array.from(item.body).length>(kind==='note'?20000:5000))throw Error('记录内容或标识不合法');ids.add(item.id);
      if(!Number.isFinite(item.createdAt)||!Number.isFinite(item.updatedAt)||![null,undefined].includes(item.deletedAt)&&!Number.isFinite(item.deletedAt))throw Error('记录时间不合法');
      if(kind==='todo'&&(!validDate(item.dueDate)||typeof item.completed!=='boolean'||typeof item.archived!=='boolean'||item.archived&&!item.completed||item.reminderAt!==null&&!Number.isFinite(item.reminderAt)||!['pending','presented','dismissed','cancelled','none'].includes(item.reminderState)||typeof item.occurrenceId!=='string'))throw Error('待办状态不合法');
      if(kind==='todo'&&(!item.title.trim()||item.completed&&!Number.isFinite(item.completedAt)||['pending','presented'].includes(item.reminderState)&&(item.reminderAt===null||!item.occurrenceId)))throw Error('待办提醒或完成时间不合法');
      if(kind==='note'&&(typeof item.desktopOpen!=='boolean'||typeof item.pinned!=='boolean'||!item.position||!Number.isFinite(item.position.x)||!Number.isFinite(item.position.y)))throw Error('便签位置不合法');
      if(kind==='note'&&Object.hasOwn(item,'favorite')&&typeof item.favorite!=='boolean')throw Error('便签收藏状态不合法');
      if(kind==='note'&&(s.schema===2?(typeof item.categoryId!=='string'||!categoryIds.has(item.categoryId)):item.categoryId!=null&&item.categoryId!==''))throw Error('便签分类不合法');
      if(kind==='note'&&item.windowBounds!=null){const b=item.windowBounds;if(!b||![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<220||b.width>1400||b.height<160||b.height>1200)throw Error('便签窗口尺寸不合法')}
    }return s;
  }
  function migrate(s){validate(s);return validate(s.schema===2?copy(s):{...copy(s),schema:2,categories:[],notes:s.notes.map(n=>({...copy(n),categoryId:''}))})}
  function categoryName(s,id){if(id==='')return '未分类';const c=(s.categories||[]).find(c=>c.id===id);if(!c)throw Object.assign(Error('分类不存在，请重新选择'),{code:'CATEGORY_NOT_FOUND'});return c.name}
  function categoryChange(s,next){next.revision=s.revision+1;return validate(next)}
  function addCategory(s,name){const next=migrate(s);next.categories.push({id:uid(),name:validateCategoryName(next,name)});return categoryChange(s,next)}
  function renameCategory(s,id,name){const next=migrate(s);categoryName(next,id);if(id==='')throw Error('未分类不能改名');next.categories.find(c=>c.id===id).name=validateCategoryName(next,name,id);return categoryChange(s,next)}
  function reorderCategory(s,id,delta){
    const next=migrate(s);categoryName(next,id);if(id===''||![-1,1].includes(delta))throw Error('分类排序无法处理');
    const from=next.categories.findIndex(c=>c.id===id),to=from+delta;if(to<0||to>=next.categories.length)return s;
    [next.categories[from],next.categories[to]]=[next.categories[to],next.categories[from]];return categoryChange(s,next);
  }
  function deleteCategory(s,id){
    const next=migrate(s);categoryName(next,id);if(id==='')throw Error('未分类不能删除');
    next.categories=next.categories.filter(c=>c.id!==id);for(const n of next.notes)if(n.categoryId===id)n.categoryId='';return categoryChange(s,next);
  }
  function moveNoteCategory(s,noteId,categoryId){
    const next=migrate(s);categoryName(next,categoryId);const n=next.notes.find(n=>n.id===noteId);if(!n)throw Error('便签不存在');if(n.deletedAt!=null)throw Error('请先恢复便签');
    n.categoryId=categoryId;return categoryChange(s,next);
  }
  const base=(title,body='',now=Date.now())=>({id:uid(),title,body,createdAt:now,updatedAt:now,deletedAt:null});
  function newTodo(title,now=Date.now()){return {...base(title,'',now),dueDate:day(now),completed:false,completedAt:null,archived:false,reminderAt:null,occurrenceId:uid(),reminderState:'none',reminderBeforeCancel:null}}
  function newNote(title='',body='',now=Date.now()){return {...base(title,body,now),favorite:false,desktopOpen:false,pinned:false,position:{x:0,y:0},windowBounds:null,categoryId:''}}
  function progress(s,now=Date.now()){const list=s.todos.filter(t=>!t.deletedAt&&t.dueDate===day(now));return {total:list.length,done:list.filter(t=>t.completed).length}}
  function dueReminders(s,now=Date.now()){return s.todos.filter(t=>!t.deletedAt&&!t.completed&&t.reminderAt!==null&&t.reminderAt<=now&&['pending','presented'].includes(t.reminderState)).sort((a,b)=>a.reminderAt-b.reminderAt||a.createdAt-b.createdAt)}
  function cancelReminder(t){if(['pending','presented'].includes(t.reminderState))t.reminderBeforeCancel={at:t.reminderAt,state:t.reminderState};t.reminderState=t.reminderAt===null?'none':'cancelled'}
  function rearm(t,now){const old=t.reminderBeforeCancel;if(old?.state==='pending'&&old.at>now){t.reminderAt=old.at;t.occurrenceId=uid();t.reminderState='pending'}else t.reminderState=t.reminderAt===null?'none':'cancelled';t.reminderBeforeCancel=null}
  function setDueDate(s,id,dueDate,now=Date.now()){
    if(typeof dueDate!=='string'||!validDate(dueDate))throw Error('请填写有效的截止日期');
    const next=copy(s),t=next.todos.find(t=>t.id===id);if(!t)throw Error('记录不存在');if(t.deletedAt!=null)throw Error('请先恢复待办');
    t.dueDate=dueDate;t.updatedAt=now;next.revision=s.revision+1;return validate(next);
  }
  const formatNote=n=>n.title.trim()?[n.title.trim(),n.body].filter(Boolean).join('\n'):n.body||'无标题便签';
  function formatList(kind,records,label){
    if(!['note','todo'].includes(kind)||!Array.isArray(records))throw Error('复制清单格式不合法');
    const items=records.filter(t=>t.deletedAt==null),header=`${kind==='note'?'便签列表':'待办清单'} · ${label}（${items.length} ${kind==='note'?'条':'项'}）`;
    const indent=(text,prefix='   ')=>text.split('\n').map(line=>prefix+line).join('\n');
    const blocks=items.map((t,i)=>{
      if(kind==='note'){
        const body=t.body?t.body.split('\n'):[];let title=t.title.trim();
        if(!title){const first=body.findIndex(line=>line.trim());title=first<0?'无标题便签':body.splice(first,1)[0]}
        return `${i+1}. ${title}`+(body.length?'\n'+indent(body.join('\n')):'');
      }
      const lines=[`${t.completed?'☑':'☐'} ${t.title}`];
      if(t.dueDate)lines.push(`   截止：${t.dueDate}`);
      if(!t.completed&&['pending','presented'].includes(t.reminderState)&&Number.isFinite(t.reminderAt)){
        const d=new Date(t.reminderAt);lines.push(`   提醒：${day(t.reminderAt)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
      }
      if(t.body)lines.push('   备注：\n'+indent(t.body,'      '));
      return lines.join('\n');
    });
    return header+(blocks.length?'\n\n'+blocks.join('\n\n'):'');
  }
  function change(s,kind,id,action,now=Date.now()){
    if(kind==='todo'&&action==='tomorrow')return setDueDate(s,id,plusDay(1,now),now);
    const next=copy(s),items=kind==='note'?next.notes:next.todos,t=items.find(t=>t.id===id);if(!t)throw Error('记录不存在');
    if(action==='trash'){t.deletedAt=now;if(kind==='note')t.desktopOpen=false;else cancelReminder(t)}
    else if(action==='restore'){t.deletedAt=null;if(kind==='note')t.desktopOpen=false;else if(!t.completed)rearm(t,now)}
    else if(action==='erase'){if(!t.deletedAt)throw Error('请先移入回收站');items.splice(items.indexOf(t),1)}
    else if(kind==='todo'&&action==='complete'){t.completed=true;t.completedAt=now;cancelReminder(t)}
    else if(kind==='todo'&&action==='uncomplete'){t.completed=false;t.completedAt=null;t.archived=false;rearm(t,now)}
    else if(kind==='todo'&&action==='archive'){if(!t.completed)throw Error('未完成事项不能归档');t.archived=true}
    else if(kind==='todo'&&action==='unarchive')t.archived=false;
    else if(kind==='note'&&action==='favorite'){if(t.deletedAt!=null)throw Error('请先恢复便签');t.favorite=!t.favorite}
    else if(kind==='todo'&&action==='snooze'){if(t.completed||t.deletedAt)throw Error('这项提醒已失效');t.reminderAt=now+600000;t.occurrenceId=uid();t.reminderState='pending';t.reminderBeforeCancel=null}
    else if(kind==='todo'&&action==='dismiss')t.reminderState='dismissed';
    else if(kind==='todo'&&action==='present')t.reminderState='presented';
    else throw Error('操作无法处理');if(action!=='favorite')t.updatedAt=now;next.revision=(s.revision||0)+1;return validate(next);
  }
  const api={uid,day,plusDay,copy,validDate,validate,migrate,validateCategoryName,categoryName,addCategory,renameCategory,reorderCategory,deleteCategory,moveNoteCategory,newTodo,newNote,progress,dueReminders,setDueDate,formatNote,formatList,change};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.QiuModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
