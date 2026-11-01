'use strict';

// This runtime never downloads a CLI, searches another app, exposes a server,
// copies another tool's login, or launches a shell. Build-time preparation is
// deliberately a different script and is excluded from the application bundle.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createCodexChatRpc } = require('./codex-chat-rpc');
const VERSION = '0.166.0';
const fail = code => Object.assign(new Error(code), { code });
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0');

async function regularFile(file, { maxSize = Infinity, executable = false } = {}) {
  const stat = await fs.promises.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > maxSize) throw fail('BUNDLED_RUNTIME_INVALID');
  if (executable) await fs.promises.access(file, fs.constants.X_OK);
  return stat;
}
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW })) hash.update(chunk);
  return hash.digest('hex');
}
async function resolveBundledCodex({ resourcesPath, platform = process.platform, arch = process.arch } = {}) {
  if (!absolute(resourcesPath)) throw fail('INVALID_INPUT');
  if (platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) throw fail('BUNDLED_RUNTIME_UNSUPPORTED');
  const root = path.join(resourcesPath, 'qiuqiu-codex'), directory = path.join(root, `${platform}-${arch}`);
  try {
    for (const dir of [resourcesPath, root, directory]) {
      const stat = await fs.promises.lstat(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('BUNDLED_RUNTIME_INVALID');
    }
    const manifestPath = path.join(directory, 'manifest.json');
    await regularFile(manifestPath, { maxSize: 16384 });
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.provider !== 'codex' || manifest.version !== VERSION ||
      manifest.platform !== platform || manifest.arch !== arch || manifest.license !== 'Apache-2.0' ||
      manifest.binary !== 'codex' || !/^[a-f0-9]{64}$/.test(manifest.binarySha256)) throw fail('BUNDLED_RUNTIME_INVALID');
    const binaryPath = path.join(directory, 'codex');
    await regularFile(binaryPath, { maxSize: 512 * 1024 * 1024, executable: true });
    // The packager refreshes this digest after signing the nested executable.
    if (await digest(binaryPath) !== manifest.binarySha256) throw fail('BUNDLED_RUNTIME_INVALID');
    for (const name of ['LICENSE', 'NOTICE']) await regularFile(path.join(directory, name), { maxSize: 128 * 1024 });
    return { binaryPath, version: VERSION, transport: 'stdio', bundled: true };
  } catch (error) {
    if (error.code === 'ENOENT') throw fail('BUNDLED_RUNTIME_MISSING');
    throw fail(error.code === 'BUNDLED_RUNTIME_INVALID' ? error.code : 'BUNDLED_RUNTIME_INVALID');
  }
}

async function privateDirectory(directory) {
  // Check each existing ancestor before mkdir; never follow a profile/workspace symlink.
  const parsed = path.parse(directory), parts = path.relative(parsed.root, directory).split(path.sep);
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = await fs.promises.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail('UNSAFE_CONFIG');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.promises.mkdir(current, { mode: 0o700 });
    }
  }
  await fs.promises.chmod(directory, 0o700);
}
async function createBundledCodexChatRpc({ resourcesPath, profileHome, workspaceDir, env = process.env,
  platform = process.platform, arch = process.arch, createRpc = createCodexChatRpc, ...options } = {}) {
  if (!absolute(profileHome) || !absolute(workspaceDir) || typeof createRpc !== 'function') throw fail('INVALID_INPUT');
  if (path.resolve(profileHome) === path.resolve(os.homedir())) throw fail('UNSAFE_CONFIG');
  // The caller supplies an application-owned profileHome, never the actual host HOME.
  // Credentials are obtained only by the official browser login in this profile.
  const bundle = await resolveBundledCodex({ resourcesPath, platform, arch });
  const codexHome = path.join(profileHome, '.codex');
  for (const dir of [profileHome, codexHome, workspaceDir]) await privateDirectory(dir);
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) =>
    !/^(CODEX_|OPENAI_|ANTHROPIC_|AZURE_OPENAI_|GEMINI_|ZCODE_|CODEBUDDY_|OTEL_)/.test(key) &&
    !['HOME', 'NODE_OPTIONS', 'NODE_PATH'].includes(key)));
  Object.assign(childEnv, { HOME: profileHome, CODEX_HOME: codexHome });
  return createRpc({ ...options, workspaceDir, binaryPath: bundle.binaryPath,
    homedir: () => profileHome, env: childEnv, webSocket: null, disableOptionalTelemetry: true });
}
module.exports = { resolveBundledCodex, createBundledCodexChatRpc, VERSION };
