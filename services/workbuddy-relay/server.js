#!/usr/bin/env node
'use strict';
const path = require('node:path');
const http = require('node:http');
const { createOAuthBroker, configuration } = require('./oauth-broker');
const { createEncryptedStore } = require('./encrypted-store');
const { createRelayHandler } = require('./http-handler');
function makeServer({ env = process.env } = {}) {
  // No download, vendor request or listener until all confidential-server configuration is present.
  const config = configuration(env);
  if (!env.WORKBUDDY_STORE_KEY || !path.isAbsolute(env.WORKBUDDY_STORE_DIRECTORY || '')) throw Object.assign(new Error('CONFIGURATION_REQUIRED'), { code:'CONFIGURATION_REQUIRED' });
  const tokens = createEncryptedStore({ directory:path.join(env.WORKBUDDY_STORE_DIRECTORY,'tokens'), keyBase64:env.WORKBUDDY_STORE_KEY });
  const ledgerStore = createEncryptedStore({ directory:path.join(env.WORKBUDDY_STORE_DIRECTORY,'requests'), keyBase64:env.WORKBUDDY_STORE_KEY });
  const broker = createOAuthBroker({ config, tokenStore:tokens });
  const { createWorkBuddyOpenApiClient } = require('../../desktop-pet/lib/workbuddy-openapi-client');
  const handler = createRelayHandler({ broker, ledgerStore, callbackUrl:config.redirectUri,
    createClient: sessionId => createWorkBuddyOpenApiClient({ tokenPort:{ getAccessToken: options => broker.getAccessToken(sessionId, options) } }) });
  const server = http.createServer((req,res) => { void handler(req,res); });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxRequestsPerSocket = 100;
  return server;
}
if (require.main === module) {
  try {
    const port = Number(process.env.PORT || 8787);
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Object.assign(new Error(), { code:'INVALID_PORT' });
    const server = makeServer();
    // TLS terminates at the operator's registered HTTPS reverse proxy; never expose a raw public HTTP listener.
    server.listen(port, '127.0.0.1', () => process.stdout.write(JSON.stringify({ status:'ready', port, host:'127.0.0.1', requiresHttpsReverseProxy:true })+'\n'));
    server.on('error', () => { process.stderr.write('RELAY_START_FAILED\n'); process.exitCode=1; });
  } catch (error) { process.stderr.write(['CONFIGURATION_REQUIRED','INVALID_CALLBACK','INVALID_PORT','INVALID_STORE_CONFIG'].includes(error?.code) ? error.code+'\n' : 'RELAY_CONFIGURATION_FAILED\n'); process.exitCode=2; }
}
module.exports = { makeServer };
