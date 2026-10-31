const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const {
  createManagedPluginInstaller,
} = require("../lib/managed-plugin-installer");
const specs = {
  workbuddy: {
    root: "plugins",
    config: "settings.json",
    market: "qiuqiu-local-review",
    name: "qiuqiu-task-events",
    version: "0.2.0",
    manifest: ".codebuddy-plugin/marketplace.json",
  },
  zcode: {
    root: "cli/plugins",
    config: "cli/config.json",
    market: "qiuqiu-zcode-local-review",
    name: "qiuqiu-zcode-task-events",
    version: "0.1.0",
    manifest: ".claude-plugin/marketplace.json",
  },
};
function fixture(t, provider = "workbuddy", onChange = () => {}) {
  const base = fs.mkdtempSync(
      path.join(os.tmpdir(), "qiuqiu-offline-install-"),
    ),
    root = path.join(base, "." + provider),
    source = path.join(base, "owned-market");
  fs.mkdirSync(root);
  fs.mkdirSync(source);
  const { FILES } = require("../lib/" + provider + "-desktop-integration");
  for (const rel of FILES) {
    const dest = path.join(source, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, "../assets/" + provider + "-desktop-hook", rel),
      dest,
    );
  }
  const spec = specs[provider],
    receiver = path.join(source, "plugins", spec.name, "receiver.json");
  fs.writeFileSync(
    receiver,
    JSON.stringify({
      version: 1,
      enabled: true,
      endpoint: "http://127.0.0.1:45678/" + provider + "/events",
      token: "synthetic_capability_not_a_real_token_0123456789",
    }),
  );
  let grants = 0;
  const app = createManagedPluginInstaller({
    provider,
    directoryAccess: {
      withAccess: async (p, fn) => {
        assert.equal(p, provider);
        grants++;
        return fn(root);
      },
    },
    getMarketplaceDirectory: () => source,
    assertHostStopped: () => true,
    now: () => 1000000,
    onChange,
  });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const storage = path.join(root, spec.root),
    config = path.join(root, spec.config),
    id = spec.name + "@" + spec.market;
  return {
    base,
    root,
    source,
    spec,
    receiver,
    storage,
    config,
    id,
    app,
    grants: () => grants,
  };
}
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function inventory(f) {
  return {
    known: path.join(f.storage, "known_marketplaces.json"),
    installed: path.join(f.storage, "installed_plugins.json"),
    cache: path.join(
      f.storage,
      "cache",
      f.spec.market,
      f.spec.name,
      f.spec.version,
    ),
    market: path.join(f.storage, "qiuqiu-managed-sources", f.spec.market),
  };
}
function tree(root) {
  const out = {};
  function scan(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.name.endsWith("-plugin-install.lock")) continue;
      if (e.isDirectory()) scan(p);
      else if (e.isSymbolicLink()) out[path.relative(root, p)] = "symlink";
      else
        out[path.relative(root, p)] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(p))
          .digest("hex");
    }
  }
  scan(root);
  return out;
}
test("constructor and refused consent have no IO or arbitrary plugin interface", async (t) => {
  const f = fixture(t);
  assert.equal(f.grants(), 0);
  assert.deepEqual(fs.readdirSync(f.root), []);
  await assert.rejects(f.app.install(), { code: "CONSENT_REQUIRED" });
  assert.equal(f.grants(), 0);
  assert.throws(() => createManagedPluginInstaller({ provider: "other" }), {
    code: "INVALID_INSTALLER_OPTIONS",
  });
});
for (const provider of ["workbuddy", "zcode"])
  test(
    provider +
      " offline install preserves unrelated raw settings and inventory; idempotent and no token state",
    async (t) => {
      const f = fixture(t, provider),
        p = inventory(f);
      const cfg =
        provider === "workbuddy"
          ? '{"privateOtherSetting":{"integer":9007199254740993123,"raw":"\\u4f60"},"enabledPlugins":{"other@market":false}}'
          : '{"privateOtherSetting":{"integer":9007199254740993123,"raw":"\\u4f60"},"plugins":{"enabledPlugins":{"other@market":false},"otherPluginOption":"keep"}}';
      write(f.config, cfg);
      write(
        p.known,
        provider === "workbuddy"
          ? '{"other-market":{"type":"github","source":{"source":"github","repo":"do/not-fetch"}}}'
          : '{"version":1,"marketplaces":[{"id":"other-market","source":{"source":"github","repo":"do/not-fetch"}}]}',
      );
      write(
        p.installed,
        provider === "workbuddy"
          ? '{"version":2,"plugins":{"other@market":[{"scope":"user","installPath":"/do/not/read","version":"other"}]}}'
          : '{"version":1,"plugins":[{"id":"other@market","installPath":"/do/not/read","scope":"user","version":"other"}]}',
      );
      const result = await f.app.install({ approved: true });
      assert.equal(result.status, "installed-configured");
      assert.equal(result.eventVerified, false);
      assert.equal(result.requiresNewSession, true);
      assert.equal(
        JSON.stringify(result).includes("synthetic_capability"),
        false,
      );
      assert.equal(JSON.stringify(result).includes(f.root), false);
      const next = fs.readFileSync(f.config, "utf8");
      assert.ok(next.includes('"integer":9007199254740993123,"raw":"\\u4f60"'));
      assert.ok(next.includes('"other@market":false'));
      assert.ok(fs.readFileSync(p.installed, "utf8").includes("/do/not/read"));
      assert.ok(fs.readFileSync(p.known, "utf8").includes("do/not-fetch"));
      const state = await f.app.inspect();
      assert.equal(state.installedConfigured, true);
      assert.equal(state.eventVerified, false);
      const before = tree(f.root);
      await f.app.install({ approved: true });
      assert.deepEqual(tree(f.root), before);
      assert.equal(
        fs.statSync(path.join(p.cache, "receiver.json")).mode & 0o777,
        0o600,
      );
    },
  );
for (const provider of ["workbuddy", "zcode"])
  test(
    provider +
      " disabled plugin is enabled only after explicit consent and others preserved",
    async (t) => {
      const f = fixture(t, provider);
      await f.app.install({ approved: true });
      let cfg = fs
        .readFileSync(f.config, "utf8")
        .replace(
          JSON.stringify(f.id) + ":true",
          JSON.stringify(f.id) + ":false",
        );
      fs.writeFileSync(f.config, cfg);
      assert.equal((await f.app.inspect()).enabled, false);
      await assert.rejects(f.app.install({ approved: false }), {
        code: "CONSENT_REQUIRED",
      });
      assert.equal(fs.readFileSync(f.config, "utf8"), cfg);
      await f.app.install({ approved: true });
      assert.equal((await f.app.inspect()).enabled, true);
    },
  );
test("fixed source content, no remote source, and receiver schema are required before writing", async (t) => {
  for (const kind of ["script", "manifest", "receiver"]) {
    const f = fixture(t);
    const file =
      kind === "script"
        ? path.join(
            f.source,
            "plugins",
            f.spec.name,
            "scripts/emit-metadata.sh",
          )
        : kind === "manifest"
          ? path.join(f.source, f.spec.manifest)
          : f.receiver;
    fs.writeFileSync(
      file,
      kind === "receiver"
        ? JSON.stringify({
            version: 1,
            enabled: true,
            endpoint: "https://remote.invalid/events",
            token: "abc",
          })
        : "unreviewed source",
    );
    await assert.rejects(f.app.install({ approved: true }));
    assert.deepEqual(fs.readdirSync(f.root), []);
  }
});
test("symlinked destination ancestor, own cache content and foreign same-name source fail closed", async (t) => {
  const f = fixture(t);
  const out = path.join(f.base, "outside");
  fs.mkdirSync(out);
  fs.symlinkSync(out, path.join(f.root, "plugins"));
  await assert.rejects(f.app.install({ approved: true }), {
    code: "UNSAFE_PATH",
  });
  assert.deepEqual(fs.readdirSync(out), []);
  const g = fixture(t);
  await g.app.install({ approved: true });
  const p = inventory(g),
    script = path.join(p.cache, "scripts/emit-metadata.sh");
  fs.writeFileSync(script, "foreign");
  const before = tree(g.root);
  await assert.rejects(g.app.install({ approved: true }), {
    code: "PLUGIN_CONFLICT",
  });
  assert.deepEqual(tree(g.root), before);
  const h = fixture(t);
  write(
    inventory(h).known,
    JSON.stringify({
      [h.spec.market]: { source: { source: "directory", path: "/foreign" } },
    }),
  );
  await assert.rejects(h.app.install({ approved: true }), {
    code: "PLUGIN_CONFLICT",
  });
});
test("corrupt, duplicate-key and unsupported inventory versions are not repaired or overwritten", async (t) => {
  for (const text of [
    "{",
    '{"version":1,"plugins":{}}',
    '{"version":2,"version":2,"plugins":{}}',
  ]) {
    const f = fixture(t),
      file = inventory(f).installed;
    write(file, text);
    const before = tree(f.root);
    await assert.rejects(f.app.install({ approved: true }));
    assert.deepEqual(tree(f.root), before);
  }
});
test("stage-time concurrent settings change is kept and no installation is committed", async (t) => {
  let f;
  f = fixture(t, "workbuddy", (s) => {
    if (s.status === "staged") write(f.config, '{"concurrent":"keep"}');
  });
  write(f.config, '{"before":true}');
  await assert.rejects(f.app.install({ approved: true }), {
    code: "CONCURRENT_MODIFICATION",
  });
  assert.equal(fs.readFileSync(f.config, "utf8"), '{"concurrent":"keep"}');
  assert.equal(fs.existsSync(inventory(f).installed), false);
  assert.equal(fs.existsSync(inventory(f).cache), false);
});
test("late conflict rolls back only our writes, keeps concurrent metadata and original config", async (t) => {
  let f;
  f = fixture(t, "workbuddy", (s) => {
    if (s.status === "committing" && s.fileIndex === 3)
      write(f.config, '{"concurrent":"keep"}');
  });
  write(f.config, '{"before":true}');
  await assert.rejects(f.app.install({ approved: true }), {
    code: "CONCURRENT_MODIFICATION",
  });
  assert.equal(fs.readFileSync(f.config, "utf8"), '{"concurrent":"keep"}');
  assert.equal(fs.existsSync(inventory(f).known), false);
  assert.equal(fs.existsSync(inventory(f).cache), false);
});
test("abort during commit rolls back packages and metadata, and is not installed", async (t) => {
  const controller = new AbortController();
  const f = fixture(t, "zcode", (s) => {
    if (s.status === "committing" && s.fileIndex === 2) controller.abort();
  });
  write(f.config, '{"before":"preserve"}');
  await assert.rejects(
    f.app.install({ approved: true, signal: controller.signal }),
    { code: "CANCELLED" },
  );
  assert.equal(f.app.getState().installedConfigured, false);
  assert.equal(fs.readFileSync(f.config, "utf8"), '{"before":"preserve"}');
  assert.equal(fs.existsSync(inventory(f).cache), false);
  assert.equal(fs.existsSync(inventory(f).known), false);
});
for (const provider of ["workbuddy", "zcode"])
  test(
    provider +
      " native manual source migrates only our reviewed source and preserves foreign rows",
    async (t) => {
      const f = fixture(t, provider);
      await f.app.install({ approved: true });
      const p = inventory(f);
      let known = JSON.parse(fs.readFileSync(p.known, "utf8"));
      if (provider === "workbuddy") {
        known[f.spec.market].source.path = f.source;
        known[f.spec.market].installLocation = f.source;
        known["other"] = { doNotTouch: true };
      } else {
        known.marketplaces[0].source.path = f.source;
        known.marketplaces.push({ id: "other", doNotTouch: true });
      }
      fs.writeFileSync(p.known, JSON.stringify(known));
      assert.equal((await f.app.inspect()).installedConfigured, false);
      await f.app.install({ approved: true });
      known = JSON.parse(fs.readFileSync(p.known, "utf8"));
      assert.equal(
        provider === "workbuddy"
          ? known[f.spec.market].source.path
          : known.marketplaces[0].source.path,
        p.market,
      );
      assert.equal(
        provider === "workbuddy"
          ? known.other.doNotTouch
          : known.marketplaces[1].doNotTouch,
        true,
      );
      assert.equal(fs.existsSync(f.source), true);
    },
  );
test("private directory grant is mandatory and independent of other directory readers", async () => {
  let sources = 0;
  const app = createManagedPluginInstaller({
    provider: "zcode",
    directoryAccess: {
      withAccess: async () => {
        throw Object.assign(new Error("denied"), {
          code: "DIRECTORY_ACCESS_REQUIRED",
        });
      },
    },
    assertHostStopped: () => true,
    getMarketplaceDirectory: () => {
      sources++;
      throw Error("must not be read");
    },
  });
  assert.equal((await app.inspect()).status, "needs-authorization");
  await assert.rejects(app.install({ approved: true }), {
    code: "DIRECTORY_ACCESS_REQUIRED",
  });
  assert.equal(sources, 0);
});
test("rollback never overwrites a concurrent change made after our commit", async (t) => {
  let f;
  f = fixture(t, "workbuddy", (s) => {
    if (s.status === "committing" && s.fileIndex === 3) {
      write(inventory(f).known, '{"concurrent":"new-owned-market-value"}');
      write(f.config, '{"concurrent":"config"}');
    }
  });
  write(f.config, '{"before":true}');
  await assert.rejects(f.app.install({ approved: true }), {
    code: "ROLLBACK_INCOMPLETE",
  });
  assert.equal(
    fs.readFileSync(inventory(f).known, "utf8"),
    '{"concurrent":"new-owned-market-value"}',
  );
  assert.equal(fs.readFileSync(f.config, "utf8"), '{"concurrent":"config"}');
  assert.equal(f.app.getState().installedConfigured, false);
  assert.equal(JSON.stringify(f.app.getState()).includes(f.root), false);
});
test("symlink introduced just before commit is rejected without writing through it", async (t) => {
  let f;
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "qiuqiu-install-outside-"),
  );
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  f = fixture(t, "zcode", (s) => {
    if (s.status === "staged") {
      fs.mkdirSync(path.join(f.root, "cli"), { recursive: true });
      fs.symlinkSync(outside, path.join(f.root, "cli/plugins"));
    }
  });
  await assert.rejects(f.app.install({ approved: true }), {
    code: "UNSAFE_PATH",
  });
  assert.deepEqual(fs.readdirSync(outside), []);
});
test("all errors and states expose only safe messages, never raw filesystem details", async (t) => {
  const f = fixture(t);
  write(f.config, "{");
  await assert.rejects(f.app.install({ approved: true }), {
    code: "INVALID_JSON",
  });
  const state = f.app.getState();
  assert.equal(state.enabled, false);
  assert.match(state.message, /停止安装/);
  assert.equal(JSON.stringify(state).includes(f.root), false);
  assert.equal(JSON.stringify(state).includes("synthetic_capability"), false);
});

test("prototype names cannot create an arbitrary provider installer", () => {
  for (const provider of ["__proto__", "constructor", "toString"]) {
    assert.throws(
      () =>
        createManagedPluginInstaller({
          provider,
          directoryAccess: { withAccess() {} },
          getMarketplaceDirectory() {},
        }),
      { code: "INVALID_INSTALLER_OPTIONS" },
    );
  }
});
function guarded(f, assertHostStopped, onChange = () => {}) {
  return createManagedPluginInstaller({
    provider: f.spec === specs.workbuddy ? "workbuddy" : "zcode",
    directoryAccess: { withAccess: async (p, fn) => fn(f.root) },
    getMarketplaceDirectory: () => f.source,
    assertHostStopped,
    onChange,
  });
}
test("host stopped guard is mandatory; running host blocks before parsing settings", async (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      createManagedPluginInstaller({
        provider: "workbuddy",
        directoryAccess: { withAccess() {} },
        getMarketplaceDirectory: () => f.source,
      }),
    { code: "INVALID_INSTALLER_OPTIONS" },
  );
  write(f.config, "{invalid-original-config");
  const before = tree(f.root),
    app = guarded(f, () => false);
  await assert.rejects(app.install({ approved: true }), {
    code: "HOST_RUNNING",
  });
  assert.deepEqual(tree(f.root), before);
  assert.match(app.getState().message, /聊天连接保持/);
});
test("host reopening mid-commit causes safe rollback, not installed", async (t) => {
  const f = fixture(t);
  let running = false;
  const app = guarded(
    f,
    () => !running,
    (s) => {
      if (s.status === "committing" && s.fileIndex === 1) running = true;
    },
  );
  write(f.config, '{"original":true}');
  await assert.rejects(app.install({ approved: true }), {
    code: "HOST_RUNNING",
  });
  assert.equal(fs.readFileSync(f.config, "utf8"), '{"original":true}');
  assert.equal(fs.existsSync(inventory(f).cache), false);
  assert.equal(app.getState().installedConfigured, false);
});
test("abort or prepared-source change during async guard is checked before metadata/write", async (t) => {
  const f = fixture(t);
  let release;
  const controller = new AbortController(),
    app = guarded(f, () => new Promise((r) => (release = r)));
  const install = app.install({ approved: true, signal: controller.signal });
  await new Promise((r) => setImmediate(r));
  controller.abort();
  release(true);
  await assert.rejects(install, { code: "CANCELLED" });
  const g = fixture(t);
  let changed = false;
  const app2 = guarded(g, async () => {
    if (!changed) {
      changed = true;
      const c = JSON.parse(fs.readFileSync(g.receiver));
      c.token = "different_synthetic_capability_after_wait_0123456789";
      fs.writeFileSync(g.receiver, JSON.stringify(c));
    }
    return true;
  });
  await assert.rejects(app2.install({ approved: true }), {
    code: "CONCURRENT_MODIFICATION",
  });
  assert.equal(fs.existsSync(inventory(g).installed), false);
});
test("Darwin exclusive nonblocking lock prevents two installers and releases on completion", async (t) => {
  const f = fixture(t);
  let release;
  const first = guarded(f, () => new Promise((r) => (release = r)));
  const pending = first.install({ approved: true });
  await new Promise((r) => setImmediate(r));
  await assert.rejects(f.app.install({ approved: true }), {
    code: "INSTALL_BUSY",
  });
  release(true); // later guard calls also need deterministic success
  let calls = 0; // replace no callback: first guard's promise resolves, next calls use below auto-resolve
  // The first installation has one already resolved guard and more guards; resolve
  // each newly-created guard Promise without timers or inspecting host metadata.
  while (
    first.getState().status !== "installed-configured" &&
    first.getState().status !== "unavailable"
  ) {
    await new Promise((r) => setImmediate(r));
    release(true);
    if (++calls > 30) throw Error("guard did not progress");
  }
  await pending;
  assert.equal(
    (await f.app.install({ approved: true })).installedConfigured,
    true,
  );
  assert.equal(
    fs
      .statSync(path.join(f.root, ".qiuqiu-workbuddy-plugin-install.lock"))
      .isFile(),
    true,
  );
});
test("non-Darwin install refuses before acquiring a directory lease", async () => {
  const vm = require("node:vm"),
    module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../lib/managed-plugin-installer"), "utf8"),
    { module, require, process: { platform: "linux" }, URL, Buffer },
  );
  let leases = 0;
  const app = module.exports.createManagedPluginInstaller({
    provider: "workbuddy",
    directoryAccess: {
      withAccess() {
        leases++;
        throw Error("must not enter");
      },
    },
    getMarketplaceDirectory: () => "/unused",
    assertHostStopped: () => true,
  });
  await assert.rejects(app.install({ approved: true }), {
    code: "PLATFORM_UNSUPPORTED",
  });
  assert.equal(leases, 0);
});

test('Darwin OS lock survives lockfile leftovers and releases after owner process exits',async t=>{if(process.platform!=='darwin')return t.skip('Darwin-only installer');const {spawn}=require('node:child_process'),{once}=require('node:events');const base=fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-lock-crash-')),file=path.join(base,'installer.lock');t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const script="const fs=require('fs');fs.openSync(process.argv[1],fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NONBLOCK|fs.constants.O_NOFOLLOW|0x20,0o600);process.stdout.write('locked');setInterval(()=>{},1000);";const child=spawn(process.execPath,['-e',script,file],{stdio:['ignore','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});await once(child.stdout,'data');const flags=fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NONBLOCK|fs.constants.O_NOFOLLOW|0x20;assert.throws(()=>fs.openSync(file,flags,0o600),e=>['EAGAIN','EWOULDBLOCK'].includes(e.code));child.kill('SIGKILL');await once(child,'exit');assert.equal(fs.existsSync(file),true);const fd=fs.openSync(file,flags,0o600);fs.closeSync(fd);});

function rotatedReceiver(f) {
  const value=JSON.parse(fs.readFileSync(f.receiver,'utf8'));
  value.endpoint='http://127.0.0.1:45679/'+(f.spec===specs.workbuddy?'workbuddy':'zcode')+'/events';
  value.token='new_synthetic_receiver_pairing_capability_9876543210';
  fs.writeFileSync(f.receiver,JSON.stringify(value));return Buffer.from(JSON.stringify(value));
}
function pairingReceivers(f) {
  const p=inventory(f),relative=path.join('plugins',f.spec.name,'receiver.json');
  return [path.join(p.market,relative),...(f.spec===specs.zcode?[path.join(f.storage,'marketplaces',f.spec.market,relative)]:[]),path.join(p.cache,'receiver.json')];
}
for(const provider of ['workbuddy','zcode'])test(provider+' rePair changes only existing receiver data, never code/settings/inventory, and new clock causes no writes',async t=>{
  const f=fixture(t,provider);await f.app.install({approved:true});const desired=rotatedReceiver(f),before=tree(f.root),p=inventory(f);
  const metadataFiles=[p.known,p.installed,f.config],metadataBefore=metadataFiles.map(file=>({file,bytes:fs.readFileSync(file),mtime:fs.statSync(file).mtimeMs}));
  const renamed=[],rename=fs.renameSync;fs.renameSync=(from,to)=>{renamed.push(to);return rename(from,to);};
  let paired;
  try{paired=await guarded(f,()=>true).rePair({approved:true});}finally{fs.renameSync=rename;}
  assert.equal(paired.status,'installed-configured');assert.equal(paired.operation,'receiver-repair');assert.equal(paired.receiverPairingVerified,true);assert.equal(paired.eventVerified,false);assert.equal(paired.requiresNewSession,true);
  assert.deepEqual(renamed.sort(),pairingReceivers(f).sort());
  const after=tree(f.root),changed=Object.keys(before).filter(file=>before[file]!==after[file]).sort();assert.deepEqual(changed,pairingReceivers(f).map(file=>path.relative(f.root,file)).sort());
  for(const file of pairingReceivers(f)){assert.ok(fs.readFileSync(file).equals(desired));assert.equal(fs.statSync(file).mode&0o777,0o600);}
  for(const old of metadataBefore){assert.ok(fs.readFileSync(old.file).equals(old.bytes));assert.equal(fs.statSync(old.file).mtimeMs,old.mtime);}
  assert.doesNotMatch(JSON.stringify(paired),/45679|new_synthetic|receiver.json|owned-market/);
  const stable=tree(f.root);await guarded(f,()=>true).rePair({approved:true});assert.deepEqual(tree(f.root),stable);assert.equal(fs.readdirSync(f.root).some(name=>name.startsWith('.qiuqiu-plugin-stage-')),false);
});
test('rePair needs explicit consent, directory lease and stopped host; unsupported or nonexisting installation is never installed/enabled',async t=>{
 const fresh=fixture(t);await assert.rejects(fresh.app.rePair(),{code:'CONSENT_REQUIRED'});assert.equal(fresh.grants(),0);await assert.rejects(fresh.app.rePair({approved:true}),{code:'PAIRING_REQUIRES_INSTALLED_PLUGIN'});assert.deepEqual(fs.readdirSync(fresh.root),[]);
 for(const kind of ['disabled','legacy-source','schema','tampered-code','extra-file','symlink']){
  const f=fixture(t);await f.app.install({approved:true});rotatedReceiver(f);const p=inventory(f);
  if(kind==='disabled')fs.writeFileSync(f.config,fs.readFileSync(f.config,'utf8').replace(JSON.stringify(f.id)+':true',JSON.stringify(f.id)+':false'));
  if(kind==='legacy-source'){const known=JSON.parse(fs.readFileSync(p.known));known[f.spec.market].source.path=f.source;known[f.spec.market].installLocation=f.source;fs.writeFileSync(p.known,JSON.stringify(known));}
  if(kind==='schema')fs.writeFileSync(p.installed,'{"version":99,"plugins":{}}');
  if(kind==='tampered-code')fs.appendFileSync(path.join(p.cache,'scripts/emit-metadata.sh'),'# modified');
  if(kind==='extra-file')fs.writeFileSync(path.join(p.cache,'unexpected.txt'),'must remain');
  if(kind==='symlink'){const receiver=path.join(p.cache,'receiver.json');fs.unlinkSync(receiver);fs.symlinkSync(f.receiver,receiver);}
  fs.unlinkSync(path.join(f.root,'.qiuqiu-workbuddy-plugin-install.lock'));const before=tree(f.root);
  await assert.rejects(guarded(f,()=>true).rePair({approved:true}));assert.deepEqual(tree(f.root),before,kind);assert.equal(fs.existsSync(path.join(f.root,'.qiuqiu-workbuddy-plugin-install.lock')),false,kind+' refused before lock write');
 }
 const f=fixture(t);await f.app.install({approved:true});rotatedReceiver(f);const before=tree(f.root);await assert.rejects(guarded(f,()=>false).rePair({approved:true}),{code:'HOST_RUNNING'});assert.deepEqual(tree(f.root),before);
 let leases=0;const denied=createManagedPluginInstaller({provider:'workbuddy',getMarketplaceDirectory:()=>f.source,assertHostStopped:()=>true,directoryAccess:{withAccess:async()=>{leases++;throw Object.assign(Error(),{code:'DIRECTORY_ACCESS_REQUIRED'});}}});await assert.rejects(denied.rePair({approved:true}),{code:'DIRECTORY_ACCESS_REQUIRED'});assert.equal(leases,1);
});
for(const mode of ['cancel','host-reopened','concurrent-code'])test('rePair rolls back own first receiver on '+mode+' without changing other settings',async t=>{
 const f=fixture(t);await f.app.install({approved:true});rotatedReceiver(f);const before=tree(f.root),controller=new AbortController();let running=false;
 const target=path.join(inventory(f).cache,'scripts/emit-metadata.sh');
 const app=guarded(f,()=>!running,state=>{if(state.status==='committing'&&state.fileIndex===1){if(mode==='cancel')controller.abort();if(mode==='host-reopened')running=true;if(mode==='concurrent-code')fs.appendFileSync(target,'# concurrent keep');}});
 await assert.rejects(app.rePair({approved:true,signal:controller.signal}),{code:mode==='cancel'?'CANCELLED':mode==='host-reopened'?'HOST_RUNNING':'CONCURRENT_MODIFICATION'});
 const after=tree(f.root);for(const file of Object.keys(before))if(file!==path.relative(f.root,target)||mode!=='concurrent-code')assert.equal(after[file],before[file],file);
 if(mode==='concurrent-code')assert.match(fs.readFileSync(target,'utf8'),/concurrent keep/);
 assert.equal(app.getState().receiverPairingVerified,false);assert.equal(app.getState().installedConfigured,false);
});
test('rePair preserves concurrent receiver edits and reports incomplete rollback instead of overwriting them',async t=>{
 const f=fixture(t);await f.app.install({approved:true});rotatedReceiver(f);const first=pairingReceivers(f)[0],replacement=JSON.stringify({version:1,enabled:true,endpoint:'http://127.0.0.1:45680/workbuddy/events',token:'third_party_synthetic_local_capability_123456789'});
 const app=guarded(f,()=>true,state=>{if(state.status==='committing'&&state.fileIndex===1)fs.writeFileSync(first,replacement);});
 await assert.rejects(app.rePair({approved:true}),{code:'ROLLBACK_INCOMPLETE'});assert.equal(fs.readFileSync(first,'utf8'),replacement);assert.equal(app.getState().receiverPairingVerified,false);
});
