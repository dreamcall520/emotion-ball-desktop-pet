/* In-memory examples; saving never changes the installed desktop pet. */
(() => {
  const root = document.querySelector('[data-customize-demo]');
  if (!root) return;
  const get = name => root.querySelector(`[data-custom-${name}]`);
  const labels = { blob: '经典', cloud: '云朵', aurora: '幻彩', square: '方糖' };
  let shape = 'blob', ball, avatarBall, saved, presets = [];
  const snapshot = () => ({ shape, body: get('body').value, eye: get('eye').value, opacity: get('opacity').value, style: get('stage').dataset.style || 'dimensional' });
  function draw(host, appearance, animated = false) {
    host.replaceChildren(); host.dataset.shape = appearance.shape;
    host.style.opacity = String(1 - Number(appearance.opacity) / 100);
    if (appearance.shape === 'aurora') {
      const img = document.createElement('img');
      img.src = `assets/custom-aurora-${appearance.style}.png`; img.alt = '幻彩六瓣形象示例'; host.append(img);
      return null;
    }
    const instance = window.EmotionBall.create(host, { emotion: '02', shape: appearance.shape,
      customShape: window.EB_CUSTOM_SHAPES.createShape({ shape: appearance.shape }), color: appearance.body,
      eyeColor: appearance.eye, idle: false, lite: true, autostart: false });
    instance.renderStatic();
    if (animated) instance.setActive(!window.matchMedia('(prefers-reduced-motion: reduce)').matches && !document.hidden);
    return instance;
  }
  function render() {
    ball?.destroy(); ball = null;
    const appearance = snapshot(), aurora = shape === 'aurora';
    get('ball').hidden = aurora; get('palette').hidden = !aurora;
    get('colors').hidden = aurora; get('styles').hidden = !aurora;
    root.querySelectorAll('[data-custom-shape]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.customShape === shape)));
    root.querySelectorAll('[data-custom-style]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.customStyle === appearance.style)));
    get('description').textContent = aurora ? '六瓣幻彩，立体光泽或简色渐变。' : `${labels[shape]}形态，配色实时预览。`;
    get('opacity-label').textContent = `${appearance.opacity}%`;
    get('stage').style.setProperty('--custom-pixels', `${get('pixels').value}px`);
    get('ball').setAttribute('aria-label', `${labels[shape]}配色示意`);
    if (aurora) {
      get('artwork').src = `assets/custom-aurora-${appearance.style}.png`;
      get('artwork').style.opacity = String(1 - Number(appearance.opacity) / 100);
      get('caption').textContent = appearance.style === 'simple' ? '幻彩 · 简色渐变' : '幻彩 · 立体幻彩';
    } else ball = draw(get('ball'), appearance);
  }
  root.querySelectorAll('[data-custom-shape]').forEach(b => b.addEventListener('click', () => {
    shape = b.dataset.customShape; get('body').value = shape === 'cloud' ? '#5b3bc7' : '#eeebe4'; get('eye').value = shape === 'cloud' ? '#ffffff' : '#1a1a1a'; render();
  }));
  for (const name of ['body', 'eye', 'opacity']) get(name).addEventListener('input', render);
  get('pixels').addEventListener('change', render);
  for (const kind of ['size', 'style']) root.querySelectorAll(`[data-custom-${kind}]`).forEach(b => b.addEventListener('click', () => {
    get('stage').dataset[kind] = b.dataset[kind === 'size' ? 'customSize' : 'customStyle'];
    root.querySelectorAll(`[data-custom-${kind}]`).forEach(item => item.setAttribute('aria-pressed', String(item === b))); render();
  }));
  function applySaved() {
    avatarBall?.destroy();
    avatarBall = draw(document.querySelector('[data-custom-chat-avatar]'), saved, true); activity();
    get('startup-note').textContent = `已保存示例${labels[saved.shape]}外观，聊天头像已同步。${get('startup').checked ? '示例启动外观已更新。' : '示例临时换装。'}不会改动桌面球球。`;
  }
  get('save').addEventListener('click', () => { saved = snapshot(); applySaved(); });
  get('startup').addEventListener('change', () => {
    get('startup-note').textContent = get('startup').checked ? '保存后将这套示例设为启动外观。' : '仅示例临时换装，启动外观保持。';
  });
  get('collect').addEventListener('click', () => {
    const appearance = snapshot(), name = get('name').value.trim() || `${labels[shape]}形象`;
    if (presets.some(p => JSON.stringify(p.appearance) === JSON.stringify(appearance))) { get('startup-note').textContent = '这套示例形象已在收藏里。'; return; }
    if (presets.length >= 4) { get('startup-note').textContent = '网页最多展示四套示例；App 可保存二十套形象。'; return; }
    presets.push({ name, appearance });
    const b = document.createElement('button'); b.type = 'button'; b.className = 'customize-preset-item';
    const thumb = document.createElement('span'); thumb.className = 'customize-preset-thumb'; draw(thumb, appearance);
    const text = document.createElement('span'); text.textContent = name; b.append(thumb, text);
    b.addEventListener('click', () => { shape = appearance.shape; for (const key of ['body', 'eye', 'opacity']) get(key).value = appearance[key]; get('stage').dataset.style = appearance.style; render(); get('startup-note').textContent = `已载入「${name}」预览，保存后才应用。`; });
    get('presets').append(b); get('startup-note').textContent = `已收藏示例「${name}」。`;
  });
  get('reset').addEventListener('click', () => {
    get('body').value = shape === 'cloud' ? '#5b3bc7' : '#eeebe4'; get('eye').value = shape === 'cloud' ? '#ffffff' : '#1a1a1a'; get('opacity').value = '0'; get('stage').dataset.style = 'dimensional'; render(); get('startup-note').textContent = '已恢复默认预览，保存后才应用。';
  });
  let paused = false, avatarVisible = false;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  function activity() { avatarBall?.setActive(!paused && avatarVisible && !reduced.matches && !document.hidden); }
  reduced.addEventListener('change', activity); document.addEventListener('visibilitychange', activity);
  document.addEventListener('website-motion-pause', event => { paused = Boolean(event.detail?.paused); activity(); });
  new IntersectionObserver(entries => { avatarVisible = entries[0].isIntersecting; activity(); }).observe(document.querySelector('[data-custom-chat-avatar]'));
  render(); saved = snapshot(); draw(get('classic-thumb'), saved); avatarBall = draw(document.querySelector('[data-custom-chat-avatar]'), saved, true); activity();
})();
