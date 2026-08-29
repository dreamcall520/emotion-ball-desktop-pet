const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const {
  LEVELS,
  createQuotaAlertTracker,
  mergeQuotaAlerts
} = require('../lib/codex-quota-alerts');

const NOW = 1800000000000;
const quotaWindow = (id, windowMinutes, remaining, resetsAt = NOW + 3600000,
  label = `额度${id}`) => ({
  id: String(id), label, windowMinutes, remaining, resetsAt
});

test('导出冻结的 10% 到 100% 提醒档位', () => {
  assert.deepEqual(LEVELS, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(Object.isFrozen(LEVELS), true);
  assert.throws(() => LEVELS.push(110), TypeError);
});

test('所有档位都按原始剩余值精确跨过，不被显示四舍五入提前触发', () => {
  for (const level of LEVELS) {
    const tracker = createQuotaAlertTracker();
    const previousLevel = level - 10;
    tracker.update([quotaWindow(level, 300, 100 - previousLevel)], {
      baseline: true,
      alwaysVisible: false
    });

    assert.deepEqual(tracker.update([
      quotaWindow(level, 300, 100 - level + 0.0001)
    ], { alwaysVisible: false }), [], `${level}% 档不应提前触发`);

    const alerts = tracker.update([
      quotaWindow(level, 300, 100 - level)
    ], { alwaysVisible: false });
    assert.equal(alerts.length, 1, `${level}% 档应恰好触发`);
    assert.equal(alerts[0].level, level);
  }
});

test('100% 档只在剩余严格等于 0 时触发，极小正数不被浮点抵消', () => {
  const tracker = createQuotaAlertTracker();
  tracker.update([quotaWindow('codex', 300, 10)], { baseline: true, alwaysVisible: false });

  assert.deepEqual(tracker.update([
    quotaWindow('codex', 300, Number.MIN_VALUE)
  ], { alwaysVisible: false }), []);
  assert.equal(tracker.update([
    quotaWindow('codex', 300, 0)
  ], { alwaysVisible: false })[0].level, 100);
});

test('档位直接按剩余阈值比较，紧邻 80% 和 90% 档的正数不提前触发', () => {
  const eighty = createQuotaAlertTracker();
  eighty.update([quotaWindow('eighty', 300, 30)], { baseline: true, alwaysVisible: false });
  assert.deepEqual(eighty.update([
    quotaWindow('eighty', 300, 20.000000000000004)
  ], { alwaysVisible: false }), []);
  assert.equal(eighty.update([
    quotaWindow('eighty', 300, 20)
  ], { alwaysVisible: false })[0].level, 80);

  const ninety = createQuotaAlertTracker();
  ninety.update([quotaWindow('ninety', 300, 20)], { baseline: true, alwaysVisible: false });
  assert.deepEqual(ninety.update([
    quotaWindow('ninety', 300, 10.000000000000002)
  ], { alwaysVisible: false }), []);
  assert.equal(ninety.update([
    quotaWindow('ninety', 300, 10)
  ], { alwaysVisible: false })[0].level, 90);
});

test('首次和新类别先建基线，普通档不补报而高用量只报当前最严重档', () => {
  const tracker = createQuotaAlertTracker();
  const alerts = tracker.update([
    quotaWindow('normal', 300, 30),
    quotaWindow('eighty', 300, 20),
    quotaWindow('ninety', 300, 10),
    quotaWindow('full', 300, 0)
  ], { baseline: true, alwaysVisible: false });

  assert.deepEqual(alerts.map(item => [item.id, item.level]), [
    ['eighty', 80],
    ['ninety', 90],
    ['full', 100]
  ]);
  assert.deepEqual(tracker.update([
    quotaWindow('late-normal', 300, 65)
  ], { alwaysVisible: false }), []);
});

test('一次跨多档只报最高档，回升、刷新和同账号重连不重复', () => {
  const tracker = createQuotaAlertTracker();
  const baseline = quotaWindow('codex', 300, 85);
  tracker.update([baseline], { baseline: true, alwaysVisible: false });

  assert.equal(tracker.update([
    quotaWindow('codex', 300, 54)
  ], { alwaysVisible: false })[0].level, 40);
  assert.deepEqual(tracker.update([quotaWindow('codex', 300, 60)], { alwaysVisible: false }), []);
  assert.deepEqual(tracker.update([quotaWindow('codex', 300, 54)], { alwaysVisible: false }), []);
  assert.deepEqual(tracker.update([{ ...quotaWindow('codex', 300, 54) }], { alwaysVisible: false }), []);
  assert.equal(tracker.update([quotaWindow('codex', 300, 49)], { alwaysVisible: false })[0].level, 50);
});

test('常驻开启抑制 10% 到 70% 但记录峰值，80% 到 100% 仍逐档触发', () => {
  const tracker = createQuotaAlertTracker();
  tracker.update([quotaWindow('codex', 300, 100)], { baseline: true, alwaysVisible: true });

  for (const level of LEVELS.slice(0, 7)) {
    assert.deepEqual(tracker.update([
      quotaWindow('codex', 300, 100 - level)
    ], { alwaysVisible: true }), []);
  }
  assert.deepEqual(tracker.update([quotaWindow('codex', 300, 30)], { alwaysVisible: false }), []);

  for (const level of [80, 90, 100]) {
    const alerts = tracker.update([
      quotaWindow('codex', 300, 100 - level)
    ], { alwaysVisible: true });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].level, level);
  }
});

test('只有超过历史峰值的新档触发，baseline 不会重报已观察强提醒', () => {
  const tracker = createQuotaAlertTracker();
  assert.equal(tracker.update([
    quotaWindow('codex', 300, 10)
  ], { baseline: true, alwaysVisible: false })[0].level, 90);
  assert.deepEqual(tracker.update([
    quotaWindow('codex', 300, 20)
  ], { alwaysVisible: false }), []);
  assert.deepEqual(tracker.update([
    quotaWindow('codex', 300, 10)
  ], { baseline: true, alwaysVisible: false }), []);
  assert.equal(tracker.update([
    quotaWindow('codex', 300, 0)
  ], { alwaysVisible: false })[0].level, 100);
});

test('reset 清空全部历史，新 resetsAt 自然作为新周期建基线', () => {
  const tracker = createQuotaAlertTracker();
  const oldCycle = quotaWindow('codex', 300, 70);
  tracker.update([oldCycle], { baseline: true, alwaysVisible: false });
  assert.equal(tracker.update([{ ...oldCycle, remaining: 50 }], { alwaysVisible: false })[0].level, 50);

  tracker.reset();
  assert.deepEqual(tracker.update([{ ...oldCycle, remaining: 50 }], { alwaysVisible: false }), []);
  assert.equal(tracker.update([{ ...oldCycle, remaining: 39 }], { alwaysVisible: false })[0].level, 60);

  const newCycle = quotaWindow('codex', 300, 30, NOW + 7200000);
  assert.deepEqual(tracker.update([newCycle], { alwaysVisible: false }), []);
  assert.equal(tracker.update([{ ...newCycle, remaining: 19 }], { alwaysVisible: false })[0].level, 80);
});

test('同一 update 的重复身份使用最后一个可靠值且不双报', () => {
  const tracker = createQuotaAlertTracker();
  tracker.update([quotaWindow('codex', 300, 95)], { baseline: true, alwaysVisible: false });

  const alerts = tracker.update([
    quotaWindow('codex', 300, 69),
    { ...quotaWindow('codex', 300, 25), remaining: Number.NaN },
    quotaWindow('codex', 300, 45)
  ], { alwaysVisible: false });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].level, 50);
  assert.equal(alerts[0].remaining, 45);
});

test('只接受结构完整的安全标量和合法比例、周期、重置时间', () => {
  const tracker = createQuotaAlertTracker();
  const valid = quotaWindow('valid', 300, 80);
  const invalid = [
    null,
    [],
    { ...valid, id: '' },
    { ...valid, id: 'x'.repeat(257) },
    { ...valid, label: '  ' },
    { ...valid, label: 'Codex\u0000' },
    { ...valid, windowMinutes: 0 },
    { ...valid, windowMinutes: 1.5 },
    { ...valid, windowMinutes: '300' },
    { ...valid, remaining: -0.0001 },
    { ...valid, remaining: 100.0001 },
    { ...valid, remaining: Number.NaN },
    { ...valid, remaining: '80' },
    { ...valid, resetsAt: 0 },
    { ...valid, resetsAt: -1 },
    { ...valid, resetsAt: 1.5 },
    { ...valid, resetsAt: Number.MAX_SAFE_INTEGER + 1 }
  ];

  assert.deepEqual(tracker.update(invalid, { baseline: true, alwaysVisible: false }), []);
  assert.deepEqual(tracker.update(null, null), []);
  assert.deepEqual(tracker.update({}, 'options'), []);
  assert.deepEqual(tracker.update([valid], { baseline: true, alwaysVisible: false }), []);
});

test('提醒携带完整周期引用的安全副本，更改输出不影响输入或后续去重', () => {
  const tracker = createQuotaAlertTracker();
  const source = Object.freeze({
    ...quotaWindow('codex', 300, 95, NOW + 3600000, 'Codex 额度'),
    privateData: Object.freeze({ token: 'secret' })
  });
  const windows = Object.freeze([source]);
  tracker.update(windows, { baseline: true, alwaysVisible: false });
  const alert = tracker.update([{ ...source, remaining: 80 }], { alwaysVisible: false })[0];

  assert.deepEqual(alert, {
    key: JSON.stringify(['codex', 300, NOW + 3600000]),
    level: 20,
    remaining: 80,
    id: 'codex',
    label: 'Codex 额度',
    windowMinutes: 300,
    resetsAt: NOW + 3600000
  });
  assert.equal('privateData' in alert, false);
  alert.id = 'changed';
  alert.remaining = 0;
  assert.equal(source.id, 'codex');
  assert.deepEqual(tracker.update([{ ...source, remaining: 80 }], { alwaysVisible: false }), []);
});

test('身份状态最多 64 项，被淘汰身份不当首次基线且 10% 到 20% 仍提醒', () => {
  const tracker = createQuotaAlertTracker();
  tracker.update(Array.from({ length: 64 }, (_, index) => (
    quotaWindow(`id-${index}`, 300, 100)
  )), { baseline: true, alwaysVisible: false });
  assert.equal(tracker.update(Array.from({ length: 64 }, (_, index) => (
    quotaWindow(`id-${index}`, 300, 90)
  )), { alwaysVisible: false }).length, 64);

  tracker.update([quotaWindow('id-64', 300, 100)], { alwaysVisible: false });

  assert.equal(tracker.update([quotaWindow('id-0', 300, 80)], { alwaysVisible: false })[0].level, 20);
});

test('同一批次最多跟踪前 64 个不同身份，超出项不引起状态抖动或重报', () => {
  const tracker = createQuotaAlertTracker();
  const baseline = Array.from({ length: 65 }, (_, index) => quotaWindow(`id-${index}`, 300, 100));
  const strong = baseline.map(item => ({ ...item, remaining: 20 }));

  assert.deepEqual(tracker.update(baseline, { baseline: true, alwaysVisible: false }), []);
  assert.equal(tracker.update(strong, { alwaysVisible: false }).length, 64);
  assert.deepEqual(tracker.update(strong, { alwaysVisible: false }), []);
});

test('满 64 项时批次换序且只替换一项，新身份不得级联误删已有身份', () => {
  const tracker = createQuotaAlertTracker();
  const initial = Array.from({ length: 64 }, (_, index) => quotaWindow(`id-${index}`, 300, 100));
  tracker.update(initial, { baseline: true, alwaysVisible: false });
  assert.equal(tracker.update(initial.map(item => ({ ...item, remaining: 20 })), {
    alwaysVisible: false
  }).length, 64);

  const reorderedReplacement = [
    quotaWindow('id-64', 300, 20),
    ...Array.from({ length: 63 }, (_, index) => quotaWindow(`id-${index}`, 300, 20))
  ];
  const alerts = tracker.update(reorderedReplacement, { alwaysVisible: false });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, 'id-64');
  assert.equal(alerts[0].level, 80);
  assert.deepEqual(tracker.update(reorderedReplacement, { alwaysVisible: false }), []);
});

test('64 项上限的两个交替批次多轮往返，同周期同档不得无限重报', () => {
  const tracker = createQuotaAlertTracker();
  const firstBatch = Array.from({ length: 64 }, (_, index) => quotaWindow(`id-${index}`, 300, 100));
  tracker.update(firstBatch, { baseline: true, alwaysVisible: false });
  assert.equal(tracker.update(firstBatch.map(item => ({ ...item, remaining: 20 })), {
    alwaysVisible: false
  }).length, 64);

  const batchA = [
    quotaWindow('id-64', 300, 20),
    ...Array.from({ length: 63 }, (_, index) => quotaWindow(`id-${index}`, 300, 20))
  ];
  const batchB = Array.from({ length: 64 }, (_, index) => quotaWindow(`id-${index}`, 300, 20));
  assert.deepEqual(tracker.update(batchA, { alwaysVisible: false }).map(item => item.id), ['id-64']);
  assert.deepEqual(tracker.update(batchB, { alwaysVisible: false }), []);

  for (let round = 0; round < 5; round += 1) {
    assert.deepEqual(tracker.update(batchA, { alwaysVisible: false }), []);
    assert.deepEqual(tracker.update(batchB, { alwaysVisible: false }), []);
  }
});

test('129 个身份在批首、批尾及多轮交替时不级联或重复轰炸', () => {
  for (const position of ['first', 'last']) {
    const tracker = createQuotaAlertTracker();
    const first = Array.from({ length: 64 }, (_, index) => quotaWindow(`id-${index}`, 300, 100));
    tracker.update(first, { baseline: true, alwaysVisible: false });
    assert.equal(tracker.update(first.map(item => ({ ...item, remaining: 20 })), {
      alwaysVisible: false
    }).length, 64);

    const second = Array.from({ length: 64 }, (_, index) => quotaWindow(`id-${index + 64}`, 300, 20));
    assert.deepEqual(tracker.update(second, { alwaysVisible: false }).map(item => item.id),
      second.map(item => item.id));
    assert.deepEqual(tracker.update(second, { alwaysVisible: false }), []);

    const retained = second.slice(0, 63);
    const boundary = quotaWindow('id-128', 300, 20);
    const third = position === 'first' ? [boundary, ...retained] : [...retained, boundary];
    assert.deepEqual(tracker.update(third, { alwaysVisible: false }).map(item => item.id), ['id-128']);

    for (let round = 0; round < 3; round += 1) {
      assert.deepEqual(tracker.update(first.map(item => ({ ...item, remaining: 20 })), {
        alwaysVisible: false
      }), []);
      assert.deepEqual(tracker.update(second, { alwaysVisible: false }), []);
      assert.deepEqual(tracker.update(third, { alwaysVisible: false }), []);
    }
  }
});

test('状态饱和后第 66 个真正新周期仍先建基线，20% 不误报而 80/90/100 逐档提醒', () => {
  const tracker = createQuotaAlertTracker();
  const first = Array.from({ length: 64 }, (_, index) => quotaWindow(`id-${index}`, 300, 100));
  tracker.update(first, { baseline: true, alwaysVisible: false });
  tracker.update([quotaWindow('id-64', 300, 100)], { alwaysVisible: false });

  const sixtySixth = quotaWindow('id-65', 300, 80);
  assert.deepEqual(tracker.update([sixtySixth], { alwaysVisible: false }), []);
  assert.equal(tracker.update([{ ...sixtySixth, remaining: 20 }], { alwaysVisible: false })[0].level, 80);
  assert.equal(tracker.update([{ ...sixtySixth, remaining: 10 }], { alwaysVisible: false })[0].level, 90);
  assert.equal(tracker.update([{ ...sixtySixth, remaining: 0 }], { alwaysVisible: false })[0].level, 100);

  tracker.reset();
  assert.equal(tracker.update([{ ...sixtySixth, remaining: 20 }], {
    baseline: true,
    alwaysVisible: false
  })[0].level, 80);
});

test('状态饱和后真正新 key 首次处于 80/90/100 时各只报当前最严重档', () => {
  const tracker = createQuotaAlertTracker();
  const first = Array.from({ length: 64 }, (_, index) => quotaWindow(`id-${index}`, 300, 100));
  tracker.update(first, { baseline: true, alwaysVisible: false });
  tracker.update([quotaWindow('overflow', 300, 100)], { alwaysVisible: false });

  const alerts = tracker.update([
    quotaWindow('new-80', 300, 20),
    quotaWindow('new-90', 300, 10),
    quotaWindow('new-100', 300, 0)
  ], { alwaysVisible: false });
  assert.deepEqual(alerts.map(item => [item.id, item.level]), [
    ['new-80', 80],
    ['new-90', 90],
    ['new-100', 100]
  ]);
  assert.deepEqual(tracker.update([
    quotaWindow('new-80', 300, 20),
    quotaWindow('new-90', 300, 10),
    quotaWindow('new-100', 300, 0)
  ], { alwaysVisible: false }), []);
});

test('每个 tracker 使用独立盐生成指纹，随机源或强哈希异常不外抛', () => {
  let saltByte = 0;
  const salts = [];
  const positions = [];
  const randomBytes = size => Buffer.alloc(size, ++saltByte);
  const fingerprintDigest = (key, salt) => {
    salts.push(salt[0]);
    const digest = createHmac('sha256', salt).update(key).digest();
    positions.push(Array.from({ length: 6 }, (_, index) => (
      digest.readUInt32BE(index * 4) & ((1 << 20) - 1)
    )));
    return digest;
  };
  const first = createQuotaAlertTracker({ randomBytes, fingerprintDigest });
  const second = createQuotaAlertTracker({ randomBytes, fingerprintDigest });
  first.update([quotaWindow('same-key', 300, 100)], { baseline: true });
  second.update([quotaWindow('same-key', 300, 100)], { baseline: true });
  assert.deepEqual(salts, [1, 2]);
  assert.notDeepEqual(positions[0], positions[1]);

  const brokenRandom = createQuotaAlertTracker({
    randomBytes() { throw new Error('random unavailable'); }
  });
  const brokenHash = createQuotaAlertTracker({
    fingerprintSalt: Buffer.alloc(32, 7),
    fingerprintDigest() { throw new Error('hash unavailable'); }
  });
  assert.doesNotThrow(() => brokenRandom.update(Array.from({ length: 65 }, (_, index) => (
    quotaWindow(`random-${index}`, 300, 20)
  )), { baseline: true }));
  assert.doesNotThrow(() => brokenHash.update(Array.from({ length: 65 }, (_, index) => (
    quotaWindow(`hash-${index}`, 300, 20)
  )), { baseline: true }));
});

test('摘要一次临时失败后锁定停用，满载批次往返不重报且 reset 后恢复', () => {
  let hashUnavailable = true;
  let digestCalls = 0;
  const tracker = createQuotaAlertTracker({
    fingerprintSalt: Buffer.alloc(32, 29),
    fingerprintDigest(key, salt) {
      digestCalls += 1;
      if (hashUnavailable) throw new Error('temporary hash failure');
      return createHmac('sha256', salt).update(key).digest();
    }
  });
  const first = Array.from({ length: 64 }, (_, index) => (
    quotaWindow(`unstable-first-${index}`, 300, 20)
  ));
  const second = Array.from({ length: 64 }, (_, index) => (
    quotaWindow(`unstable-second-${index}`, 300, 20)
  ));

  assert.equal(tracker.update(first, { baseline: true }).length, 64);
  hashUnavailable = false;
  const callsAtLock = digestCalls;
  assert.deepEqual(tracker.update(second, { alwaysVisible: false }), []);
  assert.equal(tracker.update([{ ...second[0], remaining: 10 }], {
    alwaysVisible: false
  })[0].level, 90, '保守峰值仍应允许未来更高档');
  assert.deepEqual(tracker.update([{ ...second[0], remaining: 10 }], {
    alwaysVisible: false
  }), []);
  assert.deepEqual(tracker.update(first, { alwaysVisible: false }), []);
  assert.equal(digestCalls, callsAtLock, '锁定后不应继续使用或信任部分摘要');

  tracker.reset();
  const afterReset = quotaWindow('after-summary-reset', 300, 80);
  assert.deepEqual(tracker.update([afterReset], { alwaysVisible: false }), []);
  assert.equal(tracker.update([{ ...afterReset, remaining: 20 }], {
    alwaysVisible: false
  })[0].level, 80);
  assert.ok(digestCalls > callsAtLock, 'reset 后应重新尝试健康摘要');
});

test('旧无盐算法可定向覆盖的四个 key 不再使新周期普通档误报', () => {
  const tracker = createQuotaAlertTracker({ fingerprintSalt: Buffer.alloc(32, 11) });
  const attackerIds = [
    'old-attacker-13992',
    'old-attacker-14209',
    'old-attacker-37831',
    'old-attacker-51406'
  ];
  tracker.update(attackerIds.map(id => quotaWindow(id, 300, 100)), { baseline: true });
  tracker.update(attackerIds.map(id => quotaWindow(id, 300, 90)), { alwaysVisible: false });

  const target = quotaWindow('old-collision-target', 300, 80);
  assert.deepEqual(tracker.update([target], { alwaysVisible: false }), []);
  assert.equal(tracker.update([{ ...target, remaining: 20 }], { alwaysVisible: false })[0].level, 80);
});

test('seen 位图单独碰撞但没有任何档位命中时仍按新周期基线处理', () => {
  const tracker = createQuotaAlertTracker({
    fingerprintSalt: Buffer.alloc(32, 13),
    fingerprintDigest: () => Buffer.alloc(32, 17)
  });
  tracker.update([quotaWindow('seen-only-source', 300, 100)], { baseline: true });

  const target = quotaWindow('seen-only-target', 300, 80);
  assert.deepEqual(tracker.update([target], { alwaysVisible: false }), []);
  assert.equal(tracker.update([{ ...target, remaining: 20 }], {
    alwaysVisible: false
  })[0].level, 80);
});

test('10000 个合法历史后旧算法的稳定假阳性样本仍按新周期基线和 80% 强提醒', () => {
  const tracker = createQuotaAlertTracker({ fingerprintSalt: Buffer.alloc(32, 23) });
  for (let start = 0; start < 10000; start += 64) {
    const size = Math.min(64, 10000 - start);
    tracker.update(Array.from({ length: size }, (_, offset) => (
      quotaWindow(`history-${start + offset}`, 300, 0)
    )), { baseline: true, alwaysVisible: false });
  }

  const oldFalsePositives = [
    'fresh-2', 'fresh-10', 'fresh-42', 'fresh-86',
    'fresh-88', 'fresh-100', 'fresh-142', 'fresh-168'
  ];
  assert.deepEqual(tracker.update(oldFalsePositives.map(id => quotaWindow(id, 300, 80)), {
    alwaysVisible: false
  }), []);
  assert.deepEqual(tracker.update(oldFalsePositives.map(id => quotaWindow(id, 300, 20)), {
    alwaysVisible: false
  }).map(item => item.id), oldFalsePositives);
});

test('多类别提醒合并返回最高档、最低实际剩余和稳定的安全引用', () => {
  const tracker = createQuotaAlertTracker();
  tracker.update([
    quotaWindow('codex', 300, 100),
    quotaWindow('spark', 10080, 100)
  ], { baseline: true, alwaysVisible: false });
  const alerts = tracker.update([
    quotaWindow('codex', 300, 19),
    quotaWindow('spark', 10080, 8)
  ], { alwaysVisible: false });
  const merged = mergeQuotaAlerts(alerts);

  assert.equal(merged.level, 90);
  assert.equal(merged.remaining, 8);
  assert.equal(merged.count, 2);
  assert.deepEqual(merged.refs.map(item => item.id), ['codex', 'spark']);
  merged.refs[0].remaining = 0;
  assert.equal(alerts[0].remaining, 19);
});

test('合并忽略非法项、按 key 去重并最多保留 64 个有效提醒', () => {
  assert.equal(mergeQuotaAlerts(), null);
  assert.equal(mergeQuotaAlerts(null), null);
  assert.equal(mergeQuotaAlerts({}), null);
  assert.equal(mergeQuotaAlerts([]), null);

  const tracker = createQuotaAlertTracker();
  const windows = Array.from({ length: 65 }, (_, index) => quotaWindow(`id-${index}`, 300, 100));
  tracker.update(windows, { baseline: true, alwaysVisible: false });
  const validAlerts = tracker.update(windows.map(item => ({ ...item, remaining: 20 })), {
    alwaysVisible: false
  });
  const first = validAlerts[0];
  const duplicate = { ...first, remaining: 19, level: 80 };
  const invalid = [
    null,
    {},
    { ...first, key: '' },
    { ...first, level: 75 },
    { ...first, remaining: -1 },
    { ...first, id: [] },
    { ...first, label: {} },
    { ...first, windowMinutes: 0 },
    { ...first, resetsAt: 0 }
  ];
  const merged = mergeQuotaAlerts([first, ...invalid, ...validAlerts.slice(1), duplicate]);

  assert.equal(merged.count, 64);
  assert.equal(merged.refs.length, 64);
  assert.deepEqual(merged.refs.slice(0, 3).map(item => item.id), ['id-0', 'id-1', 'id-2']);
  assert.equal(merged.refs[0].remaining, 19);
  assert.equal(merged.level, 80);
  assert.equal(merged.remaining, 19);
});

test('合并只接受与额度身份完全匹配的 key，拒绝伪造独立 key 或共用 key', () => {
  const tracker = createQuotaAlertTracker();
  tracker.update([
    quotaWindow('codex', 300, 100),
    quotaWindow('spark', 10080, 100)
  ], { baseline: true, alwaysVisible: false });
  const [codex, spark] = tracker.update([
    quotaWindow('codex', 300, 20),
    quotaWindow('spark', 10080, 10)
  ], { alwaysVisible: false });

  assert.equal(mergeQuotaAlerts([{ ...codex, key: 'forged-independent-key' }]), null);
  assert.equal(mergeQuotaAlerts([{ ...spark, key: codex.key }]), null);

  const merged = mergeQuotaAlerts([
    codex,
    { ...codex, key: 'forged-independent-key' },
    { ...spark, key: codex.key },
    spark
  ]);
  assert.equal(merged.count, 2);
  assert.deepEqual(merged.refs.map(item => item.id), ['codex', 'spark']);
});

test('合并拒绝与实际剩余不一致的档位，非法重复项不覆盖合法项', () => {
  const tracker = createQuotaAlertTracker();
  tracker.update([quotaWindow('codex', 300, 100)], { baseline: true, alwaysVisible: false });
  const valid = tracker.update([quotaWindow('codex', 300, 20)], { alwaysVisible: false })[0];
  const mismatched = { ...valid, remaining: 99, level: 100 };

  assert.equal(mergeQuotaAlerts([mismatched]), null);
  assert.deepEqual(mergeQuotaAlerts([valid, mismatched]).refs, [valid]);
  assert.deepEqual(mergeQuotaAlerts([mismatched, valid]).refs, [valid]);
});

test('update 与 merge 安全忽略会抛错的 getter、Proxy 和已撤销 Proxy', () => {
  const tracker = createQuotaAlertTracker();
  const throwingItem = new Proxy({}, { get() { throw new Error('private getter'); } });
  const throwingOptions = new Proxy({}, { get() { throw new Error('private option'); } });
  const revokedWindows = Proxy.revocable([], {});
  const revokedAlerts = Proxy.revocable([], {});
  const symbolicLength = new Proxy([], {
    get(target, property, receiver) {
      if (property === 'length') return Symbol('invalid length');
      return Reflect.get(target, property, receiver);
    }
  });
  revokedWindows.revoke();
  revokedAlerts.revoke();

  assert.doesNotThrow(() => tracker.update([throwingItem], throwingOptions));
  assert.deepEqual(tracker.update([throwingItem], throwingOptions), []);
  assert.doesNotThrow(() => tracker.update(revokedWindows.proxy));
  assert.deepEqual(tracker.update(revokedWindows.proxy), []);
  assert.doesNotThrow(() => mergeQuotaAlerts([throwingItem]));
  assert.equal(mergeQuotaAlerts([throwingItem]), null);
  assert.doesNotThrow(() => mergeQuotaAlerts(revokedAlerts.proxy));
  assert.equal(mergeQuotaAlerts(revokedAlerts.proxy), null);
  assert.doesNotThrow(() => tracker.update(symbolicLength));
  assert.deepEqual(tracker.update(symbolicLength), []);
  assert.doesNotThrow(() => mergeQuotaAlerts(symbolicLength));
  assert.equal(mergeQuotaAlerts(symbolicLength), null);

  let windowReads = 0;
  let alertReads = 0;
  const longWindows = new Proxy([], {
    get(target, property, receiver) {
      if (property === 'length') return 2048;
      if (/^\d+$/u.test(String(property))) windowReads += 1;
      return Reflect.get(target, property, receiver);
    }
  });
  const longAlerts = new Proxy([], {
    get(target, property, receiver) {
      if (property === 'length') return 2048;
      if (/^\d+$/u.test(String(property))) alertReads += 1;
      return Reflect.get(target, property, receiver);
    }
  });
  tracker.update(longWindows);
  mergeQuotaAlerts(longAlerts);
  assert.ok(windowReads > 0 && windowReads < 2048);
  assert.ok(alertReads > 0 && alertReads < 2048);
});

test('访问器标量只读取一次就防御复制，单个异常数组项不阻断后续可靠项', () => {
  const tracker = createQuotaAlertTracker();
  let idReads = 0;
  const accessor = {
    get id() { idReads += 1; return `accessor-${idReads}`; },
    label: '访问器额度',
    windowMinutes: 300,
    remaining: 20,
    resetsAt: NOW + 3600000
  };
  const mixed = new Proxy([null, accessor], {
    get(target, property, receiver) {
      if (property === '0') throw new Error('broken slot');
      return Reflect.get(target, property, receiver);
    }
  });
  const alerts = tracker.update(mixed, { baseline: true, alwaysVisible: false });

  assert.equal(idReads, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, 'accessor-1');
  assert.equal(alerts[0].key, JSON.stringify(['accessor-1', 300, NOW + 3600000]));
});

test('合并不变异原提醒，也不携带多余或非标量数据', () => {
  const tracker = createQuotaAlertTracker();
  tracker.update([quotaWindow('codex', 300, 100)], { baseline: true, alwaysVisible: false });
  const source = Object.freeze({
    ...tracker.update([quotaWindow('codex', 300, 20)], { alwaysVisible: false })[0],
    nested: Object.freeze({ secret: true })
  });
  const alerts = Object.freeze([source]);
  const merged = mergeQuotaAlerts(alerts);

  assert.notEqual(merged.refs[0], source);
  assert.equal('nested' in merged.refs[0], false);
  assert.equal(source.remaining, 20);
});
