/* Local-only palette demo with a static App artwork reference; no desktop settings access. */
(() => {
  const root = document.querySelector('[data-customize-demo]');
  if (!root) return;
  const get = name => root.querySelector(`[data-custom-${name}]`);
  let shape = 'blob', ball;
  const descriptions = {
    blob: '熟悉的球球，也能换一套喜欢的配色。',
    cloud: '云朵配色示意。App 内可微调轮廓与五官。',
    aurora: '下方控件仅演示配色，参考图不随配色或样式切换。',
    square: '方糖配色示意。App 内可微调轮廓与五官。'
  };
  function render() {
    ball?.destroy(); ball = null;
    const host = get('ball'), body = get('body').value, eye = get('eye').value;
    host.replaceChildren(); host.hidden = shape === 'aurora';
    get('palette').hidden = shape !== 'aurora';
    get('styles').hidden = shape !== 'aurora';
    get('sizes').hidden = shape === 'aurora';
    get('description').textContent = descriptions[shape];
    get('stage').style.setProperty('--custom-body', body);
    get('stage').style.setProperty('--custom-eye', eye);
    get('opacity-label').textContent = `${get('opacity').value}%`;
    host.style.opacity = get('artwork').style.opacity = get('swatches').style.opacity = String(1 - Number(get('opacity').value) / 100);
    host.setAttribute('aria-label', `${{blob:'经典',cloud:'云朵',square:'方糖',aurora:'幻彩'}[shape]}配色示意`);
    if (shape === 'blob') {
      ball = window.EmotionBall.create(host, { emotion: '02', shape: 'blob', color: body, eyeColor: eye, idle: false, lite: true, autostart: false });
      ball.renderStatic();
    } else if (shape !== 'aurora') {
      // Independent primitives, not the App's reference-derived cloud silhouette.
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 240 240');
      const add = (tag, attrs) => { const node = document.createElementNS(svg.namespaceURI, tag); for (const [key,value] of Object.entries(attrs)) node.setAttribute(key, value); svg.append(node); };
      if (shape === 'square') add('rect', { x: 30, y: 30, width: 180, height: 180, rx: 52, fill: body });
      else { add('rect', { x: 28, y: 100, width: 184, height: 96, rx: 48, fill: body }); add('circle', { cx: 87, cy: 110, r: 48, fill: body }); add('circle', { cx: 143, cy: 90, r: 53, fill: body }); }
      for (const x of [95,139]) add('rect', { x, y: 106, width: 13, height: 35, rx: 6.5, fill: eye });
      host.append(svg);
    }
  }
  root.querySelectorAll('[data-custom-shape]').forEach(button => button.addEventListener('click', () => {
    shape = button.dataset.customShape;
    root.querySelectorAll('[data-custom-shape]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    render();
  }));
  for (const name of ['body','eye','opacity']) get(name).addEventListener('input', render);
  for (const kind of ['size','style']) root.querySelectorAll(`[data-custom-${kind}]`).forEach(button => button.addEventListener('click', () => {
    get('stage').dataset[kind] = button.dataset[kind === 'size' ? 'customSize' : 'customStyle'];
    root.querySelectorAll(`[data-custom-${kind}]`).forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    if (kind === 'style') {
      get('glow-label').hidden = button.dataset.customStyle === 'simple';
      get('style-note').textContent = button.dataset.customStyle === 'simple' ? '简色渐变只显示球体与眼睛配色，不使用粉光、金光控件。' : '立体幻彩支持球体、眼睛、粉光与金光配色。';
    }
  }));
  get('startup').addEventListener('change', () => {
    get('startup-note').textContent = get('startup').checked ? '在 App 中保存后，下次打开仍使用这套外观。' : '在 App 中只临时换装，下次打开恢复原来的启动外观。';
  });
  render();
})();
