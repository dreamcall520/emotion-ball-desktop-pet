(function (root) {
  const config = Object.freeze({ endpoint: 'https://qiuqiu-feedback-entry.pages.dev/api/feedback' });
  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.QIUQIU_FEEDBACK_CONFIG = config;
})(globalThis);
