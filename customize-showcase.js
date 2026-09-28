/* Live classic palette; other shapes use previews exported from the App. */
(() => {
  const root = document.querySelector('[data-customize-demo]');
  if (!root) return;
  const get = name => root.querySelector(`[data-custom-${name}]`);
  let shape = 'blob', ball;
  const descriptions = {
    blob: '熟悉的球球，也能换一套喜欢的配色。',
    cloud: '柔软的云朵外观。',
    aurora: '立体光泽，或简洁渐变，选一种喜欢的样子。',
    square: '圆润的方糖外观。'
  };
  function render() {
    ball?.destroy(); ball = null;
    const host = get('ball'), body = get('body').value, eye = get('eye').value;
    host.replaceChildren(); host.hidden = shape !== 'blob';
    get('palette').hidden = shape === 'blob';
    get('colors').hidden = shape !== 'blob';
    get('styles').hidden = shape !== 'aurora';
    get('description').textContent = descriptions[shape];
    get('opacity-label').textContent = `${get('opacity').value}%`;
    host.style.opacity = get('artwork').style.opacity = String(1 - Number(get('opacity').value) / 100);
    host.setAttribute('aria-label', `${{blob:'经典',cloud:'云朵',square:'方糖',aurora:'幻彩'}[shape]}配色示意`);
    if (shape === 'blob') {
      ball = window.EmotionBall.create(host, { emotion: '02', shape: 'blob', color: body, eyeColor: eye, idle: false, lite: true, autostart: false });
      ball.renderStatic();
    } else {
      const simple = get('stage').dataset.style === 'simple';
      get('artwork').src = shape === 'aurora'
        ? (simple ? 'assets/custom-aurora-simple.png' : 'assets/custom-aurora-dimensional.png')
        : `assets/custom-${shape}.svg`;
      get('artwork').alt = shape === 'aurora' ? `幻彩 · ${simple ? '简色渐变' : '立体幻彩'}` : { cloud: '云朵', square: '方糖' }[shape];
      get('caption').textContent = get('artwork').alt;
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
    if (kind === 'style') render();
  }));
  get('startup').addEventListener('change', () => {
    get('startup-note').textContent = get('startup').checked ? '在 App 中保存后，下次打开仍使用这套外观。' : '在 App 中只临时换装，下次打开恢复原来的启动外观。';
  });
  render();
})();
