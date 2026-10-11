(function () {
  'use strict';
  window.QuotaCustomizer = { create({ bridge, getAppearance, announce }) {
    const $ = id => document.getElementById(id);
    const styles = [
      ['card','经典额度卡','数字与进度一目了然'],['pool','液态额度池','余量化作一池波光'],
      ['ring','完整光环','一圈流光，慢慢退去'],['duo','同心双环','需同时有 5 小时与周额度'],
      ['split','左右半环','同一圆圈，左右分明'],['stages','五段光弧','每段 20%，细腻有序']
    ];
    let config = QuotaDisplay.normalize(), current = {fiveHour:null,weekly:null}, currentModel = {state:'disconnected',items:[]};
    const demo = {fiveHour:74,weekly:38}, thumbs = [];
    let source = 'demo', playing = false, lastTick = 0, timer = null, effect = null, disposed = false, shown = false;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const numbers = document.createElement('div'); numbers.className = 'quota-preview-numbers quota-preview-card';
    const card = document.createElement('div'); card.className = 'quota-preview-card';
    const stage = $('stage'); stage.append(numbers, card);
    function values() { return source === 'current' ? current : demo; }
    function previewModel() {
      return source === 'current' ? currentModel : {state:'ready',items:Object.entries(demo)
        .filter(([,remaining])=>remaining!==null)
        .map(([period,remaining])=>({windowMinutes:period==='fiveHour'?300:10080,remaining}))};
    }
    function drawNumbers(node, c, v, model) {
      node.replaceChildren();
      const periods=QuotaDisplay.periods(c,model),palette=window.QuotaEffects?.palette(getAppearance());
      const colors=palette?(periods.length===2?window.QuotaEffects.dualPalettes(palette):[palette]):[];
      for (const [index,period] of periods.entries()) {
        const line = document.createElement('span'), label = document.createElement('small'), value = document.createElement('strong');
        line.dataset.period = period; label.className = 'quota-preview-period'; label.textContent = period === 'fiveHour' ? '5h' : '周';
        if(colors[index])line.style.setProperty('--quota-dot','rgb('+colors[index].base.join(',')+')');
        value.textContent = v[period] === null ? '—' : Math.round(v[period]) + '%'; line.append(label, value); node.append(line);
      }
    }
    function refresh() {
      if (disposed) return;
      const appearance = getAppearance(), v = values(), model = previewModel();
      const periods = QuotaDisplay.periods(config, model);
      const preview = {...config,period:periods[0]||'fiveHour',
        ...(appearance.shape === 'codex-pet'?{style:'card'}:{})};
      const visible = shown && !document.hidden;
      effect ||= window.QuotaEffects?.create($('preview-ball'));
      effect?.update({config:preview,appearance,quotas:v,theme:stage.classList.contains('dark') !== (document.documentElement.dataset.theme === 'dark')?'dark':'light',reducedMotion:motion.matches,visible});
      numbers.hidden = !visible || preview.style === 'card' || !preview.showNumbers;
      card.hidden = !visible || preview.style !== 'card'; card.dataset.size = preview.cardSize;
      numbers.classList.toggle('dark',stage.classList.contains('dark') !== (document.documentElement.dataset.theme === 'dark'));
      card.classList.toggle('dark',numbers.classList.contains('dark'));
      drawNumbers(numbers, preview, v, model); drawNumbers(card, preview, v, model);
      for (const button of $('quota-styles').children) button.setAttribute('aria-pressed',String(button.dataset.style === config.style));
      $('quota-material-row').hidden = ['card','pool'].includes(config.style);
      $('quota-numbers-row').hidden = config.style === 'card';
      $('quota-card-row').hidden = config.style !== 'card';
      $('quota-card-size').value = config.cardSize; $('quota-numbers').checked = config.showNumbers;
      document.querySelectorAll('[data-quota-material]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.quotaMaterial === config.material)));
      $('quota-description').textContent = appearance.shape === 'codex-pet' ? 'Codex 宠物使用经典额度卡，已选样式会在切回球球后恢复。'
        : config.style === 'duo' ? '同时有 5 小时和周额度时显示双环，内环 5 小时、外环本周；仅一个周期时自动显示单环。'
        : ['split','stages'].includes(config.style) ? '左侧代表 5 小时，右侧代表本周；仅一个周期时自动显示单环。' : styles.find(s=>s[0]===config.style)[2]+'。';
      $('quota-preview-state').hidden = source === 'demo';
      $('quota-preview-state').textContent = source === 'demo' ? '' : '当前额度 · ' + (Object.values(v).some(x=>x!==null) ? '已连接' : '暂未返回可用额度');
      for (const period of ['fiveHour','weekly']) {
        $('quota-demo-'+period).value = demo[period] ?? 0;
        $('quota-output-'+period).textContent = demo[period] === null ? '—' : Math.round(demo[period])+'%';
      }
      $('quota-demo-controls').hidden = source !== 'demo';
      $('quota-consume').disabled = motion.matches || source !== 'demo';
      $('quota-consume').textContent = playing ? 'Ⅱ 暂停消耗' : '▷ 播放消耗';
      $('quota-demo-note').hidden = source !== 'demo';
      $('quota-demo-note').textContent = motion.matches ? '减少动态已开启，可拖动滑杆预览额度' : '演示额度仅供预览，保存后应用样式';
    }
    function renderThumbnails() {
      thumbs.splice(0).forEach(t=>{t.effect?.destroy();t.avatar?.destroy();});
      for (const button of $('quota-styles').children) {
        const host=button.querySelector('.quota-thumb'), art=host.querySelector('.quota-thumb-body'); art.replaceChildren();
        const avatar=window.PetChatAvatar.create(art);
        avatar.setActive(false);avatar.update(getAppearance());
        const e=window.QuotaEffects?.create(art); e?.update({appearance:getAppearance(),config:{...config,style:button.dataset.style},quotas:{fiveHour:74,weekly:38},theme:document.documentElement.dataset.theme==='dark'?'dark':'light',reducedMotion:true,visible:true});
        thumbs.push({avatar,effect:e});
      }
    }
    for (const [id,name,description] of styles) {
      const button=document.createElement('button');button.type='button';button.className='quota-style';button.dataset.style=id;
      const thumb=document.createElement('span');thumb.className='quota-thumb';
      const art=document.createElement('span');art.className='quota-thumb-body';thumb.append(art);
      if(id==='card'){thumb.classList.add('with-card');const label=document.createElement('span');label.className='quota-thumb-card';label.textContent='5h 74%';thumb.append(label);}
      const copy=document.createElement('span'),title=document.createElement('strong'),desc=document.createElement('small'),kind=document.createElement('em');title.textContent=name;desc.textContent=description;copy.append(title,desc);kind.textContent=id==='card'?'单 / 双':['pool','ring'].includes(id)?'单':'双';button.append(thumb,copy,kind);
      button.addEventListener('click',()=>{config=QuotaDisplay.normalize({...config,style:id});refresh();renderThumbnails();});$('quota-styles').append(button);
    }
    document.querySelectorAll('[data-quota-material]').forEach(b=>b.addEventListener('click',()=>{config.material=b.dataset.quotaMaterial;refresh();renderThumbnails();}));
    $('quota-card-size').addEventListener('change',e=>{config.cardSize=e.target.value;refresh();});
    $('quota-numbers').addEventListener('change',e=>{config.showNumbers=e.target.checked;refresh();});
    for(const period of ['fiveHour','weekly']) {
      $('quota-demo-'+period).addEventListener('input',e=>{demo[period]=Number(e.target.value);refresh();});
      document.querySelectorAll('[data-demo-period="'+period+'"]').forEach(b=>b.addEventListener('click',()=>{demo[period]=b.dataset.demoValue==='unknown'?null:Number(b.dataset.demoValue);refresh();}));
    }
    function stop(){playing=false;clearInterval(timer);timer=null;}
    $('quota-consume').addEventListener('click',()=>{
      if(playing)stop();else if(!motion.matches){playing=true;lastTick=performance.now();timer=setInterval(()=>{const now=performance.now(),dt=(now-lastTick)/1000;lastTick=now;for(const p of ['fiveHour','weekly'])if(demo[p]!==null)demo[p]=Math.max(0,demo[p]-dt*(p==='fiveHour'?4:1.4));refresh();if(Object.values(demo).every(v=>v===null||v===0)){stop();refresh();}},80);}refresh();
    });
    document.querySelectorAll('[data-quota-source]').forEach(b=>b.addEventListener('click',()=>{source=b.dataset.quotaSource;stop();document.querySelectorAll('[data-quota-source]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));refresh();}));
    const unsubscribe=bridge.onQuota?.(model=>{currentModel=model;current=QuotaDisplay.values(model);if(source==='current')refresh();});
    const reduce=()=>{if(motion.matches)stop();refresh();}; motion.addEventListener('change',reduce);
    const visibility=()=>{if(document.hidden)stop();refresh();};document.addEventListener('visibilitychange',visibility);
    return {
      getConfig:()=>QuotaDisplay.normalize({...config,period:'both'}),
      load(value,model){config=QuotaDisplay.normalize(value);currentModel=model;current=QuotaDisplay.values(model);refresh();renderThumbnails();},
      refresh,
      appearanceChanged(){refresh();renderThumbnails();},
      show(value){shown=value;$('quota-demo-tools').hidden=!value;if(!value)stop();refresh();},
      destroy(){disposed=true;stop();unsubscribe?.();motion.removeEventListener('change',reduce);document.removeEventListener('visibilitychange',visibility);effect?.destroy();thumbs.forEach(t=>{t.effect?.destroy();t.avatar?.destroy();});}
    };
  }};
})();
