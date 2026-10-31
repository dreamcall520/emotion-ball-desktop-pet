"use strict";
// Offline, fixed-Qiuqiu-plugin installer. No CLI, child process, network, model,
// account file, or arbitrary plugin/package capability is exposed here.
const fs = require("node:fs"),
  path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const MAX_JSON = 2 * 1024 * 1024,
  MAX_ASSET = 256 * 1024;
const SPECS = Object.freeze({
  workbuddy: Object.freeze({
    market: "qiuqiu-local-review",
    name: "qiuqiu-task-events",
    version: "0.2.0",
    storage: "plugins",
    config: "settings.json",
    manifest: ".codebuddy-plugin/marketplace.json",
    pluginManifest: ".codebuddy-plugin/plugin.json",
    hashes: Object.freeze({
      ".codebuddy-plugin/marketplace.json":
        "6a0138a5b8ec15187c1e820d54fa86eb6f7d6e301d4130ed191b947f76b93c5c",
      ".codebuddy-plugin/plugin.json":
        "c62679f59a54f58f17cacf868cfb191d772ab71ac9f09d0e43baeba5082473db",
      "hooks/hooks.json":
        "5087f751c9b5c6d17e6b6031469ffc51242e86d8d06f46dd5c6c8939bf189781",
      "scripts/emit-metadata.sh":
        "2dd72cf927898ce3b97d7184663cd18a8f3255483e8f2ef036568b7edb100979",
    }),
  }),
  zcode: Object.freeze({
    market: "qiuqiu-zcode-local-review",
    name: "qiuqiu-zcode-task-events",
    version: "0.1.0",
    storage: "cli/plugins",
    config: "cli/config.json",
    manifest: ".claude-plugin/marketplace.json",
    pluginManifest: ".zcode-plugin/plugin.json",
    hashes: Object.freeze({
      ".claude-plugin/marketplace.json":
        "6c376ddbca9fab30dba78aa0a844a3e831cb6893a7f195a14c7cff8e9f8f2545",
      ".zcode-plugin/plugin.json":
        "2ad92a824be5a0378036a31fbc776e3e6d7154905153c9c82e624049f412f386",
      "hooks/hooks.json":
        "4790f37a41bb5faff18c4b211115dac0cb737780db722ffe0d50f8430fae47d9",
      "scripts/emit-metadata.sh":
        "5384995cc8c6da55ef171eeb2fad569c19d948511ebc61685aff9779da152c54",
    }),
  }),
});
const MESSAGES = Object.freeze({
  DIRECTORY_ACCESS_REQUIRED: "请先允许球球安装任务插件到原工具目录。",
  CANCELLED: "已取消插件安装，已完成的其他连接保持。",
  CONSENT_REQUIRED: "需要先确认仅安装球球任务插件。",
  INSTALL_BUSY: "正在处理插件安装，请稍候。",
  HOST_RUNNING:
    "原工具正在使用，请完成当前任务并退出后重试安装，聊天连接保持。",
  PLATFORM_UNSUPPORTED: "当前系统尚未支持安全的插件安装锁，未继续安装。",
  UNSAFE_PATH: "安装目录包含不支持的链接或路径，未继续安装。",
  MISSING_PLUGIN_FILE: "球球插件安装文件尚未准备完整。",
  UNSUPPORTED_FILE: "当前插件配置文件格式或大小暂不支持。",
  INVALID_JSON: "原工具插件配置无法安全读取，已停止安装。",
  UNSUPPORTED_SCHEMA: "原工具插件配置格式尚未验证，已停止安装。",
  INVALID_RECEIVER: "本机任务连接未准备完整，请重新准备连接。",
  PLUGIN_NOT_PREPARED: "请先在球球准备任务同步连接。",
  PLUGIN_CONTENT_MISMATCH: "插件安装内容与已审查版本不一致，未安装。",
  PLUGIN_CONFLICT: "发现同名插件或市场内容冲突，未覆盖原有内容。",
  CONCURRENT_MODIFICATION: "原工具配置正在变化，已停止安装，请稍后重试。",
  ROLLBACK_INCOMPLETE:
    "安装未完成，部分配置在处理中被其他程序更改，已保留这些更改。",
  INSTALL_IO_FAILED: "插件安装未完成，请检查目录权限后重试。",
});
const fail = (code) => Object.assign(new Error(code), { code });
const hash = (b) => createHash("sha256").update(b).digest("hex");
const record = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
function abort(signal) {
  if (signal?.aborted) throw fail("CANCELLED");
}
function beneath(root, file) {
  const rel = path.relative(root, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw fail("UNSAFE_PATH");
  return rel;
}
function safePath(root, file, { missing = true } = {}) {
  beneath(root, file);
  let at = root;
  for (const part of [
    "",
    ...path.relative(root, file).split(path.sep).filter(Boolean),
  ]) {
    if (part) at = path.join(at, part);
    try {
      const stat = fs.lstatSync(at);
      if (stat.isSymbolicLink()) throw fail("UNSAFE_PATH");
      if (at !== file && !stat.isDirectory()) throw fail("UNSAFE_PATH");
    } catch (e) {
      if (e.code === "ENOENT" && missing) return;
      if (e.code === "ENOENT") throw fail("MISSING_PLUGIN_FILE");
      throw e;
    }
  }
}
function mkdir(root, dir, created) {
  safePath(root, dir);
  let at = root;
  for (const part of path.relative(root, dir).split(path.sep).filter(Boolean)) {
    at = path.join(at, part);
    try {
      const stat = fs.lstatSync(at);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw fail("UNSAFE_PATH");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      fs.mkdirSync(at, { mode: 0o700 });
      created?.push(at);
    }
  }
}
function read(root, file, max = MAX_JSON) {
  safePath(root, file);
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const s = fs.fstatSync(fd);
    if (!s.isFile() || s.size > max) throw fail("UNSUPPORTED_FILE");
    const bytes = fs.readFileSync(fd);
    return { bytes, hash: hash(bytes), mode: s.mode & 0o777 };
  } catch (e) {
    if (e.code === "ENOENT") return { bytes: null, hash: null, mode: 0o600 };
    throw e;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
// Strict JSON parser with source spans: preserve every unrelated raw value,
// including formatting and large integer literals; never JSON-round-trip config.
function parse(text) {
  let i = 0;
  const ws = () => {
    while (/[\t\n\r ]/.test(text[i] || "!")) i++;
  };
  function str() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '"') {
        i++;
        try {
          return JSON.parse(text.slice(start, i));
        } catch {
          throw fail("INVALID_JSON");
        }
      }
      if (text[i] === "\\") i += 2;
      else i++;
    }
    throw fail("INVALID_JSON");
  }
  function node(depth = 0) {
    if (depth > 64) throw fail("INVALID_JSON");
    ws();
    const start = i,
      c = text[i];
    if (c === "{") {
      i++;
      ws();
      const props = [];
      const keys = new Set();
      if (text[i] !== "}")
        for (;;) {
          if (text[i] !== '"') throw fail("INVALID_JSON");
          const key = str();
          if (keys.has(key)) throw fail("INVALID_JSON");
          keys.add(key);
          ws();
          if (text[i++] !== ":") throw fail("INVALID_JSON");
          const value = node(depth + 1);
          props.push({ key, value });
          ws();
          if (text[i] !== ",") break;
          i++;
          ws();
        }
      if (text[i++] !== "}") throw fail("INVALID_JSON");
      return { kind: "object", start, end: i, props };
    }
    if (c === "[") {
      i++;
      ws();
      const items = [];
      if (text[i] !== "]")
        for (;;) {
          items.push(node(depth + 1));
          ws();
          if (text[i] !== ",") break;
          i++;
        }
      if (text[i++] !== "]") throw fail("INVALID_JSON");
      return { kind: "array", start, end: i, items };
    }
    if (c === '"') {
      str();
      return { kind: "value", start, end: i };
    }
    const match =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(i),
      );
    if (!match) throw fail("INVALID_JSON");
    i += match[0].length;
    return { kind: "value", start, end: i };
  }
  const tree = node();
  ws();
  if (i !== text.length || tree.kind !== "object") throw fail("INVALID_JSON");
  return tree;
}
function value(text, node) {
  return JSON.parse(text.slice(node.start, node.end));
}
function at(tree, keys) {
  let n = tree;
  for (const key of keys) {
    if (n.kind !== "object") throw fail("UNSUPPORTED_SCHEMA");
    n = n.props.find((p) => p.key === key)?.value;
    if (!n) return null;
  }
  return n;
}
function set(text, keys, newValue) {
  const tree = parse(text),
    encoded = JSON.stringify(newValue);
  function walk(n, index) {
    if (n.kind !== "object") throw fail("UNSUPPORTED_SCHEMA");
    const key = keys[index],
      p = n.props.find((p) => p.key === key);
    if (p) {
      if (index === keys.length - 1)
        return text.slice(0, p.value.start) + encoded + text.slice(p.value.end);
      return walk(p.value, index + 1);
    }
    let raw = encoded;
    for (let j = keys.length - 1; j > index; j--)
      raw = "{" + JSON.stringify(keys[j]) + ":" + raw + "}";
    const addition =
      (n.props.length ? "," : "") +
      "\n  " +
      JSON.stringify(key) +
      ": " +
      raw +
      "\n";
    return text.slice(0, n.end - 1) + addition + text.slice(n.end - 1);
  }
  return walk(tree, 0);
}
function append(text, arrayPath, item) {
  const n = at(parse(text), arrayPath);
  if (!n || n.kind !== "array") throw fail("UNSUPPORTED_SCHEMA");
  return (
    text.slice(0, n.end - 1) +
    (n.items.length ? "," : "") +
    "\n" +
    JSON.stringify(item) +
    "\n" +
    text.slice(n.end - 1)
  );
}
function validateReceiver(bytes, provider) {
  let c;
  try {
    c = JSON.parse(bytes);
  } catch {
    throw fail("INVALID_RECEIVER");
  }
  if (
    !record(c) ||
    Object.keys(c).some(
      (k) => !["version", "enabled", "endpoint", "token"].includes(k),
    ) ||
    c.version !== 1 ||
    c.enabled !== true ||
    typeof c.token !== "string" ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(c.token)
  )
    throw fail("INVALID_RECEIVER");
  let u;
  try {
    u = new URL(c.endpoint);
  } catch {
    throw fail("INVALID_RECEIVER");
  }
  if (
    u.protocol !== "http:" ||
    u.hostname !== "127.0.0.1" ||
    u.pathname !== "/" + provider + "/events" ||
    !/^\d+$/.test(u.port) ||
    +u.port < 1024 ||
    +u.port > 65535 ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw fail("INVALID_RECEIVER");
  return c;
}
function filesIn(root) {
  const list = [];
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw fail("UNSAFE_PATH");
      if (entry.isDirectory()) scan(file);
      else if (entry.isFile()) list.push(path.relative(root, file));
      else throw fail("UNSAFE_PATH");
    }
  }
  scan(root);
  return list.sort();
}
function sourcePackage(source, spec, provider) {
  if (!path.isAbsolute(source || "")) throw fail("PLUGIN_NOT_PREPARED");
  safePath(source, source, { missing: false });
  const all = new Map(),
    pluginPrefix = "plugins/" + spec.name + "/";
  for (const [rel, digest] of Object.entries(spec.hashes)) {
    const sourceRel = rel === spec.manifest ? rel : pluginPrefix + rel;
    const snap = read(source, path.join(source, sourceRel), MAX_ASSET);
    if (!snap.bytes || snap.hash !== digest)
      throw fail("PLUGIN_CONTENT_MISMATCH");
    all.set(sourceRel, snap.bytes);
  }
  const receiverRel = pluginPrefix + "receiver.json",
    receiver = read(source, path.join(source, receiverRel), 8192);
  if (!receiver.bytes) throw fail("PLUGIN_NOT_PREPARED");
  validateReceiver(receiver.bytes, provider);
  all.set(receiverRel, receiver.bytes);
  const names = filesIn(source);
  if (names.length !== all.size || names.some((k) => !all.has(k)))
    throw fail("PLUGIN_CONTENT_MISMATCH");
  const manifest = JSON.parse(all.get(spec.manifest));
  const pluginManifest = JSON.parse(
    all.get(pluginPrefix + spec.pluginManifest),
  );
  if (
    manifest.name !== spec.market ||
    manifest.plugins?.length !== 1 ||
    manifest.plugins[0].name !== spec.name ||
    pluginManifest.name !== spec.name ||
    pluginManifest.version !== spec.version
  )
    throw fail("PLUGIN_CONTENT_MISMATCH");
  return all;
}
function metadata(root, spec, source, marketRoot, cacheRoot, now) {
  const storage = path.join(root, spec.storage),
    id = spec.name + "@" + spec.market,
    knownFile = path.join(storage, "known_marketplaces.json"),
    installedFile = path.join(storage, "installed_plugins.json"),
    configFile = path.join(root, spec.config);
  const known = read(root, knownFile),
    installed = read(root, installedFile),
    config = read(root, configFile);
  let kt =
      known.bytes?.toString("utf8") ||
      (spec === SPECS.zcode ? '{"version":1,"marketplaces":[]}' : "{}"),
    it =
      installed.bytes?.toString("utf8") ||
      (spec === SPECS.zcode
        ? '{"version":1,"plugins":[]}'
        : '{"version":2,"plugins":{}}'),
    ct = config.bytes?.toString("utf8") || "{}";
  let k = parse(kt),
    ins = parse(it);
  parse(ct);
  const isZ = spec === SPECS.zcode,
    clock = new Date(now()).toISOString();
  let ownKnown, ownInstalled, knownNode;
  if (isZ) {
    if (
      value(kt, at(k, ["version"]) || {}) !== 1 ||
      at(k, ["marketplaces"])?.kind !== "array" ||
      value(it, at(ins, ["version"]) || {}) !== 1 ||
      at(ins, ["plugins"])?.kind !== "array"
    )
      throw fail("UNSUPPORTED_SCHEMA");
    const found = at(k, ["marketplaces"]).items.filter(
      (n) => value(kt, n)?.id === spec.market,
    );
    if (found.length > 1) throw fail("PLUGIN_CONFLICT");
    knownNode = found[0];
    ownKnown = knownNode && value(kt, knownNode);
    const rows = at(ins, ["plugins"]).items.filter(
      (n) => value(it, n)?.id === id,
    );
    if (rows.length > 1) throw fail("PLUGIN_CONFLICT");
    ownInstalled = rows[0] && value(it, rows[0]);
  } else {
    if (
      at(k, ["version"]) ||
      value(it, at(ins, ["version"]) || {}) !== 2 ||
      at(ins, ["plugins"])?.kind !== "object"
    )
      throw fail("UNSUPPORTED_SCHEMA");
    const kn = at(k, [spec.market]),
      ip = at(ins, ["plugins", id]);
    knownNode = kn;
    ownKnown = kn && value(kt, kn);
    if (ip) {
      const rows = value(it, ip);
      if (!Array.isArray(rows) || rows.length !== 1)
        throw fail("PLUGIN_CONFLICT");
      ownInstalled = rows[0];
    }
  }
  const allowedSource = (entry) =>
    record(entry) &&
    entry.source?.source === "directory" &&
    [source, marketRoot].includes(entry.source.path) &&
    (!entry.installLocation ||
      [source, marketRoot].includes(entry.installLocation));
  if (ownKnown && !allowedSource(ownKnown)) throw fail("PLUGIN_CONFLICT");
  if (
    ownInstalled &&
    (!record(ownInstalled) ||
      ownInstalled.scope !== "user" ||
      ownInstalled.version !== spec.version ||
      ownInstalled.installPath !== cacheRoot ||
      (isZ &&
        (ownInstalled.id !== id ||
          ownInstalled.name !== spec.name ||
          ownInstalled.marketplace !== spec.market)))
  )
    throw fail("PLUGIN_CONFLICT");
  if (!ownKnown) {
    const base = {
      source: { source: "directory", path: marketRoot },
      lastUpdated: clock,
    };
    kt = isZ
      ? append(kt, ["marketplaces"], {
          id: spec.market,
          name: spec.market,
          ...base,
          addedAt: clock,
          pluginCount: 1,
        })
      : set(kt, [spec.market], {
          manifestName: spec.market,
          type: "directory",
          ...base,
          installLocation: marketRoot,
          autoUpdate: false,
        });
  }
  if (ownKnown && ownKnown.source.path !== marketRoot) {
    const migrated = {
      ...ownKnown,
      source: { source: "directory", path: marketRoot },
      ...(!isZ ? { installLocation: marketRoot } : {}),
    };
    kt =
      kt.slice(0, knownNode.start) +
      JSON.stringify(migrated) +
      kt.slice(knownNode.end);
  }
  if (!ownInstalled) {
    const row = {
      scope: "user",
      installPath: cacheRoot,
      version: spec.version,
      installedAt: clock,
    };
    it = isZ
      ? append(it, ["plugins"], {
          id,
          name: spec.name,
          marketplace: spec.market,
          ...row,
          updatedAt: clock,
          source: "./plugins/" + spec.name,
        })
      : set(it, ["plugins", id], [{ ...row, lastUpdated: clock }]);
  }
  const enabledPath = isZ
      ? ["plugins", "enabledPlugins", id]
      : ["enabledPlugins", id],
    en = at(parse(ct), enabledPath);
  if (en && typeof value(ct, en) !== "boolean")
    throw fail("UNSUPPORTED_SCHEMA");
  const enabled = en ? value(ct, en) : false;
  ct = set(ct, enabledPath, true);
  return {
    plans: [
      { file: knownFile, before: known, after: Buffer.from(kt) },
      { file: installedFile, before: installed, after: Buffer.from(it) },
      { file: configFile, before: config, after: Buffer.from(ct) },
    ],
    registered: Boolean(ownKnown && ownInstalled),
    enabled,
  };
}
function createManagedPluginInstaller({
  provider,
  directoryAccess,
  getMarketplaceDirectory,
  assertHostStopped,
  now = Date.now,
  onChange = () => {},
} = {}) {
  const spec = Object.hasOwn(SPECS, provider) ? SPECS[provider] : null;
  if (
    !spec ||
    typeof directoryAccess?.withAccess !== "function" ||
    typeof getMarketplaceDirectory !== "function" ||
    typeof assertHostStopped !== "function"
  )
    throw fail("INVALID_INSTALLER_OPTIONS");
  let flight = null;
  let state = {
    provider,
    status: "idle",
    installedConfigured: false,
    enabled: false,
    eventVerified: false,
    requiresNewSession: true,
    code: null,
    message: "尚未检查任务插件安装状态。",
  };
  function update(patch) {
    const message = patch.code
      ? MESSAGES[patch.code] || MESSAGES.INSTALL_IO_FAILED
      : patch.status === "installed-configured"
        ? "球球任务插件已安装启用，请在原工具新建任务；收到事件后确认联动。"
        : patch.status === "not-installed"
          ? "任务插件尚未完成安装，可在球球继续。"
          : ["working", "staged", "committing"].includes(patch.status)
            ? "正在安装球球任务插件…"
            : state.message;
    state = { ...state, ...patch, message };
    try {
      onChange({ ...state });
    } catch {}
  }
  const getState = () => ({ ...state });
  function context(root) {
    if (!path.isAbsolute(root || "") || path.basename(root) !== "." + provider)
      throw fail("UNSAFE_PATH");
    safePath(root, root, { missing: false });
    const source = getMarketplaceDirectory();
    const assets = sourcePackage(source, spec, provider);
    const storage = path.join(root, spec.storage),
      marketRoot = path.join(storage, "qiuqiu-managed-sources", spec.market),
      catalogRoot = path.join(storage, "marketplaces", spec.market),
      cacheRoot = path.join(
        storage,
        "cache",
        spec.market,
        spec.name,
        spec.version,
      );
    return { root, source, assets, marketRoot, catalogRoot, cacheRoot };
  }
  function treePlan(ctx, dir, files) {
    safePath(ctx.root, dir);
    const desired = new Map(files);
    const existing = fs.existsSync(dir);
    if (!existing) return { dir, files: desired, existing: false };
    const actual = filesIn(dir);
    if (
      actual.length !== desired.size ||
      actual.some((file) => !desired.has(file))
    )
      throw fail("PLUGIN_CONFLICT");
    const before = new Map();
    for (const [rel, bytes] of desired) {
      const snap = read(ctx.root, path.join(dir, rel), MAX_ASSET);
      if (rel.endsWith("receiver.json")) validateReceiver(snap.bytes, provider);
      else if (!snap.bytes?.equals(bytes)) throw fail("PLUGIN_CONFLICT");
      before.set(rel, snap);
    }
    return { dir, files: desired, existing: true, before };
  }
  function sourceUnchanged(ctx) {
    const current = sourcePackage(ctx.source, spec, provider);
    if (
      current.size !== ctx.assets.size ||
      [...current].some(([file, bytes]) => !ctx.assets.get(file)?.equals(bytes))
    )
      throw fail("CONCURRENT_MODIFICATION");
  }
  function prepare(ctx) {
    const pluginPrefix = "plugins/" + spec.name + "/";
    const marketFiles = new Map(ctx.assets);
    marketFiles.set("marketplace.json", ctx.assets.get(spec.manifest));
    const trees = [
      treePlan(ctx, ctx.marketRoot, ctx.assets),
      ...(provider === "zcode"
        ? [treePlan(ctx, ctx.catalogRoot, marketFiles)]
        : []),
      treePlan(
        ctx,
        ctx.cacheRoot,
        [...ctx.assets]
          .filter(([rel]) => rel.startsWith(pluginPrefix))
          .map(([rel, b]) => [rel.slice(pluginPrefix.length), b]),
      ),
    ];
    return {
      trees,
      ...metadata(
        ctx.root,
        spec,
        ctx.source,
        ctx.marketRoot,
        ctx.cacheRoot,
        now,
      ),
    };
  }
  function unchanged(root, file, snapshot) {
    const current = read(root, file);
    if (current.hash !== snapshot.hash) throw fail("CONCURRENT_MODIFICATION");
  }
  function treesUnchanged(ctx, trees) {
    for (const tree of trees) {
      safePath(ctx.root, tree.dir);
      if (!tree.existing) {
        if (fs.existsSync(tree.dir)) throw fail("CONCURRENT_MODIFICATION");
        continue;
      }
      if (
        filesIn(tree.dir).join("\0") !==
        [...tree.files.keys()].sort().join("\0")
      )
        throw fail("CONCURRENT_MODIFICATION");
      for (const [rel, snapshot] of tree.before)
        unchanged(ctx.root, path.join(tree.dir, rel), snapshot);
    }
  }
  function configured(prepared) {
    return (
      prepared.registered &&
      prepared.enabled &&
      prepared.plans.every((p) => p.before.bytes?.equals(p.after)) &&
      prepared.trees.every(
        (t) =>
          t.existing &&
          [...t.files].every(([rel, b]) => t.before.get(rel).bytes.equals(b)),
      )
    );
  }
  async function inspect() {
    if (flight) return getState();
    try {
      return await directoryAccess.withAccess(provider, async (root) => {
        const ctx = context(root),
          prepared = prepare(ctx),
          ready = configured(prepared);
        update({
          status: ready ? "installed-configured" : "not-installed",
          installedConfigured: ready,
          enabled: prepared.enabled,
          code: null,
        });
        return getState();
      });
    } catch (e) {
      update({
        status:
          e.code === "DIRECTORY_ACCESS_REQUIRED"
            ? "needs-authorization"
            : "unavailable",
        installedConfigured: false,
        enabled: false,
        code: safeCode(e),
      });
      return getState();
    }
  }
  const knownCodes = new Set([
    "DIRECTORY_ACCESS_REQUIRED",
    "CANCELLED",
    "CONSENT_REQUIRED",
    "INSTALL_BUSY",
    "HOST_RUNNING",
    "PLATFORM_UNSUPPORTED",
    "UNSAFE_PATH",
    "MISSING_PLUGIN_FILE",
    "UNSUPPORTED_FILE",
    "INVALID_JSON",
    "UNSUPPORTED_SCHEMA",
    "INVALID_RECEIVER",
    "PLUGIN_NOT_PREPARED",
    "PLUGIN_CONTENT_MISMATCH",
    "PLUGIN_CONFLICT",
    "CONCURRENT_MODIFICATION",
    "ROLLBACK_INCOMPLETE",
  ]);
  function safeCode(e) {
    return knownCodes.has(e?.code) ? e.code : "INSTALL_IO_FAILED";
  }
  function install({ approved = false, signal } = {}) {
    if (approved !== true) return Promise.reject(fail("CONSENT_REQUIRED"));
    if (flight) return Promise.reject(fail("INSTALL_BUSY"));
    const run = Promise.resolve()
      .then(async () => {
        abort(signal);
        if (process.platform !== "darwin") throw fail("PLATFORM_UNSUPPORTED");
        const stopped = async () => {
          abort(signal);
          const allowed = await assertHostStopped(provider);
          abort(signal);
          if (allowed !== true) throw fail("HOST_RUNNING");
        };
        update({ status: "working", installedConfigured: false, code: null });
        return directoryAccess.withAccess(provider, async (root) => {
          abort(signal);
          const ctx = context(root),
            created = [],
            committed = [];
          let stage, lock, lockFd;
          try {
            lock = path.join(
              root,
              ".qiuqiu-" + provider + "-plugin-install.lock",
            );
            safePath(root, lock);
            try {
              lockFd = fs.openSync(
                lock,
                fs.constants.O_RDWR |
                  fs.constants.O_CREAT |
                  fs.constants.O_NOFOLLOW |
                  fs.constants.O_NONBLOCK |
                  0x20,
                0o600,
              );
              if (!fs.fstatSync(lockFd).isFile()) throw fail("UNSAFE_PATH");
            } catch (e) {
              if (["EAGAIN", "EWOULDBLOCK"].includes(e.code))
                throw fail("INSTALL_BUSY");
              throw e;
            }
            await stopped();
            sourceUnchanged(ctx);
            safePath(root, root, { missing: false });
            const prepared = prepare(ctx);
            if (configured(prepared)) {
              update({
                status: "installed-configured",
                installedConfigured: true,
                enabled: true,
                code: null,
              });
              return getState();
            }
            stage = path.join(root, ".qiuqiu-plugin-stage-" + randomUUID());
            fs.mkdirSync(stage, { mode: 0o700 });
            const files = [];
            let serial = 0;
            for (const tree of prepared.trees) {
              if (!tree.existing) {
                const staged = path.join(stage, "tree-" + serial++);
                fs.mkdirSync(staged, { mode: 0o700 });
                for (const [rel, bytes] of tree.files) {
                  const target = path.join(staged, rel);
                  mkdir(stage, path.dirname(target));
                  fs.writeFileSync(target, bytes, {
                    mode: rel.endsWith(".sh") ? 0o700 : 0o600,
                    flag: "wx",
                  });
                }
                files.push({ kind: "tree", file: tree.dir, staged, tree });
              } else
                for (const [rel, bytes] of tree.files) {
                  const before = tree.before.get(rel);
                  if (!before.bytes.equals(bytes))
                    files.push({
                      kind: "file",
                      file: path.join(tree.dir, rel),
                      before,
                      after: bytes,
                    });
                }
            }
            for (const p of prepared.plans)
              if (!p.before.bytes?.equals(p.after))
                files.push({ kind: "file", ...p });
            for (const f of files)
              if (f.kind === "file") {
                f.staged = path.join(stage, "file-" + serial++);
                fs.writeFileSync(f.staged, f.after, {
                  mode: f.before.mode || 0o600,
                  flag: "wx",
                });
              }
            abort(signal);
            update({ status: "staged" });
            abort(signal);
            treesUnchanged(ctx, prepared.trees);
            for (const p of prepared.plans) unchanged(root, p.file, p.before);
            for (let index = 0; index < files.length; index++) {
              const f = files[index];
              update({ status: "committing", fileIndex: index });
              abort(signal);
              await stopped();
              sourceUnchanged(ctx);
              safePath(root, f.file);
              if (f.kind === "tree") {
                if (fs.existsSync(f.file))
                  throw fail("CONCURRENT_MODIFICATION");
              } else unchanged(root, f.file, f.before);
              mkdir(root, path.dirname(f.file), created);
              fs.renameSync(f.staged, f.file);
              committed.push(f);
              abort(signal);
            }
            for (const f of files) {
              if (f.kind === "file") {
                if (read(root, f.file).hash !== hash(f.after))
                  throw fail("CONCURRENT_MODIFICATION");
              } else {
                const expected = [...f.tree.files.keys()].sort();
                if (filesIn(f.file).join("\0") !== expected.join("\0"))
                  throw fail("CONCURRENT_MODIFICATION");
                for (const [rel, b] of f.tree.files)
                  if (read(root, path.join(f.file, rel)).hash !== hash(b))
                    throw fail("CONCURRENT_MODIFICATION");
              }
            }
            abort(signal);
            update({
              status: "installed-configured",
              installedConfigured: true,
              enabled: true,
              code: null,
              fileIndex: undefined,
            });
            return getState();
          } catch (e) {
            let incomplete = false;
            for (const f of committed.reverse()) {
              try {
                safePath(root, f.file);
                if (f.kind === "tree") {
                  const same =
                    filesIn(f.file).join("\0") ===
                      [...f.tree.files.keys()].sort().join("\0") &&
                    [...f.tree.files].every(
                      ([rel, b]) =>
                        read(root, path.join(f.file, rel)).hash === hash(b),
                    );
                  if (same) fs.rmSync(f.file, { recursive: true });
                  else incomplete = true;
                } else if (read(root, f.file).hash === hash(f.after)) {
                  if (f.before.bytes) {
                    const backup = path.join(stage, "rollback-" + randomUUID());
                    fs.writeFileSync(backup, f.before.bytes, {
                      mode: f.before.mode || 0o600,
                      flag: "wx",
                    });
                    fs.renameSync(backup, f.file);
                  } else fs.unlinkSync(f.file);
                } else incomplete = true;
              } catch {
                incomplete = true;
              }
            }
            for (const dir of created.reverse())
              try {
                fs.rmdirSync(dir);
              } catch {}
            if (incomplete) throw fail("ROLLBACK_INCOMPLETE");
            throw e;
          } finally {
            if (stage)
              try {
                fs.rmSync(stage, { recursive: true, force: true });
              } catch {}
            if (lockFd !== undefined)
              try {
                fs.closeSync(lockFd);
              } catch {}
          }
        });
      })
      .catch((e) => {
        const code = safeCode(e);
        update({
          status: code === "CANCELLED" ? "cancelled" : "unavailable",
          installedConfigured: false,
          enabled: false,
          code,
          fileIndex: undefined,
        });
        throw fail(code);
      })
      .finally(() => {
        if (flight === run) flight = null;
      });
    flight = run;
    return run;
  }
  return { install, inspect, getState };
}
module.exports = { createManagedPluginInstaller };
