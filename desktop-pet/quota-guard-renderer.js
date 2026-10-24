/* v19 character art and guard battle, driven only by the sanitized native model. */
(function (root) {
  'use strict';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const WIN_HITS = 30, END_DURATION = 2200;
  const ease = value => { const p = clamp(value, 0, 1); return p * p * (3 - 2 * p); };
  const pulse = (time, start, duration) => time <= start || time >= start + duration ? 0 : Math.sin((time - start) / duration * Math.PI) ** 2;
  const biteAmount = quota => quota === null ? 0 : clamp((20 - quota) / 20, 0, 1);
  const accessory = (quota, defeated) => quota === null ? 'none' : defeated ? 'halo' : quota > 10 ? 'crown' : 'none';
  function primary(value) {
    try {
      const item = value?.state === 'ready' && Array.isArray(value.items) ? value.items[0] : null;
      return item && Number.isFinite(item.remaining) && item.remaining >= 0 && item.remaining <= 100 &&
        Number.isSafeInteger(item.windowMinutes) && item.windowMinutes > 0
        ? { remaining: item.remaining, windowMinutes: item.windowMinutes } : null;
    } catch (_) { return null; }
  }
  function spring(x, velocity, target, dt, speed) {
    const distance = x - target, c = velocity + speed * distance, e = Math.exp(-speed * dt);
    return [target + (distance + c * dt) * e, (velocity - speed * c * dt) * e];
  }
  function bitePath(amount) {
    const edge = 246 - 130 * clamp(amount, 0, 1);
    return `M ${edge + 12} -30 H 290 V 290 H ${edge + 12} V 216 Q ${edge - 7} 201 ${edge + 7} 185 Q ${edge - 15} 169 ${edge + 4} 151 Q ${edge - 18} 133 ${edge + 3} 116 Q ${edge - 17} 98 ${edge + 7} 80 Q ${edge - 10} 63 ${edge + 12} 46 Z`;
  }

  class GuardGame {
    constructor() {
      this.available = false; this.visible = true; this.modelVisible = true; this.paused = false; this.reduced = false;
      this.signature = ''; this.quota = null; this.period = null; this.round = 0;
      this.time = 0; this.flight = []; this.effects = []; this.outcome = null;
      this.playerHits = this.hits = this.clickShots = this.autoShots = this.shots = 0;
      this.zombieX = 131; this.zombieV = 0; this.bite = this.desiredBite = 0; this.endingAt = 0;
      this.progress = this.drive = this.recoil = this.shotTempo = this.elapsed = 0;
      this.shotAt = this.hitAt = this.biteAt = -10000; this.pendingBite = null; this.serial = 0;
    }
    get active() { return this.available && this.visible && !this.paused && !this.reduced; }
    get ended() { return this.outcome !== null; }
    get endingProgress() { return this.reduced ? 1 : clamp((this.time - this.endingAt) / END_DURATION, 0, 1); }
    get animating() { return this.active && (!this.ended || this.endingProgress < 1 || Math.abs(this.bite - this.desiredBite) > .001); }
    setModel(value) {
      const item = primary(value), reopened = this.modelVisible === false && value?.visible !== false;
      this.available = Boolean(item); this.visible = this.modelVisible = value?.visible !== false;
      if (item) {
        const signature = `${item.windowMinutes}:${item.remaining}`;
        const restart = reopened && this.ended && item.remaining > 0;
        if (signature !== this.signature || restart) {
          if (restart) this.paused = false;
          this.signature = signature; this.quota = item.remaining; this.period = item.windowMinutes; this.reset();
        }
      }
    }
    reset() {
      if (this.quota === null) return;
      this.round++; this.time = 0; this.baseProgress = 1 - this.quota / 100; this.progress = this.baseProgress;
      this.drive = this.recoil = this.shotTempo = this.elapsed = this.playerHits = this.hits = this.shots = this.clickShots = this.autoShots = 0;
      this.outcome = null; this.endingAt = 0; this.nextBite = 700; this.autoAt = 520;
      this.shotAt = this.hitAt = this.biteAt = -10000; this.pendingBite = null;
      this.flight = []; this.effects = []; this.gameBite = 0; this.bite = this.desiredBite = biteAmount(this.quota);
      this.zombieX = 131 - (131 - 33.104) * this.progress; this.zombieV = 0;
      if (this.quota === 0) { this.finish('zombie'); this.endingAt = -END_DURATION; this.bite = 1; }
    }
    advance() { if (!this.active || this.ended) return false; this.drive = Math.min(1.14 - this.baseProgress, this.drive + .14); return true; }
    shoot(auto = false) {
      if (!this.active || this.ended || this.time - this.shotAt < 120 || this.flight.length >= 7) return false;
      if (!auto) this.shotTempo = Math.min(1, this.shotTempo + .32);
      this.shotAt = this.time; this.shots++; this[auto ? 'autoShots' : 'clickShots']++;
      const speed = auto ? 220 : 260 + this.shotTempo * 160; this.lastProjectileSpeed = speed;
      this.flight.push({ id: ++this.serial, at: this.time, x: 28.12, y: 17.2, speed, auto }); return true;
    }
    finish(outcome) {
      if (this.ended || !this.available) return;
      this.outcome = this.quota === 0 ? 'zombie' : outcome; this.endingAt = this.time;
      this.drive = this.recoil = 0; this.pendingBite = null; this.flight = []; this.effects = [];
      this.desiredBite = this.outcome === 'zombie' ? 1 : 0;
    }
    hit(shot) {
      this.hits++; if (!shot.auto) this.playerHits++;
      this.hitAt = this.time; this.recoil = Math.min(.6, this.recoil + (shot.auto ? .028 : .16 + this.shotTempo * .08));
      if (!shot.auto) this.drive = Math.max(0, this.drive - .14);
      this.effects.push({ id: ++this.serial, kind: 'impact', at: this.time, x: this.zombieX - 4.2, y: 12 });
    }
    step(milliseconds) {
      if (!this.active) return;
      const dt = clamp(milliseconds, 0, 64), seconds = dt / 1000; this.time += dt;
      this.drive *= Math.exp(-seconds / 2.2); this.recoil *= Math.exp(-seconds / .4); this.shotTempo *= Math.exp(-seconds / .65);
      if (!this.ended && this.playerHits >= WIN_HITS) this.finish('qiuqiu');
      if (!this.ended) {
        this.elapsed += seconds * .026;
        this.progress = clamp(this.baseProgress + this.elapsed + this.drive + Math.sin(this.time / 3500 * Math.PI * 2) * .014 - this.recoil, 0, 1);
        if (this.time >= this.autoAt) { this.shoot(true); this.autoAt = this.time + 1350; }
        if (this.pendingBite && (this.progress < .93 || this.zombieX > 41.104)) this.pendingBite = null;
        if (this.pendingBite && this.time >= this.pendingBite.at) {
          this.gameBite = this.pendingBite.amount; this.desiredBite = Math.max(biteAmount(this.quota), this.gameBite); this.pendingBite = null;
          for (let i = 0; i < 3; i++) this.effects.push({ id: ++this.serial, kind: 'crumb', at: this.time, x: 24.48, y: 18.6, vx: 5 + i * 6, vy: -12 - i * 4 });
          if (this.desiredBite >= .995) this.finish('zombie');
        }
        if (!this.ended && this.progress >= .97 && this.zombieX <= 37.104 && !this.pendingBite && this.time >= this.nextBite) {
          this.biteAt = this.time; this.pendingBite = { at: this.time + 350, amount: this.gameBite < .3 ? .3 : this.gameBite < .64 ? .64 : 1 }; this.nextBite = this.time + 1050;
        }
      } else this.progress = this.outcome === 'qiuqiu' ? 0 : 1;
      const target = this.outcome === 'qiuqiu' ? 131 : 131 - (131 - 33.104) * this.progress + (this.outcome === 'zombie' ? 7 : 0);
      [this.zombieX, this.zombieV] = spring(this.zombieX, this.zombieV, target, seconds, this.outcome === 'qiuqiu' ? 9 : 19);
      this.bite += (this.desiredBite - this.bite) * (1 - Math.exp(-dt / 85)); if (Math.abs(this.bite - this.desiredBite) < .001) this.bite = this.desiredBite;
      this.flight = this.flight.filter(shot => {
        const dx = this.zombieX - 3.36 - shot.x, dy = 11.18 - shot.y, distance = Math.hypot(dx, dy), travel = dt * shot.speed / 1000;
        if (distance < travel + 7) { this.hit(shot); return false; }
        if (this.time - shot.at > 2000) return false;
        shot.x += dx / distance * travel; shot.y += dy / distance * travel; return true;
      });
      this.effects = this.effects.filter(effect => this.time - effect.at < (effect.kind === 'impact' ? 360 : 520));
    }
    snapshot() { return { ready: this.available, visible: this.visible, paused: this.paused, reduced: this.reduced, round: this.round, quota: this.quota, period: this.period, time: this.time, outcome: this.outcome, endingProgress: this.endingProgress, playerHits: this.playerHits, winHits: WIN_HITS, hits: this.hits, shots: this.shots, autoShots: this.autoShots, clickShots: this.clickShots, lastProjectileSpeed: this.lastProjectileSpeed || 0, progress: this.progress, drive: this.drive, recoil: this.recoil, zombieX: this.zombieX, zombieV: this.zombieV, bite: this.bite, flight: this.flight.length, effects: this.effects.length }; }
  }
  if (typeof module === 'object' && module.exports) module.exports = { GuardGame, primary, bitePath, spring, WIN_HITS };
  if (!root.document) return;
  const doc = root.document, $ = id => doc.getElementById(id), ns = 'http://www.w3.org/2000/svg';
  const reduced = root.matchMedia('(prefers-reduced-motion: reduce)'), darkMedia = root.matchMedia('(prefers-color-scheme: dark)');
  const svg = (tag, attrs = {}) => { const element = doc.createElementNS(ns, tag); for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value); return element; };
  const crownImage = () => svg('image', { href: 'assets/quota-guard/crown.svg', x: 55, y: -55, width: 120, height: 90 });
  const periodText = minutes => minutes === 300 ? '5 小时额度' : minutes === 10080 ? '本周额度' : `${minutes} 分钟额度`;
  let destroyed = false, sprites = null;
  async function loadSprites(modes = ['walk', 'attack']) {
    const result = {};
    for (const mode of modes) {
      const bytes = Uint8Array.from(atob(root.ZOMBIE_SOURCES[mode]), char => char.charCodeAt(0));
      const frames = []; let duration = 0;
      if (root.ImageDecoder) {
        const decoder = new root.ImageDecoder({ data: bytes, type: 'image/gif', preferAnimation: true }); await decoder.tracks.ready;
        for (let index = 0; index < decoder.tracks.selectedTrack.frameCount; index++) {
          const frame = await decoder.decode({ frameIndex: index });
          frames.push({ bitmap: await createImageBitmap(frame.image), at: duration, duration: (frame.image.duration || 100000) / 1000 });
          duration += frames.at(-1).duration; frame.image.close();
        }
        decoder.close();
      } else { frames.push({ bitmap: await createImageBitmap(new Blob([bytes], { type: 'image/gif' })), at: 0, duration: 100 }); duration = 100; }
      result[mode] = { frames, duration };
    }
    if (destroyed) { for (const seq of Object.values(result)) for (const frame of seq.frames) frame.bitmap.close(); return null; }
    return result;
  }
  function drawSprite(canvas, mode, time, alignLeft = false) {
    const seq = sprites[mode], local = time % seq.duration, frame = seq.frames.find(frame => local < frame.at + frame.duration) || seq.frames[0];
    const context = canvas.getContext('2d'); context.clearRect(0, 0, 87, 124); context.drawImage(frame.bitmap, 63, 20, 87, 124, 0, 0, 87, 124);
    if (alignLeft) {
      if (frame.leftOffset === undefined) {
        const pixels = context.getImageData(0, 0, 87, 124).data;
        let left = -1;
        for (let x = 0; x < 87 && left < 0; x++) for (let y = 0; y < 124; y++) {
          if (pixels[(y * 87 + x) * 4 + 3] > 0) { left = x; break; }
        }
        frame.leftOffset = left < 0 ? 0 : -left;
      }
      if (frame.leftOffset) {
        context.clearRect(0, 0, 87, 124);
        context.drawImage(frame.bitmap, 63, 20, 87, 124, frame.leftOffset, 0, 87, 124);
      }
    }
  }
  function createPet(host, id, clock) {
    const ball = root.EmotionBall.createBall(host, { shape: 'blob', lite: true, liteRibbons: true, now: clock });
    const body = ball.svg.querySelector('.eb-eye').parentElement, path = svg('path', { fill: 'black' });
    const mask = svg('mask', { id: `${id}-bite-mask`, maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse', x: -30, y: -30, width: 320, height: 320 });
    mask.append(svg('rect', { x: -30, y: -30, width: 320, height: 320, fill: 'white' }), path); ball.svg.querySelector('defs').append(mask); body.setAttribute('mask', `url(#${id}-bite-mask)`);
    const dead = svg('g', { fill: 'none', stroke: '#39383d', 'stroke-width': 6.5, 'stroke-linecap': 'round', visibility: 'hidden' }); dead.append(svg('path', { d: 'M74 108l16 16m0-16l-16 16' })); body.append(dead);
    const accessories = svg('g', { 'pointer-events': 'none', 'aria-hidden': 'true' }), crown = svg('g', { visibility: 'hidden', transform: 'translate(17 8) scale(.85)' }), halo = svg('g', { visibility: 'hidden' });
    crown.append(crownImage()); crown.style.filter = 'saturate(.65)';
    halo.innerHTML = '<ellipse cx="116" cy="-19" rx="46" ry="13" fill="none" stroke="#f3c75c" stroke-opacity=".21" stroke-width="22"/><ellipse cx="116" cy="-19" rx="46" ry="13" fill="none" stroke="#a87629" stroke-opacity=".7" stroke-width="10"/><ellipse cx="116" cy="-19" rx="46" ry="13" fill="none" stroke="#ffdc6e" stroke-width="8"/><path d="M72 -22A46 13 0 0 1 159 -22" fill="none" stroke="#fff9dd" stroke-width="3.5" stroke-linecap="round"/><path d="M61 -37v10m-5-5h10 M171 -9v8m-4-4h8" stroke="#f3ca67" stroke-width="3" stroke-linecap="round"/>';
    accessories.append(crown, halo); ball.svg.append(accessories); return { ball, body, path, dead, accessories, crown, halo };
  }
  function renderPet(pet, amount, mode, time, quiet, game) {
    const dead = amount >= .995, win = game?.outcome === 'qiuqiu', phase = game?.endingProgress ?? 1;
    const spin = win && phase < 1 && !reduced.matches ? spring(0, 0, Math.PI * 4, (game.time - game.endingAt) / 1000, 6.2)[0] : 0;
    const shoot = quiet || !game ? 0 : pulse((time - game.shotAt) / 1000, 0, .35), hurt = quiet || !game ? 0 : pulse((time - game.biteAt) / 1000, .04, .42);
    const eye = { open: win || quiet ? 1 : 1 - .94 * pulse(time / 1000 % 4.9, 4.2, .19), scaleX: 1, scaleY: 1, color: '#222126', lookX: quiet || win ? 0 : 3, lookY: 0, x: -amount * 47, y: amount * 16 };
    if (!(win && quiet && !reduced.matches)) pet.ball.applyPose({ body: { x: -shoot * 6 - hurt * 2, y: win || quiet || dead ? 0 : Math.sin(time / 500) * .7, rotate: win ? 0 : -shoot * 4 - hurt * 4, yaw: spin, scale: 1, scaleX: 1 - shoot * .035 + hurt * .03, scaleY: 1 + shoot * .025 - hurt * .025, color: '#EEEBE4', suppressRibbons: !win || phase >= 1 || reduced.matches || !game?.available, zzz: 0 }, left: eye, right: eye });
    pet.path.setAttribute('d', bitePath(amount)); for (const eyeNode of pet.body.querySelectorAll('.eb-eye')) eyeNode.setAttribute('visibility', dead ? 'hidden' : 'visible'); pet.dead.setAttribute('visibility', dead ? 'visible' : 'hidden');
    pet.accessories.setAttribute('transform', pet.body.getAttribute('transform') || ''); pet.crown.setAttribute('visibility', mode === 'crown' ? 'visible' : 'hidden'); pet.halo.setAttribute('visibility', mode === 'halo' ? 'visible' : 'hidden');
    pet.halo.setAttribute('transform', `translate(0 ${game?.outcome === 'zombie' ? 16 * (1 - ease(phase / .55)) : 0})`); pet.halo.setAttribute('opacity', game?.outcome === 'zombie' ? String(ease((phase - .12) / .3)) : '1');
  }
  function zombieCrown(host) { const group = svg('g', { transform: 'translate(-11 10) scale(.31)' }); group.append(crownImage()); host.append(group); }
  const cleanup = [];
  root.addEventListener('beforeunload', () => { destroyed = true; cleanup.forEach(dispose => { if (typeof dispose === 'function') dispose(); }); if (sprites) for (const seq of Object.values(sprites)) for (const frame of seq.frames) frame.bitmap.close(); }, { once: true });

  if ($('quota-guard-entry')) {
    const button = $('quota-guard-entry'), bridge = root.petQuotaLabel, pet = createPet($('guard-entry-pet'), 'entry', () => time), zombie = $('guard-entry-zombie');
    let model = null, time = 0, raf = 0, last = 0; zombieCrown(zombie.querySelector('svg'));
    const visible = () => Boolean(primary(model)) && model.expanded !== true && model.guardEntry !== false;
    const moving = () => sprites && visible() && model.visible !== false && !doc.hidden && !reduced.matches;
    function draw() {
      const item = primary(model); if (!item || !sprites) return; const q = item.remaining;
      button.setAttribute('aria-label', `${periodText(item.windowMinutes)}剩余 ${Math.round(q)}%，进入球球守护战`);
      button.dataset.role = q === 100 ? 'full' : q === 0 ? 'empty' : 'roaming';
      renderPet(pet, q === 0 ? 1 : 0, q === 0 ? 'halo' : q === 100 ? 'crown' : 'none', time, !moving());
      drawSprite(zombie.querySelector('canvas'), 'walk', q > 0 && q < 100 ? time * .75 : 0, true);
      const faceRight = model?.guardSide === 'left';
      zombie.dataset.facing = faceRight ? 'right' : 'left';
      zombie.style.transform = `rotate(${q === 0 && moving() ? Math.sin(time / 520) * 2 : 0}deg) scaleX(${faceRight ? -1 : 1})`;
      zombie.querySelector('svg').setAttribute('visibility', q === 0 ? 'visible' : 'hidden');
    }
    function frame(now) { raf = 0; if (!moving()) return; time += last ? clamp(now - last, 0, 64) : 16; last = now; draw(); raf = requestAnimationFrame(frame); }
    function wake() { cancelAnimationFrame(raf); raf = 0; last = 0; draw(); if (moving()) raf = requestAnimationFrame(frame); }
    cleanup.push(bridge.onModel(value => { model = value; doc.body.dataset.guardEntry = String(visible()); doc.body.dataset.guardSize = value?.size === 'compact' ? 'compact' : 'standard';
      doc.body.dataset.guardSide = value?.guardSide === 'left' ? 'left' : 'right';
      doc.body.style.setProperty('--quota-role-target-width', `${value?.guardTargetWidth === 48 ? 48 : 64}px`);
      doc.body.style.setProperty('--quota-card-left', `${value?.cardInset?.x || 0}px`);
      doc.body.style.setProperty('--quota-card-top', `${value?.cardInset?.y ?? (value?.size === 'compact' ? 18 : 6)}px`);
      button.hidden = !visible(); button.disabled = !sprites; wake(); }));
    button.addEventListener('click', event => { event.stopPropagation(); if (visible() && sprites) bridge.openGuard?.(); });
    reduced.addEventListener('change', wake); doc.addEventListener('visibilitychange', wake);
    cleanup.push(() => { cancelAnimationFrame(raf); reduced.removeEventListener('change', wake); doc.removeEventListener('visibilitychange', wake); pet.ball.destroy(); });
    loadSprites(['walk']).then(value => { sprites = value; if (destroyed) return; button.disabled = !sprites; wake(); }).catch(() => { button.hidden = true; doc.body.dataset.guardEntry = 'false'; });
    root.quotaGuardEntry = { get state() { return { ready: Boolean(sprites), visible: visible(), role: button.dataset.role || null, entryTime: time }; } };
    return;
  }
  if (!$('guard-panel') || !root.petQuotaGuard) return;
  const bridge = root.petQuotaGuard, game = new GuardGame(), pet = createPet($('guard-pet'), 'guard', () => game.time), effectNodes = new Map();
  let raf = 0, last = 0, spriteTime = 0, appearance = 'system', model = null, labelKey = ''; game.reduced = reduced.matches;
  zombieCrown($('guard-zombie-crown'));
  const awake = () => sprites && game.animating && !doc.hidden;
  const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  function labels() {
    const available = game.available, dead = game.outcome === 'zombie', win = game.outcome === 'qiuqiu';
    const key = [available, game.quota, game.period, game.outcome, game.playerHits, game.active, game.paused, reduced.matches, Boolean(sprites)].join(':');
    if (labelKey === key) return; labelKey = key;
    $('guard-theatre').dataset.available = String(available);
    $('guard-panel').dataset.outcome = game.outcome || 'playing'; text('guard-period', available ? periodText(game.period) : 'Codex 额度'); text('guard-number', available ? `${Math.round(game.quota)}%` : '--%');
    const description = available ? `${periodText(game.period)}剩余 ${Math.round(game.quota)}%` : '额度等待更新';
    if ($('guard-number').getAttribute('aria-label') !== description) $('guard-number').setAttribute('aria-label', description);
    $('guard-charge').style.width = `${available ? game.quota : 0}%`;
    text('guard-status', !available ? '等待额度更新' : dead ? '这局，僵尸赢了' : win ? '球球赢了，能量守住了' : '球球正在守护能量');
    text('guard-instruction', !available ? '数据回来后，继续守护能量。' : dead ? '半个球球留在原地。重开一局，再守一次能量。' : win ? '守住啦！再开一局，继续陪球球。' : '命中 30 次获胜，连点可加快发射。');
    text('guard-hit-count', `${Math.min(WIN_HITS, game.playerHits)} / ${WIN_HITS}`);
    $('guard-hit-pips').querySelectorAll('i').forEach((pip, index) => pip.style.setProperty('--hit-fill', `${clamp((game.playerHits - index * 5) / 5, 0, 1) * 100}%`));
    $('guard-qiuqiu').disabled = $('guard-monster').disabled = !sprites || !game.active || game.ended;
    $('guard-restart').disabled = !available || game.quota === 0;
    $('guard-pause').disabled = reduced.matches || !available; $('guard-pause').setAttribute('aria-pressed', String(game.paused)); text('guard-pause-label', reduced.matches ? '减少动态' : game.paused ? '继续动画' : '暂停动画');
  }
  function drawEffects() {
    const activeIds = new Set();
    for (const item of [...game.flight, ...game.effects]) {
      activeIds.add(item.id); let node = effectNodes.get(item.id);
      if (!node) { node = doc.createElement('i'); node.className = item.kind || 'energy-shot'; $('guard-effects').append(node); effectNodes.set(item.id, node); }
      const progress = (game.time - item.at) / (item.kind === 'impact' ? 360 : 520);
      node.style.opacity = item.kind ? String(1 - progress) : '1';
      node.style.transform = item.kind === 'impact' ? `translate(${item.x - 6}px,${item.y - 6}px) scale(${.3 + progress * .95})` : item.kind === 'crumb' ? `translate(${item.x + item.vx * progress}px,${item.y + item.vy * progress + 55 * progress * progress}px) rotate(${progress * 160}deg)` : `translate(${item.x - 3.5}px,${item.y - 3.5}px)`;
    }
    for (const [id, node] of effectNodes) if (!activeIds.has(id)) { node.remove(); effectNodes.delete(id); }
  }
  const fallingCrown = svg('svg', { viewBox: '72 -38 86 61', 'aria-hidden': 'true' }); fallingCrown.append(crownImage()); fallingCrown.classList.add('ending-crown'); $('guard-effects').append(fallingCrown);
  function draw(dt = 0) {
    if (!sprites) return; const quiet = !game.active || doc.hidden, phase = game.endingProgress, win = game.outcome === 'qiuqiu', dead = game.outcome === 'zombie';
    const attacking = !game.ended && game.time - game.biteAt >= 0 && game.time - game.biteAt < 800;
    if (!quiet && !game.ended) spriteTime += dt * (attacking ? 1.9 : .7 + game.drive * 1.6);
    drawSprite($('guard-zombie-canvas'), attacking ? 'attack' : 'walk', quiet || game.ended ? 0 : attacking ? (game.time - game.biteAt) * 2.6 : spriteTime);
    const rotate = win ? 12 * ease(phase / .55) : dead ? Math.sin(clamp((phase - .5) / .5, 0, 1) * Math.PI * 2) * 3 * (1 - phase) : -pulse((game.time - game.hitAt) / 1000, 0, .4) * 3;
    $('guard-monster-art').style.transform = `rotate(${rotate}deg)`; $('guard-monster').style.opacity = win ? String(1 - ease((phase - .3) / .45)) : '1';
    $('guard-qiuqiu').style.transform = 'translateX(6px)'; $('guard-monster').style.transform = `translateX(${game.zombieX - 14}px)`;
    renderPet(pet, game.bite, accessory(game.available ? game.quota : null, dead), game.time, quiet, game);
    $('guard-zombie-crown').setAttribute('visibility', game.available && dead && phase >= .45 ? 'visible' : 'hidden');
    const rise = win ? ease((phase - .52) / .36) : 0; $('guard-grave').style.opacity = game.available ? String(rise) : '0'; $('guard-grave').style.transform = `translate(118.5px,${42 - 25 * 112 / 88 + (1 - rise) * 25 * 112 / 88 * .35}px)`;
    const p = ease((phase - .05) / .4); fallingCrown.style.visibility = game.available && dead && p < 1 ? 'visible' : 'hidden'; fallingCrown.style.transform = `translate(${20 + (game.zombieX - 28 * .213 - 20) * p - 28 * .31 / 2}px,${1 - Math.sin(p * Math.PI) * 12}px)`;
    drawEffects(); labels();
  }
  function frame(now) { raf = 0; if (!awake()) return; const dt = last ? clamp(now - last, 0, 64) : 16; last = now; game.step(dt); draw(dt); if (awake()) raf = requestAnimationFrame(frame); }
  function wake() { cancelAnimationFrame(raf); raf = 0; last = 0; draw(); labels(); if (awake()) raf = requestAnimationFrame(frame); }
  function theme() { const resolved = appearance === 'system' ? darkMedia.matches ? 'dark' : 'light' : appearance; doc.documentElement.dataset.appearance = resolved; doc.documentElement.dataset.accessibleAppearance = resolved; }
  cleanup.push(bridge.onModel(value => { model = value; const round = game.round; game.setModel(value); if (game.round !== round) spriteTime = 0; appearance = ['light', 'dark'].includes(value?.appearance) ? value.appearance : 'system'; theme(); wake(); }));
  if (bridge.onColorMode) cleanup.push(bridge.onColorMode((mode, preference, uiTheme) => { doc.documentElement.dataset.colorMode = mode === 'accessible' ? 'accessible' : 'standard'; doc.documentElement.dataset.uiTheme = uiTheme === 'blue' ? 'blue' : 'green'; appearance = ['light', 'dark'].includes(preference) ? preference : 'system'; theme(); }));
  $('guard-qiuqiu').addEventListener('click', () => { game.shoot(); wake(); }); $('guard-monster').addEventListener('click', () => { game.advance(); wake(); });
  $('guard-restart').addEventListener('click', () => { if (game.available && game.quota > 0) { game.reset(); spriteTime = 0; wake(); } });
  $('guard-pause').addEventListener('click', () => { game.paused = !game.paused; wake(); });
  $('guard-close').addEventListener('click', () => bridge.close()); doc.addEventListener('keydown', event => { if (event.key === 'Escape') bridge.close(); });
  function visibility() { game.visible = !doc.hidden && model?.visible !== false; wake(); }
  function motion() { game.reduced = reduced.matches; wake(); }
  function fit() { $('guard-theatre').style.setProperty('--scene-zoom', Math.min(2.35, $('guard-theatre').parentElement.clientWidth / 148)); }
  reduced.addEventListener('change', motion); darkMedia.addEventListener('change', theme); doc.addEventListener('visibilitychange', visibility); root.addEventListener('resize', fit);
  cleanup.push(() => { cancelAnimationFrame(raf); reduced.removeEventListener('change', motion); darkMedia.removeEventListener('change', theme); doc.removeEventListener('visibilitychange', visibility); root.removeEventListener('resize', fit); pet.ball.destroy(); });
  root.quotaGuardView = { get state() { return { ...game.snapshot(), spritesReady: Boolean(sprites), spriteFrames: sprites ? Object.fromEntries(Object.entries(sprites).map(([key, seq]) => [key, seq.frames.length])) : {} }; } };
  fit(); labels(); loadSprites().then(value => { sprites = value; if (!destroyed) wake(); }).catch(() => { $('guard-status').textContent = '角色暂不可用'; });
})(typeof window !== 'undefined' ? window : globalThis);
