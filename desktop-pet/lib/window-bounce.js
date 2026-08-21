const VIEWBOX_SIZE = 259;
const BOUNCE_SEGMENTS = Object.freeze([
  Object.freeze({ height: 48, durationMs: 500 }),
  Object.freeze({ height: 28, durationMs: 382 }),
  Object.freeze({ height: 14, durationMs: 270 }),
  Object.freeze({ height: 6, durationMs: 177 })
]);
const BOUNCE_TOTAL_MS = BOUNCE_SEGMENTS.reduce(
  (total, segment) => total + segment.durationMs,
  0
);

function bounceOffset(elapsedMs, windowWidth) {
  if (
    !Number.isFinite(elapsedMs) ||
    !Number.isFinite(windowWidth) ||
    elapsedMs <= 0 ||
    elapsedMs >= BOUNCE_TOTAL_MS ||
    windowWidth <= 0
  ) {
    return 0;
  }

  let segmentStart = 0;
  for (const segment of BOUNCE_SEGMENTS) {
    const segmentEnd = segmentStart + segment.durationMs;
    if (elapsedMs < segmentEnd) {
      const progress = (elapsedMs - segmentStart) / segment.durationMs;
      const viewBoxOffset =
        4 * segment.height * progress * (1 - progress);
      return Math.round(viewBoxOffset * windowWidth / VIEWBOX_SIZE);
    }
    segmentStart = segmentEnd;
  }

  return 0;
}

module.exports = {
  BOUNCE_TOTAL_MS,
  bounceOffset
};
