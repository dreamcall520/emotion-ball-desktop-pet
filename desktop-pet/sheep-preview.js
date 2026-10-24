(() => {
  'use strict';

  const actions = [
    { id: 'greet', title: '羊羊拜年', note: '前蹄作揖 · 新岁见面', symbol: '春', text: '新年好呀！把今年第一份好心情送给你，咩～' },
    { id: 'packet', title: '递个红包', note: '小蹄一伸 · 喜气送达', symbol: '囍', text: '红包里装了满满好运，记得分我一点开心呀！' },
    { id: 'lantern', title: '提灯等你', note: '灯笼轻晃 · 陪你晚归', symbol: '灯', text: '给你留了一盏暖暖的灯，忙完就回来歇歇吧。' },
    { id: 'fortune', title: '福气送到', note: '举起福字 · 接住好事', symbol: '福', text: '咩～福气到你家！今天的小愿望，也会慢慢长大。' },
    { id: 'nuzzle', title: '摸头蹭蹭', note: '低头贴贴 · 软乎回应', symbol: '♡', text: '再摸一下嘛……你的手心，比我的羊毛还暖。' },
    { id: 'bleat', title: '咩咩回应', note: '耳朵一动 · 认真听你', symbol: '咩', text: '咩？咩咩！翻译一下：我在呢，今天也陪着你。' },
    { id: 'proud', title: '得意洋洋', note: '昂头挺胸 · 夸夸自己', symbol: '✦', text: '这么棒的你，值得一只羊在旁边骄傲一下！' },
    { id: 'hop', title: '迎春小跳', note: '轻轻蹦起 · 好运加一', symbol: '跃', text: '蹦一下，好运冒芽；再蹦一下，烦恼放假！' },
    { id: 'sway', title: '摇铃小舞', note: '左右摇摆 · 铃声叮当', symbol: '铃', text: '叮铃铃～给你的新年，配一段快乐的小节拍。' },
    { id: 'peek', title: '探头找你', note: '歪头张望 · 想你一下', symbol: '探', text: '偷偷探个头……找到你啦！有没有想我一点点？' },
    { id: 'stretch', title: '伸个懒腰', note: '前蹄舒展 · 松松肩膀', symbol: '舒', text: '陪我伸个懒腰吧，把肩膀松开，好运才装得下。' },
    { id: 'sleep', title: '暖暖打盹', note: '闭眼团好 · 好梦作伴', symbol: '眠', text: '我先替你把梦捂暖……醒来，又是软绵绵的一天。' },
  ];
  const grid = document.getElementById('action-grid');
  const sizeGrid = document.getElementById('size-grid');
  const label = document.getElementById('dialogue-label');
  const dialogue = document.getElementById('dialogue-text');
  const pauseButton = document.getElementById('pause-toggle');
  const themeButton = document.getElementById('theme-toggle');
  const target = document.getElementById('main-pet');
  let paused = false;
  const instances = [];

  if (!window.SheepSkin || typeof window.SheepSkin.create !== 'function') {
    label.textContent = '预览尚未就绪';
    dialogue.textContent = '羊羊皮肤资源未能加载，请检查 sheep-skin.js 与样式文件。';
    target.disabled = true;
    pauseButton.disabled = true;
    return;
  }

  const sheep = window.SheepSkin.create(target, {
    emotion: '50', autostart: true, auroraTransparency: 0, label: '羊羊春节皮肤大图预览',
  });
  instances.push(sheep);

  function play(action) {
    if (paused) return;
    sheep.setMotionAction(action.id);
    label.textContent = action.title;
    dialogue.textContent = action.text;
    for (const button of grid.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.action === action.id));
    }
  }

  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-button';
    button.dataset.action = action.id;
    button.setAttribute('aria-pressed', 'false');
    const symbol = document.createElement('span');
    symbol.className = 'action-symbol';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = action.symbol;
    const copy = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'action-title';
    title.textContent = action.title;
    const note = document.createElement('span');
    note.className = 'action-note';
    note.textContent = action.note;
    copy.append(title, note);
    button.append(symbol, copy);
    button.addEventListener('click', () => play(action));
    grid.append(button);
  }

  for (const size of [60, 80, 120, 180]) {
    const item = document.createElement('div');
    item.className = 'size-item';
    const sample = document.createElement('div');
    sample.className = 'size-pet';
    sample.style.setProperty('--pet-size', `${size}px`);
    const caption = document.createElement('span');
    caption.className = 'size-caption';
    caption.textContent = `${size} px`;
    item.append(sample, caption);
    sizeGrid.append(item);
    const miniature = window.SheepSkin.create(sample, {
      emotion: '50', autostart: false, auroraTransparency: 0, label: `${size} 像素羊羊皮肤预览`,
    });
    miniature.setActive(false);
    instances.push(miniature);
  }

  target.addEventListener('click', () => play(actions.find(action => action.id === 'nuzzle')));
  document.addEventListener('pointermove', event => {
    if (paused || event.pointerType === 'touch') return;
    const rect = target.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width / 2)));
    const y = Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) / (rect.height / 2)));
    sheep.setGaze(x * 24, y * 15);
  }, { passive: true });
  document.addEventListener('pointerleave', () => sheep.setGaze(0, 0));

  themeButton.addEventListener('click', () => {
    const dark = document.body.dataset.theme !== 'dark';
    document.body.dataset.theme = dark ? 'dark' : 'light';
    themeButton.setAttribute('aria-pressed', String(dark));
    themeButton.textContent = dark ? '切换浅底' : '切换深底';
  });
  pauseButton.addEventListener('click', () => {
    paused = !paused;
    sheep.setActive(!paused);
    pauseButton.setAttribute('aria-pressed', String(paused));
    pauseButton.textContent = paused ? '继续动画' : '暂停动画';
    target.disabled = paused;
    for (const button of grid.querySelectorAll('button')) button.disabled = paused;
  });
  window.addEventListener('pagehide', () => {
    for (const instance of instances) instance.destroy();
  }, { once: true });
})();
