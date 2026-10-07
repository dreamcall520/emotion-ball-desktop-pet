(() => {
  'use strict';
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const motionButton = document.querySelector('[data-motion-control]');
  const themeButton = document.querySelector('[data-theme-control]');
  const touch = document.querySelector('[data-pet-touch]');
  const reply = document.querySelector('[data-pet-reply]');
  const menus = [...document.querySelectorAll('details')];
  const canvas = document.querySelector('.scene-material');
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  let image = document.querySelector('.scene-image');
  const darkSource = document.querySelector('.scene-dark-source');
  const lightSource = image.src;
  let sceneTheme = root.dataset.theme || (systemTheme.matches ? 'dark' : 'light'), themeRequest = 0;
  let paused = false, replyTimer;
  let lastDrop = -Infinity, lastX = NaN, lastY = NaN;
  let frame = 0, lastFrame = 0, elapsed = 0, gl, program, uniforms, texture, textureImage;
  let waves = [], imageRect = [0, 0, 1, 1], width = 1, height = 1;
  let blinkAt = 2 + Math.random() * 2, blinkStart = -10, blinkCount = 1;

  function stopped() { return paused || reduced.matches || document.hidden; }

  function reconcile() {
    root.classList.toggle('motion-paused', stopped());
    cancelAnimationFrame(frame); frame = 0; lastFrame = 0;
    if (stopped()) waves = [];
    const ready = gl && texture && textureImage === image && image.complete && image.naturalWidth;
    canvas.dataset.state = reduced.matches ? 'reduced' : !ready ? 'static' : stopped() ? 'paused' : 'running';
    if (ready) {
      draw();
      if (!stopped()) frame = requestAnimationFrame(animate);
    }
    motionButton.disabled = reduced.matches;
    motionButton.setAttribute('aria-pressed', String(paused || reduced.matches));
    const label = reduced.matches ? '已减少动态' : paused ? '继续动效' : '暂停动效';
    motionButton.setAttribute('aria-label', label);
    motionButton.title = label;
    motionButton.querySelector('use').setAttribute('href', paused ? '#icon-play' : '#icon-pause');
  }
  motionButton.addEventListener('click', () => { paused = !paused; reconcile(); });
  reduced.addEventListener('change', reconcile);
  document.addEventListener('visibilitychange', reconcile);

  async function setTheme(theme) {
    const request = ++themeRequest;
    const nextTheme = theme === 'auto' ? (systemTheme.matches ? 'dark' : 'light') : theme;
    themeButton.dataset.choice = theme;
    let nextImage = image;
    if (nextTheme !== sceneTheme) {
      nextImage = image.cloneNode(false);
      nextImage.src = nextTheme === 'dark' ? darkSource.srcset : lightSource;
      try { await nextImage.decode(); } catch {}
      if (request !== themeRequest) return;
    }
    // Keep the complete current scene until the next image can be committed with its colors.
    cancelAnimationFrame(frame); frame = 0; lastFrame = 0;
    canvas.style.opacity = '0';
    root.dataset.theme = nextTheme;
    darkSource.media = nextTheme === 'dark' ? 'all' : 'not all';
    if (nextImage !== image) {
      image.replaceWith(nextImage); image = nextImage;
      image.addEventListener('load', imageState);
      image.addEventListener('error', imageState);
    }
    sceneTheme = nextTheme;
    imageState();
    document.querySelector('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue('--page').trim();
    const label = { auto: '跟随系统', light: '浅色外观', dark: '深色外观' }[theme];
    themeButton.querySelector('use').setAttribute('href', { auto: '#icon-monitor', light: '#icon-sun', dark: '#icon-moon' }[theme]);
    themeButton.setAttribute('aria-label', `切换外观，当前${label}`);
    themeButton.title = `外观：${label}`;
    try { localStorage.setItem('emotion-ball-site-theme', theme); } catch {}
  }
  setTheme(root.dataset.theme || 'auto');
  themeButton.disabled = false;
  themeButton.addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    setTheme(order[(order.indexOf(themeButton.dataset.choice) + 1) % order.length]);
  });
  document.addEventListener('click', event => {
    for (const menu of menus) if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') for (const menu of menus) if (menu.open) {
      menu.open = false; menu.querySelector('summary').focus();
    }
  });
  for (const menu of menus) menu.addEventListener('toggle', () => {
    if (menu.open) for (const other of menus) if (other !== menu) other.open = false;
  });

  const licenseDialog = document.querySelector('#license-dialog');
  document.querySelector('[data-license-open]').addEventListener('click', () => licenseDialog.showModal());
  licenseDialog.addEventListener('click', event => {
    const rect = licenseDialog.getBoundingClientRect();
    if (event.target === licenseDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) licenseDialog.close();
  });

  // Preserve existing section URLs when the long page moves into product/.
  const oldSections = ['features', 'codex', 'chat', 'customize', 'notes', 'appearance', 'download', 'install', 'privacy', 'license'];
  function followOldSection() {
    if (location.hash === '#updates' || location.hash === '#privacy') { location.replace(`${location.hash.slice(1)}/${location.search}`); return; }
    if (oldSections.includes(location.hash.slice(1))) location.replace(`product/${location.search}${location.hash}`);
  }
  window.addEventListener('hashchange', followOldSection);
  followOldSection();

  function staticScene() {
    cancelAnimationFrame(frame); frame = 0; waves = [];
    canvas.style.opacity = '0'; canvas.dataset.state = 'static'; canvas.dataset.waves = '0';
  }
  function startMaterial() {
    try {
      gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
      if (!gl) return;
      const vertex = `attribute vec2 position; varying vec2 uv;
        void main(){uv=position;gl_Position=vec4(position.x*2.-1.,1.-position.y*2.,0.,1.);}`;
      const fragment = `precision highp float;
        varying vec2 uv; uniform sampler2D image;
        uniform vec2 size; uniform vec4 imageRect; uniform float time, night, blink, eyePixel;
        uniform vec4 waves[3];
        // Reuse the original eye texture. Nearby skin fills only the eyelid area while it closes.
        vec3 eye(vec2 p, vec3 color, vec2 center, vec2 extent){
          vec2 delta=p*vec2(1672.,941.)-center;
          mat2 rotation=mat2(.995,.1,-.1,.995);
          vec2 local=rotation*delta;
          float edge=length(vec2(local.x,max(abs(local.y)-(extent.y-extent.x),0.)));
          float mask=1.-smoothstep(extent.x+4.,extent.x+14.,edge);
          if(mask<=0.)return color;
          mat2 inverseRotation=mat2(.995,-.1,.1,.995);
          vec2 left=(center+inverseRotation*vec2(-extent.x-22.,local.y))/vec2(1672.,941.);
          vec2 right=(center+inverseRotation*vec2(extent.x+22.,local.y))/vec2(1672.,941.);
          vec3 skin=mix(texture2D(image,left).rgb,texture2D(image,right).rgb,clamp(.5+local.x/(2.*(extent.x+22.)),0.,1.));
          float opening=mix(1.,.11,blink);
          float curve=blink*5.*max(0.,1.-local.x*local.x/(extent.x*extent.x));
          vec2 sampleLocal=vec2(local.x/mix(1.,.95,blink),(local.y-curve)/opening);
          // Pixel-sized coverage keeps compressed lids smooth; exclude the source eye's edge halo.
          vec2 halfSize=vec2(extent.x*mix(1.,.95,blink),extent.y*opening);
          float radius=min(halfSize.x,halfSize.y);
          vec2 rounded=max(abs(vec2(local.x,local.y-curve))-(halfSize-radius),0.);
          float coverage=1.-smoothstep(-eyePixel,eyePixel,length(rounded)-radius);
          vec3 detail=texture2D(image,(center+inverseRotation*sampleLocal)/vec2(1672.,941.)).rgb;
          vec3 ink=texture2D(image,(center+inverseRotation*vec2(local.x*.5,0.))/vec2(1672.,941.)).rgb;
          vec3 lid=mix(skin,mix(detail,ink,smoothstep(.65,.95,blink)),coverage);
          return mix(color,lid,mask);
        }
        void main(){
          vec2 p=(uv-imageRect.xy)/imageRect.zw;
          if(p.y<0.||p.y>1.){gl_FragColor=vec4(0.);return;}
          float glass=max(1.-smoothstep(.16,.54,p.y+(1.-p.x)*.42),
                          smoothstep(.48,.72,p.y-p.x*.5)*(1.-smoothstep(.62,.8,p.x)));
          vec2 bodyCenter=mix(vec2(.813,.727),vec2(.804,.706),night);
          vec2 bodyRadius=mix(vec2(.192,.358),vec2(.145,.249),night);
          float face=1.-smoothstep(.9,1.06,length((p-bodyCenter)/bodyRadius));
          glass*=1.-face;
          float quiet=smoothstep(.26,.34,p.x)*(1.-smoothstep(.63,.7,p.x))*
                      smoothstep(.27,.34,p.y)*(1.-smoothstep(.76,.83,p.y));
          float material=glass*(1.-quiet);
          vec2 offset=vec2(sin(p.y*9.-time*.8)*9.,cos(p.x*7.+time*.65)*6.)*material;
          float reflection=0.;
          for(int i=0;i<3;i++){
            vec4 drop=waves[i];
            if(drop.w>0.){
              vec2 d=(uv-drop.xy)*size; float distance=length(d);
              float front=distance-(12.+drop.z*135.);
              float envelope=exp(-front*front/3600.)*exp(-drop.z*1.1)*smoothstep(0.,.12,drop.z)*(1.-smoothstep(1.7,2.2,drop.z));
              float wave=sin(front*.075)*envelope*drop.w;
              offset+=d/max(distance,1.)*wave*5.2*mix(.6,1.,glass)*(1.-face);
              reflection+=wave*.07*mix(.65,1.,glass)*(1.-face);
            }
          }
          vec3 color=texture2D(image,p+offset/(size*imageRect.zw)).rgb;
          // Two traveling light bands follow the existing glass; no whole-image zoom or face distortion.
          float flow=p.x*9.+p.y*6.-time*.9;
          float sheen=pow(max(0.,sin(flow)),3.);
          float blue=pow(max(0.,sin(flow-1.5)),3.);
          // Preserve highlight detail: light uses remaining headroom instead of adding white over bright glass.
          color*=1.-material*(.015+.09*blue);
          color+=(1.-color)*material*(vec3(.7,.85,1.)*sheen*.06+vec3(0.,.003,.009)*blue)*mix(1.,.8,night);
          color=mix(color,vec3(.8,.9,1.),max(0.,reflection)*mix(1.,.6,night));
          color*=1.+min(0.,reflection)*mix(1.,.6,night);
          if(blink>0.){
            color=eye(p,color,mix(vec2(1277.,605.),vec2(1292.,664.),night),mix(vec2(24.,47.),vec2(21.,38.),night));
            color=eye(p,color,mix(vec2(1437.,585.),vec2(1420.,641.),night),mix(vec2(24.,47.),vec2(21.,38.),night));
          }
          gl_FragColor=vec4(color,1.);
        }`;
      function shader(type, code) {
        const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Material unavailable');
        return s;
      }
      const v = shader(gl.VERTEX_SHADER, vertex), f = shader(gl.FRAGMENT_SHADER, fragment);
      program = gl.createProgram(); gl.attachShader(program, v); gl.attachShader(program, f); gl.linkProgram(program);
      gl.deleteShader(v); gl.deleteShader(f);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Material unavailable');
      gl.useProgram(program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      uniforms = Object.fromEntries(['size', 'imageRect', 'time', 'night', 'blink', 'eyePixel', 'waves[0]'].map(name => [name, gl.getUniformLocation(program, name)]));
      texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } catch { gl = null; texture = null; staticScene(); }
  }
  function fit() {
    const scene = canvas.parentElement.getBoundingClientRect(), box = image.getBoundingClientRect();
    width = scene.width; height = scene.height;
    // ponytail: cap 1.3M pixels and 30fps; increase only after measured hardware budgets allow it.
    const ratio = Math.min(devicePixelRatio, 1.25, Math.sqrt(1300000 / (width * height)));
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
    const imageWidth = image.naturalWidth * scale, imageHeight = image.naturalHeight * scale;
    const position = getComputedStyle(image).objectPosition.split(' ').map(value => parseFloat(value) / 100);
    imageRect = [(box.left - scene.left - (imageWidth - box.width) * position[0]) / width,
      (box.top - scene.top - (imageHeight - box.height) * position[1]) / height, imageWidth / width, imageHeight / height];
    if (gl && texture) draw();
  }
  function draw() {
    if (textureImage !== image) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.size, width, height); gl.uniform4fv(uniforms.imageRect, imageRect);
    gl.uniform1f(uniforms.time, elapsed);
    gl.uniform1f(uniforms.night, root.dataset.theme === 'dark' || (!root.dataset.theme && systemTheme.matches) ? 1 : 0);
    if (elapsed >= blinkAt) {
      blinkStart = elapsed;
      blinkCount = Math.random() < .25 ? 2 : 1;
      blinkAt = blinkStart + 2 + Math.random() * 2;
    }
    const age = elapsed - blinkStart;
    const phase = blinkCount === 2 && age >= .45 ? age - .45 : age;
    const closure = phase < 0 || phase > .31 ? 0 : phase < .1 ? phase / .1 : phase < .15 ? 1 : (.31 - phase) / .16;
    const blink = closure * closure * (3 - 2 * closure);
    gl.uniform1f(uniforms.blink, blink);
    gl.uniform1f(uniforms.eyePixel, 1672 / (canvas.width * imageRect[2]));
    const field = new Float32Array(12);
    waves.forEach((wave, i) => field.set([wave[0], wave[1], elapsed - wave[2], wave[3]], i * 4));
    gl.uniform4fv(uniforms['waves[0]'], field); gl.drawArrays(gl.TRIANGLES, 0, 6);
    canvas.dataset.waves = String(waves.length);
    canvas.dataset.blink = blink === 0 ? 'open' : blink > .98 ? 'closed' : 'moving';
    canvas.style.opacity = reduced.matches ? '0' : '1';
  }
  function animate(now) {
    if (stopped()) { reconcile(); return; }
    if (!gl || !texture) return;
    if (!lastFrame || now - lastFrame >= 1000 / 30 - 1) {
      elapsed += lastFrame ? Math.min((now - lastFrame) / 1000, .1) : 0;
      lastFrame = now; waves = waves.filter(wave => elapsed - wave[2] < 2.2); draw();
    }
    frame = requestAnimationFrame(animate);
  }
  function imageState() {
    if (!image.complete) return;
    const ready = image.naturalWidth > 0;
    root.classList.toggle('scene-failed', !ready);
    root.dataset.sceneState = ready ? 'ready' : 'fallback';
    if (!ready) { staticScene(); reconcile(); return; }
    if (!gl && !reduced.matches) startMaterial();
    if (gl && texture) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      textureImage = image;
      waves = []; fit(); reconcile();
    } else reconcile();
  }
  image.addEventListener('load', imageState);
  image.addEventListener('error', imageState);
  if (image.complete) imageState();
  new ResizeObserver(fit).observe(canvas.parentElement);
  systemTheme.addEventListener('change', () => {
    if (themeButton.dataset.choice === 'auto') setTheme('auto');
  });
  reduced.addEventListener('change', imageState);
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); gl = null; texture = null; staticScene(); reconcile(); });
  canvas.addEventListener('webglcontextrestored', imageState);
  function emitRipple(event, clicked = false) {
    if (stopped() || !gl || !finePointer.matches || event.pointerType === 'touch' || event.target.closest('a, button')) return;
    const distance = Math.hypot(event.clientX - lastX, event.clientY - lastY);
    if (!clicked && (event.timeStamp - lastDrop < 220 || distance < 30)) return;
    const bounds = canvas.getBoundingClientRect();
    if (waves.length >= 3) waves.shift();
    waves.push([(event.clientX - bounds.left) / width, (event.clientY - bounds.top) / height, elapsed, clicked ? 2.1 : .7 + (Number.isFinite(distance) ? Math.min(distance / 100, .8) : 0)]);
    lastDrop = event.timeStamp; lastX = event.clientX; lastY = event.clientY;
  }
  const main = document.querySelector('.home-main');
  main.addEventListener('pointermove', event => emitRipple(event));
  main.addEventListener('pointerdown', event => { if (event.button === 0) emitRipple(event, true); });
  touch.addEventListener('click', () => {
    clearTimeout(replyTimer);
    reply.textContent = '你忙，我陪着。';
    reply.classList.add('visible');
    replyTimer = setTimeout(() => reply.classList.remove('visible'), 3000);
  });
  touch.disabled = false;
  reconcile();
  window.addEventListener('pagehide', () => {
    clearTimeout(replyTimer);
    cancelAnimationFrame(frame); frame = 0;
  });
  window.addEventListener('pageshow', reconcile);
})();
