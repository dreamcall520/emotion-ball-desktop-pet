/* V5 独立候选试播：侧躺 / 转面 / 醒脑一圈。不监听鼠标、不连接 Codex、不移动原生窗体、不修改正式配置。 */
(function (root) {
  'use strict';

  var active = new WeakMap();
  var DURATION = Object.freeze({ nuzzle: 3200, land: 2400, stretch: 2000, hop: 1800, ribbon: 2200 });
  var KEYS = ['x', 'y', 'scaleX', 'scaleY', 'rotate', 'yaw'];
  var NEUTRAL = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, yaw: 0 };
  var CLOSED_ID = '52';
  var STRETCH_ID = '53';
  var LAND_ID = '54';

  // 时间、身体、双眼同步开合、目光、页面局部偏移；坐标沿用原 viewBox。
  // 三个新动作分别使用平面侧躺、三维转面、球心小圆路径，不复用原全身 FRAMES。
  // nuzzle / stretch 的 previewOffset 只移动本页容器，所有动作的真实 window 始终为零。
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

  // 脸始终朝前；只让球心沿小圆走一圈，首尾缓慢收放半径。
  // 11 个 viewBox 单位在 80px 球体上约为 3.4px，小尺寸也能辨认。
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

  // 与现有 InteractionMotion 相同的轮廓边界；包括旋转后的椭圆外接范围。
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
    if (t >= DURATION[name]) return '回到安静';
    if (name === 'nuzzle') return t < 620 ? '睁眼凑近' : t < 1150 ? '侧躺下来，轻轻闭眼' : t < 1800 ? '闭眼贴住一会儿' : t < 2870 ? '一口气慢慢回正' : '睁眼看向你';
    if (name === 'land') return t < 800 ? '顺着惯性转面，低头看看' : t < 1100 ? '确认落点，稳住身体' : t < 2100 ? '慢慢转正，看向你' : '站稳了，不再晃动';
    if (name === 'stretch') return t < 160 ? '双眼迅速醒来' : t < 1450 ? '脸朝前，醒脑走一圈' : '回到中心，清醒看你';
    if (name === 'hop') return t < 760 ? '现有小跳 · 第一拍' : t < 1330 ? '现有小跳 · 第二拍' : '轻轻停好';
    return t < 1500 ? '现有渐变彩带 · 转一圈' : '彩带自然收尾';
  }

  /** 纯采样，无计时器、无实例写入。未知 name 返回 null；非有限时间按 0 处理。 */
  function sample(name, elapsedMs, side) {
    if (!Object.prototype.hasOwnProperty.call(DURATION, name)) return null;
    var duration = DURATION[name];
    var t = Number.isFinite(elapsedMs) ? clamp(elapsedMs, 0, duration) : 0;
    var done = t >= duration;
    var body = bodyWith(), gaze = { x: 0, y: 0 }, eyesOpen = 1;
    var previewOffset = { x: 0, y: 0 }, hopEmotion = '50';
    if (!done && FRAMES[name]) {
      var frames = FRAMES[name];
      for (var i = 1; i < frames.length; i += 1) {
        if (t <= frames[i][0]) {
          var a = frames[i - 1], b = frames[i];
          var eased = smooth((t - a[0]) / (b[0] - a[0]));
          var from = bodyWith(a[1]), to = bodyWith(b[1]);
          KEYS.forEach(function (key) { body[key] = lerp(from[key], to[key], eased); });
          eyesOpen = lerp(a[2], b[2], eased);
          ['x', 'y'].forEach(function (axis) {
            gaze[axis] = lerp((a[3] && a[3][axis]) || 0, (b[3] && b[3][axis]) || 0, eased);
            previewOffset[axis] = lerp((a[4] && a[4][axis]) || 0, (b[4] && b[4][axis]) || 0, eased);
          });
          break;
        }
      }
      if (name === 'nuzzle' || name === 'land') {
        var direction = side === 'left' ? -1 : 1;
        body.x *= direction;
        body.rotate *= direction;
        body.yaw *= direction;
        gaze.x *= direction;
        previewOffset.x *= direction;
      }
      if (name === 'stretch') previewOffset = wakeOffsetAt(t);
      safeBody(body);
    } else if (!done && name === 'hop') {
      if (!root.InteractionMotion || typeof root.InteractionMotion.sampleMotion !== 'function') {
        throw new Error('现有小跳需要先载入 interaction-motion.js');
      }
      var original = root.InteractionMotion.sampleMotion('hop', t);
      body = Object.assign({}, original.body);
      gaze = Object.assign({}, original.gaze);
      previewOffset = Object.assign({}, original.window);
      hopEmotion = root.InteractionMotion.getMotion('hop').emotion;
      // 只把原窗口轨迹交给页面做局部平移；不调用任何原生窗口接口。
    }
    return {
      body: body,
      gaze: gaze,
      window: { x: 0, y: 0 },
      previewOffset: previewOffset,
      emotionId: done ? '50' : name === 'nuzzle' ? CLOSED_ID : name === 'stretch' ? STRETCH_ID : name === 'land' ? LAND_ID : hopEmotion,
      eyesOpen: eyesOpen,
      phase: phaseAt(name, t),
      done: done,
      durationMs: duration,
      nativeSpin: name === 'ribbon' && !done
    };
  }

  function registerLocalEmotion(name, id, title) {
    var config = root.EmotionBall && root.EmotionBall.config;
    if (!config || !config.get('50')) throw new Error('请先注册预览安静表情 50');
    var existing = config.get(id);
    if (existing) {
      if (existing.name !== title) throw new Error('预览表情 ' + id + ' 已被其他配置占用');
      return;
    }
    var quiet = config.get('50').raw;
    // 直接选原生开心笑眼 / 好奇眼环；不画新眼形，也不沿用满意19的循环点头。
    var originalEyes = config.get(name === 'land' ? '03' : name === 'stretch' ? '02' : '10').raw;
    var result = config.register({
      id: id,
      name: title,
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
        frames: FRAMES[name].map(function (frame) {
          return { at: frame[0], eyes: { both: { open: frame[2] } } };
        }),
        settle: 'hold'
      }
    });
    if (!result.ok) throw new Error('预览表情注册失败：' + result.errors.join('；'));
  }

  function notify(callback, value) {
    if (typeof callback !== 'function') return;
    try { callback(value); } catch (error) { root.console.error('[球球互动试播]', error); }
  }

  function resetBall(ball) {
    ball.stopMotion();
    ball.setGaze(0, 0);
    ball.setEmotion('50', { auto: true });
  }

  /** 停止仅针对指定实例。取消不触发 onDone；原生彩带由渲染器约 0.5 秒自然回缩。 */
  function stop(ball) {
    var current = ball && active.get(ball);
    if (current) {
      current.cancel();
      return true;
    }
    if (ball && typeof ball.stopMotion === 'function' && typeof ball.setEmotion === 'function' && typeof ball.setGaze === 'function') {
      resetBall(ball);
    }
    return false;
  }

  /**
   * play(name, ball, { side, onPhase, onOffset, onDone, reducedMotion })
   * 返回 { name, durationMs, cancel(), finished }。
   * finished 始终 resolve({ name, cancelled })；正常结束才调用 onDone。
   * 一个球最多播放一个候选动作，新动作自动取消旧动作；球之间互不影响。
   * onOffset({x,y}) 输出预览局部位移，单位与原 viewBox 相同；页面乘显示宽度 / 259。
   * 结束、取消及 reducedMotion 均输出零位移；window 字段始终为零，不移动原生窗体。
   * nuzzle 的单侧接近与 stretch 的小圆路径均经 onOffset 输出；land 的页面偏移始终为零。
   * land 的 yaw 平滑峰值小于 2 rad/s，低于原生甩彩带所需的 5 rad/s；不调用 spin / burst。
   * land 与原生渲染器同步使用 50ms 单帧上限；卡顿时略延长动作，不跳帧伪装高速自旋。
   * 新动作复用原眼环，眼睛开合由本页独立表情序列驱动。
   * hop 复用原 10 开心表情；实例应与正式桌宠一样显式锁定 color / eyeColor。
   * reducedMotion 保持安静，用相同时长显示状态，不做身体变形或原生自旋。
   * ribbon 的 sample 仅提供安全中性帧；播放时仅使用 ball.spin(1)，不覆盖原生自旋。
   */
  function play(name, ball, options) {
    if (!Object.prototype.hasOwnProperty.call(DURATION, name)) throw new Error('未知互动候选：' + name);
    if (!ball || ['setEmotion', 'setMotionFrame', 'stopMotion', 'setGaze'].some(function (key) {
      return typeof ball[key] !== 'function';
    })) throw new Error('请传入实际 EmotionBall 实例');
    options = options || {};
    if (name === 'hop') sample(name, 0, options.side);
    if (name === 'ribbon' && typeof ball.spin !== 'function') throw new Error('当前球体不支持原生彩带');
    if (name === 'nuzzle') registerLocalEmotion(name, CLOSED_ID, '试播 V5 · 侧躺贴贴');
    if (name === 'land') registerLocalEmotion(name, LAND_ID, '试播 V5 · 转面站稳');
    if (name === 'stretch') registerLocalEmotion(name, STRETCH_ID, '试播 V5 · 醒脑一圈');
    stop(ball);

    var raf = 0, settled = false, previousPhase = '';
    var startedAt = root.performance.now();
    var lastFrameAt = startedAt, landElapsed = 0;
    var resolveFinished;
    var finished = new Promise(function (resolve) { resolveFinished = resolve; });
    var controller = {
      name: name,
      durationMs: DURATION[name],
      cancel: function () { finish(true); },
      finished: finished
    };
    active.set(ball, controller);

    function finish(cancelled) {
      if (settled) return;
      settled = true;
      if (raf) root.cancelAnimationFrame(raf);
      raf = 0;
      if (active.get(ball) === controller) {
        active.delete(ball);
        resetBall(ball);
      }
      notify(options.onOffset, { x: 0, y: 0 });
      resolveFinished({ name: name, cancelled: cancelled });
      if (!cancelled) {
        notify(options.onPhase, '回到安静');
        notify(options.onDone);
      }
    }

    function tick(now) {
      raf = 0;
      if (settled || active.get(ball) !== controller) return;
      var elapsed = now - startedAt;
      if (name === 'land' && !options.reducedMotion) {
        landElapsed += clamp(now - lastFrameAt, 0, 50);
        elapsed = landElapsed;
      }
      lastFrameAt = now;
      var frame = sample(name, elapsed, options.side);
      if (frame.done) { finish(false); return; }
      if (!options.reducedMotion && name !== 'ribbon') ball.setMotionFrame(frame);
      notify(options.onOffset, options.reducedMotion ? { x: 0, y: 0 } : frame.previewOffset);
      if (settled || active.get(ball) !== controller) return;
      var phase = options.reducedMotion ? '减少动态：保持安静，仅模拟时长' : frame.phase;
      if (phase !== previousPhase) {
        previousPhase = phase;
        notify(options.onPhase, phase);
      }
      if (!settled && active.get(ball) === controller) raf = root.requestAnimationFrame(tick);
    }

    if (!options.reducedMotion) {
      var first = sample(name, 0, options.side);
      ball.setEmotion(first.emotionId, { auto: true });
      if (name === 'ribbon') ball.spin(1);
    }
    tick(startedAt);
    return controller;
  }

  root.QiuqiuInteractionPreview = Object.freeze({ play: play, stop: stop, sample: sample, durations: DURATION });
}(window));
