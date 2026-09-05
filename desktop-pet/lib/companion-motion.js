(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CompanionMotion = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var NEUTRAL = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, yaw: 0 };
  var MOTIONS = Object.freeze([
    Object.freeze({ id: 'nuzzle', durationMs: 3200, emotion: '52', name: '侧躺贴贴', directional: true }),
    // 与原生渲染器相同的单帧上限，避免卡顿后的 yaw 突跳误触发彩带。
    Object.freeze({ id: 'land', durationMs: 2400, emotion: '54', name: '转面站稳', directional: true, maxFrameMs: 50 }),
    Object.freeze({ id: 'stretch', durationMs: 2000, emotion: '53', name: '醒脑一圈', directional: false })
  ]);
  var durations = Object.freeze({ nuzzle: 3200, land: 2400, stretch: 2000 });

  // V5 已确认节奏：时间、身体、双眼开合、目光、宿主窗口偏移。
  // 侧躺、三维转面、小圆路径各自独立；不复用旧全身互动动作。
  var FRAMES = {
    nuzzle: [
      [0, {}, 1],
      [260, { scaleX: 0.98, scaleY: 0.99, rotate: 8 }, 1, { x: 7, y: -1 }, { x: 4, y: 0 }],
      [620, { scaleX: 0.97, scaleY: 0.96, rotate: 28 }, 0.7, { x: 8, y: 1 }, { x: 10, y: 3 }],
      [1150, { y: 4, scaleX: 0.99, scaleY: 0.9, rotate: 65 }, 0.07, {}, { x: 18, y: 6 }],
      [1800, { y: 4, scaleX: 0.99, scaleY: 0.9, rotate: 65 }, 0.07, {}, { x: 18, y: 6 }],
      [2350, { y: 2, scaleX: 0.99, scaleY: 0.96, rotate: 28 }, 0.07, {}, { x: 10, y: 3 }],
      [2870, { rotate: 5 }, 0.42, { x: 2, y: 0 }, { x: 2, y: 0 }],
      [3200, {}, 1]
    ],
    land: [
      [0, {}, 1],
      [300, { yaw: 0.35 }, 1, { x: 0, y: 8 }],
      [800, { yaw: 1 }, 0.95, { x: 0, y: 10 }],
      [1100, { yaw: 1 }, 1, { x: 0, y: 8 }],
      [2100, {}, 1],
      [2400, {}, 1]
    ],
    stretch: [
      [0, {}, 0.08],
      [160, {}, 1.2],
      [1450, {}, 1.2],
      [2000, {}, 1]
    ]
  };

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function smooth(value) { return value * value * (3 - 2 * value); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function bodyWith(values) { return Object.assign({}, NEUTRAL, values || {}); }

  function getMotion(name) {
    for (var i = 0; i < MOTIONS.length; i += 1) {
      if (MOTIONS[i].id === name) return MOTIONS[i];
    }
    return null;
  }

  // 脸朝前，球心走一圈；半径在首尾平滑收放，不旋转身体或甩彩带。
  function wakeOffsetAt(t) {
    if (t < 160 || t > 1450) return { x: 0, y: 0 };
    var radius, angle;
    if (t < 280) {
      radius = 11 * smooth((t - 160) / 120);
      angle = -Math.PI / 2;
    } else if (t <= 1330) {
      radius = 11;
      angle = -Math.PI / 2 + Math.PI * 2 * ((t - 280) / 1050);
    } else {
      radius = 11 * (1 - smooth((t - 1330) / 120));
      angle = Math.PI * 1.5;
    }
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  }

  function safeBody(body) {
    var angle = body.rotate * Math.PI / 180;
    var c = Math.cos(angle), s = Math.sin(angle);
    var rx = 114.3 * Math.hypot(body.scaleX * c, body.scaleY * s);
    var ry = 114.3 * Math.hypot(body.scaleX * s, body.scaleY * c);
    body.x = clamp(body.x, -7 + rx - 114.2705, 236 - rx - 114.2705);
    body.y = clamp(body.y, -7 + ry - 114.2705, 236 - ry - 114.2705);
    return body;
  }

  function phaseAt(name, t) {
    if (t >= durations[name]) return '回到安静';
    if (name === 'nuzzle') return t < 620 ? '睁眼凑近' : t < 1150 ? '侧躺下来，轻轻闭眼' : t < 1800 ? '闭眼贴住一会儿' : t < 2870 ? '一口气慢慢回正' : '睁眼看向你';
    if (name === 'land') return t < 800 ? '顺着惯性转面，低头看看' : t < 1100 ? '确认落点，稳住身体' : t < 2100 ? '慢慢转正，看向你' : '站稳了，不再晃动';
    return t < 160 ? '双眼迅速醒来' : t < 1450 ? '脸朝前，醒脑走一圈' : '回到中心，清醒看你';
  }

  /** 纯采样；side 是屏幕坐标方向。window 以 259 viewBox 为单位，由宿主统一缩放和限位。 */
  function sample(name, elapsedMs, side) {
    var motion = getMotion(name);
    if (!motion) return null;
    var t = Number.isFinite(elapsedMs) ? clamp(elapsedMs, 0, motion.durationMs) : 0;
    var done = t >= motion.durationMs;
    var body = bodyWith(), gaze = { x: 0, y: 0 }, offset = { x: 0, y: 0 }, eyesOpen = 1;
    if (!done) {
      var frames = FRAMES[name];
      for (var i = 1; i < frames.length; i += 1) {
        if (t <= frames[i][0]) {
          var a = frames[i - 1], b = frames[i];
          var eased = smooth((t - a[0]) / (b[0] - a[0]));
          var from = bodyWith(a[1]), to = bodyWith(b[1]);
          Object.keys(NEUTRAL).forEach(function (key) { body[key] = lerp(from[key], to[key], eased); });
          eyesOpen = lerp(a[2], b[2], eased);
          ['x', 'y'].forEach(function (axis) {
            gaze[axis] = lerp((a[3] && a[3][axis]) || 0, (b[3] && b[3][axis]) || 0, eased);
            offset[axis] = lerp((a[4] && a[4][axis]) || 0, (b[4] && b[4][axis]) || 0, eased);
          });
          break;
        }
      }
      if (motion.directional && side === 'left') {
        ['x', 'rotate', 'yaw'].forEach(function (key) { if (body[key]) body[key] *= -1; });
        if (gaze.x) gaze.x *= -1;
        if (offset.x) offset.x *= -1;
      }
      if (name === 'stretch') offset = wakeOffsetAt(t);
      safeBody(body);
    }
    return {
      body: body,
      gaze: gaze,
      window: offset,
      emotionId: done ? '50' : motion.emotion,
      eyesOpen: eyesOpen,
      phase: phaseAt(name, t),
      done: done,
      durationMs: motion.durationMs
    };
  }

  /** 完成或取消由宿主统一清理；本模块不持有实例、定时器或窗口状态。 */
  function neutralFrame() {
    return { body: bodyWith(), gaze: { x: 0, y: 0 }, window: { x: 0, y: 0 },
      emotionId: '50', eyesOpen: 1, phase: '回到安静', done: true, durationMs: 0 };
  }

  function registerEmotions(config) {
    if (!config || typeof config.get !== 'function' || typeof config.register !== 'function' || !config.get('50')) {
      throw new Error('请先注册安静陪伴表情 50');
    }
    var sourceIds = { nuzzle: '10', land: '03', stretch: '02' };
    // 先查完所有占用及原眼环，避免冲突导致仅注册一部分。
    MOTIONS.forEach(function (motion) {
      var existing = config.get(motion.emotion);
      if (existing && existing.name !== motion.name) throw new Error('陪伴表情 ' + motion.emotion + ' 已被其他配置占用');
      if (!config.get(sourceIds[motion.id])) throw new Error('缺少原生眼环表情 ' + sourceIds[motion.id]);
    });
    var quiet = config.get('50').raw;
    MOTIONS.forEach(function (motion) {
      if (config.get(motion.emotion)) return;
      var originalEyes = config.get(sourceIds[motion.id]).raw;
      var result = config.register({
        id: motion.emotion,
        name: motion.name,
        group: 'custom',
        gaze: false,
        antics: false,
        blinkMs: null,
        pool: (originalEyes.pool || quiet.pool || [0]).slice(0, 1),
        poolMs: [60000, 60000],
        openness: 1,
        transition: 0,
        anims: [],
        body: Object.assign({}, quiet.body || {}, { breathe: 0, ribbons: 0, confetti: 0, zzz: 0, orbit: 0 }),
        eyes: quiet.eyes ? JSON.parse(JSON.stringify(quiet.eyes)) : {},
        sequence: {
          frames: FRAMES[motion.id].map(function (frame) { return { at: frame[0], eyes: { both: { open: frame[2] } } }; }),
          settle: 'hold'
        }
      });
      if (!result.ok) throw new Error('陪伴表情注册失败：' + result.errors.join('；'));
    });
    return MOTIONS.map(function (motion) { return motion.emotion; });
  }

  return Object.freeze({ MOTIONS: MOTIONS, durations: durations, getMotion: getMotion,
    sample: sample, sampleMotion: sample, neutralFrame: neutralFrame, registerEmotions: registerEmotions });
}));
