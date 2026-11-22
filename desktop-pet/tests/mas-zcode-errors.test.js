'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { zcodeConnectionError } = require('../lib/mas-zcode-errors');
test('connection failures identify the failing authority without assuming logout', () => {
  assert.match(zcodeConnectionError({ code: 'DIRECTORY_ACCESS_REQUIRED' }).message, /目录授权/);
  assert.doesNotMatch(zcodeConnectionError({ code: 'ZCODE_INVALID_RESPONSE' }).message, /登录/);
  assert.match(zcodeConnectionError({ code: 'ZCODE_LOGIN_REQUIRED' }).message, /登录/);
  assert.deepEqual(zcodeConnectionError({ code: 'private-token', message: 'private-body' }), {
    code: 'ZCODE_CONNECTION_FAILED', message: 'ZCode 连接暂未完成，请重试。'
  });
});
