(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CompanionBehavior = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  const EMOTIONS = { awake: '50', focus: '16', spacing: '04', tired: '15', sleep: '00' };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const isPoint = value => value && Number.isFinite(value.x) && Number.isFinite(value.y);
  const isAwake = mode => mode === 'awake' || mode === 'focus';

  class CompanionState {
    constructor({ keepAwake = false } = {}) {
      this.manualSleep = false;
      this.keepAwake = Boolean(keepAwake);
      this._lastInteraction = -Infinity;
      this._lowIdleSince = null;
      this._cursor = null;
      this._cursorStillSince = null;
      this._lastCursorMove = -Infinity;
      this._automaticResting = false;
    }

    noteInteraction(nowMs) {
      if (Number.isFinite(nowMs)) this._lastInteraction = nowMs;
      this._lowIdleSince = null;
    }

    setManualSleep(enabled, nowMs) {
      this.manualSleep = Boolean(enabled);
      this._automaticResting = false;
      this._lowIdleSince = null;
      if (!this.manualSleep) this.noteInteraction(nowMs);
    }

    setKeepAwake(enabled) {
      this.keepAwake = Boolean(enabled);
    }

    update(sample, nowMs) {
      const { idleSeconds, cursor, sameDisplay, petBounds, locked } = sample;
      if (isPoint(cursor)) {
        if (!this._cursor) this._cursorStillSince = nowMs;
        else if (cursor.x !== this._cursor.x || cursor.y !== this._cursor.y) {
          this._cursorStillSince = nowMs;
          this._lastCursorMove = nowMs;
        }
        this._cursor = { x: cursor.x, y: cursor.y };
      } else {
        this._cursor = null;
        this._cursorStillSince = null;
        this._lastCursorMove = -Infinity;
      }

      const knownIdle = Number.isFinite(idleSeconds) && idleSeconds >= 0;
      // 用系统空闲和鼠标静止近似工作状态，不读取任何输入内容。
      if (knownIdle && idleSeconds <= 2 && !locked && !this.manualSleep) {
        if (this._lowIdleSince === null) this._lowIdleSince = nowMs;
      } else this._lowIdleSince = null;

      let mode = 'awake';
      if (this.manualSleep || locked) mode = 'sleep';
      else if (knownIdle) {
        const localIdle = Math.max(0, (nowMs - this._lastInteraction) / 1000);
        const effectiveIdle = Math.min(idleSeconds, localIdle);
        if (!this.keepAwake && effectiveIdle >= 900) mode = 'sleep';
        else if (!this.keepAwake && effectiveIdle >= 600) mode = 'tired';
        else if (!this.keepAwake && effectiveIdle >= 300) mode = 'spacing';
        else if (this._lowIdleSince !== null && nowMs - this._lowIdleSince >= 4000 &&
          this._cursorStillSince !== null && nowMs - this._cursorStillSince >= 3000) mode = 'focus';
      }

      const welcome = this._automaticResting && isAwake(mode);
      this._automaticResting = !this.manualSleep && !isAwake(mode);

      let gaze = null;
      if (isAwake(mode) && sameDisplay === true && isPoint(cursor) && isPoint(petBounds) &&
        petBounds.width > 0 && petBounds.height > 0 &&
        Number.isFinite(petBounds.width) && Number.isFinite(petBounds.height) &&
        nowMs - this._lastCursorMove <= 2500) {
        gaze = {
          x: clamp((cursor.x - petBounds.x - petBounds.width / 2) / Math.max(240, petBounds.width * 2), -1, 1),
          y: clamp((cursor.y - petBounds.y - petBounds.height / 2) / Math.max(180, petBounds.height * 2), -1, 1)
        };
      }
      return { mode, emotionId: EMOTIONS[mode], welcome, gaze };
    }
  }

  class PettingTracker {
    constructor() {
      this._cooldownUntil = -Infinity;
      this.reset();
    }

    reset() {
      this._startedAt = null;
      this._lastPoint = null;
      this._distance = 0;
    }

    update({ x, y, width, height, buttons = 0 }, nowMs) {
      const onHead = [x, y, width, height, nowMs].every(Number.isFinite) &&
        width > 0 && height > 0 && x >= 0 && x <= width && y >= 0 && y <= height * 0.42;
      if (!onHead || buttons !== 0 || nowMs < this._cooldownUntil) {
        this.reset();
        return false;
      }

      // 移动事件可能只在坐标变化时发出，间隔过长不能算持续抚摸。
      if (this._lastPoint === null || nowMs - this._startedAt > 2000 ||
        nowMs - this._lastPoint.at > 500 || nowMs < this._lastPoint.at) {
        this._startedAt = nowMs;
        this._distance = 0;
        this._lastPoint = { x, y, at: nowMs };
        return false;
      }

      const distance = Math.hypot(x - this._lastPoint.x, y - this._lastPoint.y);
      this._lastPoint = { x, y, at: nowMs };
      if (distance === 0) {
        this._startedAt = nowMs;
        this._distance = 0;
        return false;
      }

      this._distance += distance;
      if (nowMs - this._startedAt >= 650 && this._distance >= width * 0.45) {
        this._cooldownUntil = nowMs + 6000;
        this.reset();
        return true;
      }
      return false;
    }
  }
  return { CompanionState, PettingTracker };
});
