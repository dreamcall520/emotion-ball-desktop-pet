/* Website orchestration only. V5 animation modules are preserved in assets/motion.
 * No native APIs, Codex connection, task content or visitor account data is used. */
(function () {
  'use strict';
  const roots = [...document.querySelectorAll('[data-motion-scene]')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const engine = window.EmotionBall;
  const motion = window.QiuqiuInteractionPreview;
  const dialogue = window.QiuqiuDialoguePreview;
  const scenes = new Map();
  const LABELS = {
    hello: '打个招呼', quiet: '安静陪伴', nuzzle: '摸头 · 侧躺贴贴',
    land: '放下 · 转面站稳', stretch: '醒来 · 醒脑一圈',
    hop: '开心连跳', ribbon: '原生渐变彩带', thought: '思考中 · 思绪游光',
    complete: '已完成 · 小小庆祝', quota: '额度提醒', sleep: '安静休息'
  };
  const DESKTOP_COPY = {
    hello: ['你忙，我陪着。', '不抢走注意力，也一直在你身边。'],
    nuzzle: ['轻轻一碰，就有回应。', '侧躺贴住一会儿，再慢慢回正。'],
    sleep: ['一起，把节奏放慢。', '困了就安静休息，等你回来再睁开眼。'],
    stretch: ['醒醒脑袋，继续陪你。', '一个小小的圆，又回到熟悉的位置。']
  };
  const SEQUENCES = {
    hero: ['hello', 'nuzzle', 'quiet', 'stretch', 'quiet'],
    feature: ['land', 'stretch', 'hop', 'ribbon', 'nuzzle'],
    codex: ['thought', 'quiet', 'complete', 'quiet'],
    desktop: ['hello', 'nuzzle', 'sleep', 'stretch']
  };

  if (!engine || !motion || !window.ThoughtFlowPreview) {
    roots.forEach(root => { root.dataset.motionError = 'unavailable'; });
    return;
  }
  for (const definition of engine.config.list()) {
    if (definition.antics) engine.config.register({ ...definition.raw, antics: false });
  }
  engine.config.register({ ...engine.config.get('02').raw, id: '50', name: '安静陪伴', group: 'custom', antics: false, anims: [] });
  const thinking = engine.config.get('30').raw;
  engine.config.register({ ...thinking, id: '51', name: 'Codex 思考', group: 'custom', antics: false, body: { ...thinking.body, orbit: 0 } });

  class Scene {
    constructor(root) {
      this.root = root;
      this.name = root.dataset.motionScene;
      this.host = root.querySelector('[data-ball-host]');
      this.offset = root.querySelector('.pet-offset');
      this.button = root.querySelector('[data-motion-toggle]');
      this.touch = root.querySelector('[data-pet-touch]');
      this.sequence = SEQUENCES[this.name];
      this.index = 0;
      this.current = this.sequence[0];
      this.visible = false;
      this.paused = false;
      this.timers = new Set();
      this.controller = null;
      this.count = 0;
      this.token = 0;
      this.alive = true;
      this.ball = engine.create(this.host, {
        emotion: '50', shape: 'blob', color: '#EEEBE4', eyeColor: '#1A1A1A',
        idle: false, lite: false, autostart: false,
        eyeScale: this.host.getBoundingClientRect().width <= 120 ? 1.5 : 1,
        fallbackId: '50', label: '球球桌宠'
      });
      this.flow = ThoughtFlowPreview.create(root.querySelector('.thought-flow'));
      this.ball.renderStatic();
      this.render(this.current, false);
      this.updateButton();
      this.button.addEventListener('click', () => {
        this.paused = !this.paused;
        this.reconcile();
      });
      root.querySelectorAll('[data-motion-action]').forEach(button => {
        button.addEventListener('click', () => {
          const action = button.dataset.motionAction;
          this.index = Math.max(0, this.sequence.indexOf(action));
          this.play(action, true);
        });
      });
      this.touch.addEventListener('click', () => this.play(this.name === 'codex' ? 'complete' : 'nuzzle', true));
      this.touch.addEventListener('dblclick', () => this.play('hop', true));
      this.touch.addEventListener('pointermove', event => {
        if (this.controller || this.current === 'thought' || this.current === 'sleep' || reduced.matches || this.paused) return;
        const rect = this.touch.getBoundingClientRect();
        this.ball.setGaze((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1);
      });
      this.touch.addEventListener('pointerleave', () => {
        if (!this.controller && this.current !== 'thought') this.ball.clearGaze();
      });
    }
    canAnimate() { return this.alive && this.visible && !document.hidden && !reduced.matches; }
    canAuto() { return this.canAnimate() && !this.paused; }
    renderStill() { this.ball.setEmotion(this.current === 'sleep' ? '00' : '50'); this.ball.renderStatic(); }
    after(callback, delay) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (this.alive) callback();
      }, delay);
      this.timers.add(timer);
    }
    stop() {
      this.token += 1;
      this.timers.forEach(clearTimeout);
      this.timers.clear();
      if (this.controller) this.controller.cancel();
      this.controller = null;
      this.flow.stop();
      motion.stop(this.ball);
      this.offset.style.translate = '0px 0px';
      this.ball.setActive(false);
      this.renderStill();
      this.root.dataset.playing = 'false';
    }
    updateButton() {
      const stopped = this.paused || reduced.matches;
      const toggleLabel = reduced.matches ? '已减少动态' : this.paused ? '继续动效' : '暂停动效';
      if (this.name !== 'hero') this.button.textContent = toggleLabel;
      this.button.setAttribute('aria-label', toggleLabel);
      this.button.title = toggleLabel;
      this.button.setAttribute('aria-pressed', String(stopped));
      this.button.disabled = reduced.matches;
      this.root.dataset.autoplay = String(this.canAuto());
      if (this.name === 'codex' && this.lastQuotaPause !== stopped) {
        this.lastQuotaPause = stopped;
        document.dispatchEvent(new CustomEvent('website-motion-pause', { detail: { paused: stopped } }));
      }
    }
    render(action, freshCopy = true) {
      this.current = action;
      this.root.dataset.motionAction = action;
      const label = this.root.querySelector('[data-motion-label]');
      if (label) label.textContent = LABELS[action];
      this.root.querySelectorAll('[data-motion-action]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.motionAction === action));
      });
      if (freshCopy) {
        const category = action === 'ribbon' ? 'spin' : action === 'quiet' ? 'work' : action;
        const copy = action === 'quota' ? '额度有点紧啦，记得留意。' : dialogue.pick(category)?.text;
        if (copy) this.root.querySelector('[data-motion-bubble]').textContent = copy;
      }
      if (this.name === 'desktop') {
        const copy = DESKTOP_COPY[action] || DESKTOP_COPY.nuzzle;
        this.root.querySelector('[data-scene-title]').textContent = copy[0];
        this.root.querySelector('[data-scene-description]').textContent = copy[1];
      }
    }
    play(action, manual = false) {
      this.stop();
      this.render(action);
      this.count += 1;
      this.root.dataset.playCount = String(this.count);
      const token = this.token;
      if (!this.canAnimate() || (!manual && this.paused)) { this.renderStill(); this.updateButton(); return; }
      this.ball.setActive(true);
      this.root.dataset.playing = 'true';
      let actual = action;
      if (action === 'complete') actual = Math.random() < .5 ? 'hop' : 'ribbon';
      const side = this.name === 'desktop' || this.name === 'codex' ? 'left' : 'right';
      if (Object.hasOwn(motion.durations, actual)) {
        const width = this.host.getBoundingClientRect().width;
        this.controller = motion.play(actual, this.ball, {
          side,
          onOffset: ({ x, y }) => { this.offset.style.translate = `${x * width / 259}px ${y * width / 259}px`; },
          onDone: () => {
            if (token !== this.token) return;
            this.controller = null;
            this.root.dataset.playing = 'false';
          }
        });
      } else if (action === 'thought') {
        this.ball.setEmotion('51');
        this.ball.setGaze(side === 'left' ? -1 : 1, -1);
        this.flow.play({ side });
        this.after(() => {
          this.ball.setEmotion('50'); this.ball.clearGaze();
          this.root.dataset.playing = 'false';
        }, 6000);
      } else if (action === 'sleep') {
        this.ball.setEmotion('00');
      } else {
        this.ball.setEmotion(action === 'hello' ? '03' : '50');
        this.ball.setGaze(action === 'hello' ? -.45 : 0, action === 'hello' ? -.2 : 0);
        this.after(() => { this.ball.setEmotion('50'); this.ball.clearGaze(); this.root.dataset.playing = 'false'; }, 2000);
      }
      const delay = manual ? 10000 : this.name === 'hero' ? 10500 : action === 'thought' ? 8200 : 7000;
      if (this.canAuto()) {
        this.after(() => {
          if (!this.canAuto()) return;
          this.index = (this.index + 1) % this.sequence.length;
          this.play(this.sequence[this.index]);
        }, delay);
      } else {
        // A deliberate click can play once while autoplay is paused.
        this.after(() => {
          if (!this.canAuto()) { this.ball.setActive(false); this.root.dataset.playing = 'false'; }
        }, action === 'thought' ? 6300 : 4500);
      }
      this.updateButton();
    }
    reconcile() {
      this.stop();
      this.updateButton();
      if (this.canAuto()) this.play(this.sequence[this.index]);
    }
    destroy() { this.stop(); this.alive = false; this.flow.destroy(); this.ball.destroy(); }
  }
  roots.forEach(root => {
    try { scenes.set(root.dataset.motionScene, new Scene(root)); }
    catch (error) { root.dataset.motionError = 'initialization'; console.error('球球展示初始化失败', error); }
  });
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const scene = scenes.get(entry.target.dataset.motionScene);
      if (!scene || scene.visible === entry.isIntersecting) return;
      scene.visible = entry.isIntersecting;
      scene.reconcile();
    });
  }, { threshold: .12 });
  roots.forEach(root => observer.observe(root));
  document.addEventListener('visibilitychange', () => scenes.forEach(scene => scene.reconcile()));
  reduced.addEventListener('change', () => scenes.forEach(scene => scene.reconcile()));
  document.addEventListener('quota-demo-action', event => {
    const scene = scenes.get('codex');
    const action = event.detail?.action;
    if (scene && ['thought', 'complete', 'quota'].includes(action)) scene.play(action, true);
  });
  window.addEventListener('pagehide', event => {
    if (event.persisted) { scenes.forEach(scene => scene.stop()); return; }
    observer.disconnect(); scenes.forEach(scene => scene.destroy());
  });
  window.addEventListener('pageshow', event => { if (event.persisted) scenes.forEach(scene => scene.reconcile()); });
  // Read-only diagnostic state, no mutation or account integration API.
  window.QiuqiuWebsiteMotion = Object.freeze({ getState: () => [...scenes.values()].map(scene => ({
    name: scene.name, action: scene.current, count: scene.count, visible: scene.visible,
    paused: scene.paused, autoplay: scene.canAuto(), timers: scene.timers.size,
    playing: scene.root.dataset.playing === 'true', thought: scene.flow.getState()
  })) });
})();
