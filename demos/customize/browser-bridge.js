(function () {
  'use strict';

  // Replace only Electron IPC. The public customizer renderer owns the UI.
  const customization = window.PetCustomization;
  const clone = value => JSON.parse(JSON.stringify(value));
  const supportedShapes = new Set(['blob', 'cloud', 'aurora-cloud', 'square', 'codex-pet']);
  // A static public example catalogue, never the visitor's Codex directory.
  const catalogue = [
    { id: 'codex-1efa22ef14f812a00e6bbeaea6ab410bf441085df26fa194bbbaea1c0c18789d',
      name: 'ikun', version: 2, rows: 11, file: 'assets/demo-ikun.webp' },
    { id: 'codex-1d0c978a2b7a9598bf8e1b06259ebf75b1ffd4225dedba52f1c893bb95eba007',
      name: '春野', version: 2, rows: 11, file: 'assets/demo-chunye.webp' }
  ].map(({ file, ...pet }) => Object.freeze({ ...pet,
    importedId: pet.id, imageURL: new URL(file, window.location.href).href }));
  const descriptor = value => value?.shape === 'codex-pet'
    ? catalogue.find(pet => pet.id === value.codexPetId) || null : null;
  const validAppearance = value => value && typeof value === 'object' && !Array.isArray(value) &&
    supportedShapes.has(value.shape) && (value.shape !== 'codex-pet' || Boolean(descriptor(value)));
  const normalize = value => customization.normalizeAppearance({
    ...value, shape: supportedShapes.has(value?.shape) ? value.shape : 'blob'
  });
  let current = customization.normalizeCustomization();
  let startupAppearance = normalize(current.appearance);
  let previewAppearance = clone(current.appearance);
  let presets = [
    { id: '621ca748-f07e-467d-a57a-2451888f7d36', name: '薄荷奶糖',
      appearance: normalize({ shape: 'square', bodyColor: '#DCE8DD', eyeColor: '#1A1A1A' }) },
    { id: 'eb59ddf8-1f59-44bb-a031-a32e99591b76', name: '暮色云朵',
      appearance: normalize({ shape: 'cloud', bodyColor: '#5B3BC7', eyeColor: '#FFFFFF' }) }
  ];
  let appearance = 'light';
  let colorMode = 'standard';
  let uiTheme = 'blue';
  let size = 'tiny';
  const sizeListeners = new Set();
  const sizes = new Set(['micro', 'tiny', 'compact', 'small', 'medium', 'large']);
  const themeListeners = new Set();
  const result = () => ({ ok: true, presets: clone(presets.map(item => ({
    ...item, codexPet: descriptor(item.appearance)
  }))) });
  const fail = error => ({ ok: false, error });
  const validName = name => typeof name === 'string' &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(name) && name.trim().length > 0 && name.trim().length <= 24;
  const existingName = (name, except) => presets.some(item => item.id !== except &&
    item.name.toLowerCase() === name.toLowerCase());

  // Use the public engines' lifecycle without changing the App renderer or
  // the operating system's reduced-motion preference. Only the main preview
  // is enrolled; the App already keeps saved-appearance thumbnails inactive.
  let motionPaused = false;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const previewEngines = new Set();
  function applyMotion() {
    const active = !motionPaused && !reducedMotion?.matches;
    const root = window.document?.documentElement;
    if (root) root.dataset.demoMotionPaused = String(motionPaused);
    for (const record of previewEngines) record.setActive(record.wantsMotion && active);
  }
  function enrollPreview(controller, wantsMotion) {
    if (!controller?.setActive || !controller.destroy) return controller;
    const record = { wantsMotion, setActive: controller.setActive.bind(controller) };
    const destroy = controller.destroy.bind(controller);
    previewEngines.add(record);
    controller.setActive = value => {
      record.wantsMotion = value === true;
      record.setActive(record.wantsMotion && !motionPaused && !reducedMotion?.matches);
    };
    controller.destroy = () => {
      previewEngines.delete(record);
      destroy();
    };
    applyMotion();
    return controller;
  }
  if (window.EmotionBall?.create) {
    const createBall = window.EmotionBall.create;
    window.EmotionBall.create = function (target, options) {
      const controller = createBall.call(this, target, options);
      return target?.id === 'preview-ball'
        ? enrollPreview(controller, options?.autostart !== false) : controller;
    };
  }
  if (window.AuroraRive?.create) {
    const engine = window.AuroraRive;
    window.AuroraRive = Object.freeze({ ...engine,
      create(target, ...args) {
        const controller = engine.create(target, ...args);
        return target?.id === 'preview-ball' ? enrollPreview(controller, true) : controller;
      }
    });
  }
  if (window.CodexPetPlayer?.create) {
    const engine = window.CodexPetPlayer;
    window.CodexPetPlayer = Object.freeze({ ...engine,
      create(target, ...args) {
        const controller = engine.create(target, ...args);
        if (target?.id !== 'preview-ball') return controller;
        // Combine the native action pause button with parent/offscreen/reduced-motion pause.
        const pause = controller.pause.bind(controller);
        controller.setActive = active => pause(!active);
        const wrapped = enrollPreview(controller, true);
        wrapped.pause = value => wrapped.setActive(value !== true);
        return wrapped;
      }
    });
  }
  reducedMotion?.addEventListener('change', applyMotion);
  window.addEventListener('pagehide', () => {
    reducedMotion?.removeEventListener('change', applyMotion);
    previewEngines.clear();
  }, { once: true });
  applyMotion();

  window.petCustomizer = Object.freeze({
    onColorMode(callback) {
      if (typeof callback !== 'function') return () => {};
      themeListeners.add(callback);
      queueMicrotask(() => { if (themeListeners.has(callback)) callback(colorMode, appearance, uiTheme); });
      return () => themeListeners.delete(callback);
    },
    async load() {
      return clone({ customization: current, startupAppearance, appearancePresets: result().presets,
        codexPet: descriptor(current.appearance), size });
    },
    async listCodexPets() {
      return { ok: true, skipped: 0, pets: clone(catalogue) };
    },
    async setSize(value) {
      if (!sizes.has(value)) return false;
      size = value;
      for (const callback of sizeListeners) callback(size);
      return true;
    },
    onSize(callback) {
      if (typeof callback !== 'function') return () => {};
      sizeListeners.add(callback);
      return () => sizeListeners.delete(callback);
    },
    async addPreset(name, raw) {
      if (!validName(name)) return fail('请输入 1–24 个字符的名称，勿包含控制字符');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('形象未读取完成，请重试');
      if (!validAppearance(raw)) return fail('示例宠物暂不可用，请刷新重试');
      const next = normalize(raw);
      const key = customization.appearanceContentKey(next);
      const duplicate = presets.find(item => customization.appearanceContentKey(item.appearance) === key);
      if (duplicate) return fail('已收藏为「' + duplicate.name + '」，无需重复保存');
      name = name.trim();
      if (existingName(name)) return fail('已有同名形象，请换一个名称');
      if (presets.length >= 20) return fail('最多保存 20 套形象，可先删除不再需要的形象');
      presets.push({ id: crypto.randomUUID(), name, appearance: next });
      return result();
    },
    async renamePreset(id, name) {
      const item = presets.find(preset => preset.id === id);
      if (!item) return fail('形象已不存在，请重新打开定制页');
      if (!validName(name)) return fail('请输入 1–24 个字符的名称，勿包含控制字符');
      name = name.trim();
      if (existingName(name, id)) return fail('已有同名形象，请换一个名称');
      item.name = name;
      return result();
    },
    async deletePreset(id) {
      if (!presets.some(item => item.id === id)) return fail('形象已不存在，请重新打开定制页');
      presets = presets.filter(item => item.id !== id);
      return result();
    },
    async save(value, setAsStartupDefault) {
      if (!validAppearance(value?.appearance) || typeof setAsStartupDefault !== 'boolean') return false;
      current = customization.normalizeCustomization(value);
      current.appearance = normalize(current.appearance);
      if (setAsStartupDefault) startupAppearance = clone(current.appearance);
      if (window.parent !== window) window.parent.postMessage({
        type: 'qiuqiu-demo-avatar', appearance: clone(current.appearance),
        codexPet: descriptor(current.appearance) ? clone(descriptor(current.appearance)) : null
      }, window.location.origin);
      return true;
    },
    preview(value) {
      if (validAppearance(value)) previewAppearance = normalize(value);
    }
  });

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const data = event.data;
    if (data?.type === 'qiuqiu-demo-motion') {
      if (typeof data.paused !== 'boolean') return;
      motionPaused = data.paused;
      applyMotion();
      return;
    }
    if (!data || data.type !== 'qiuqiu-demo-theme' ||
      !['light', 'dark'].includes(data.appearance) ||
      !['standard', 'accessible'].includes(data.colorMode)) return;
    appearance = data.appearance;
    colorMode = data.colorMode;
    if (['green', 'blue'].includes(data.uiTheme)) uiTheme = data.uiTheme;
    for (const callback of themeListeners) callback(colorMode, appearance, uiTheme);
  });
  window.document?.addEventListener('DOMContentLoaded', () => {
    if (window.parent !== window) window.parent.postMessage({ type: 'qiuqiu-demo-ready' }, window.location.origin);
  });
})();
