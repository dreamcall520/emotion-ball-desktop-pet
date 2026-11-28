# Native widgets for the containing app

This directory contains the 16 accepted WidgetKit kinds copied from the independent build 15 experiment. Kind identifiers and layouts stay stable within this extension. The old experiment has a different containing bundle ID, so its installed desktop instances are not claimed to migrate automatically.

Build from the repository root (no signing, registration, installation, or upload):

```js
const { buildNativeWidgets } = require('./desktop-pet/scripts/build-native-widgets');
const artifacts = buildNativeWidgets(repoRoot, {
  bundleId, teamId, version, buildVersion, targetArch: 'arm64'
});
```

Artifacts are in `desktop-pet/build/native-widgets/`: `QiuqiuWidgets.appex`, `QiuqiuWidgetBridge`, `QiuqiuWidgetBridge.json`, and `widget-center.node`. The extension uses `<bundleId>.widgets`, macOS 14 minimum, and `_NSExtensionMain`. The containing-app packager must embed and sign the extension with its own sandbox/App Group rights, sign the ordinary helper to inherit its parent's sandbox, and include the native module in the containing Electron process. This build script does not create provisioning profiles or establish App Store/TestFlight eligibility.

The extension reads `QiuqiuWidgetAppGroup` and `QiuqiuWidgetURLScheme` from its Info.plist. The helper reads the adjacent, code-bundle-owned `QiuqiuWidgetBridge.json` (`appGroup`, `urlScheme`, `containingBundleId`, `widgetBundleId`). The default group is `<teamId>.<bundleId>`. All views use `WidgetStore.link` for `qiuqiu-widget://calendar`, `qiuqiu-widget://todos`, or `qiuqiu-widget://connect-weather`; the containing app handles these routes.

The host launches the helper with `--sync`, passes JSON on stdin, and waits for exit. Input is capped at 16 MiB total and 4 MiB per `value`:

```json
{
  "schema": 1,
  "sourceID": "64 lowercase hexadecimal characters",
  "todo": {"state": "data", "value": {"schema": 2, "revision": 0, "todos": []}},
  "weatherConfig": {"state": "missing"},
  "weatherCache": {"state": "missing"}
}
```

Each source state is `data`, `missing`, or `error`; only `data` carries a root object in `value`. The host reads its own active profile; no profile paths, directory bookmarks, location lookup, network access, or raw file errors enter this helper. `sourceID` is a profile identity hash, not its path. Valid-envelope but invalid source content becomes that source's error state. Invalid envelopes exit 2 without modifying snapshots; unavailable shared storage exits 3. Successful synchronization exits 0, including explicit per-source errors.

Stdout contains only `{ok,state,todo:{state,count,revision,changed},weather:{state,count,changed},changed}`. A count is null until genuine source data exists. No title, coordinates, profile identity, or raw errors are printed. Snapshots contain validated minimal view fields; notes/body and coordinates are discarded. A source switch clears both old payloads before processing new data. Same-source errors retain last valid payload with an error marker; weather disable, revoked current-location consent, city changes and missing config/cache clear obsolete weather first. A group-local lock serializes read/modify/write; snapshot replacement is atomic and owner-only (0600) before and after writing. Repeated identical snapshots report `changed: false`. The short-lived helper does not call WidgetCenter; the containing Electron process uses those change flags to refresh affected kinds.

Dynamic clock and timeline behavior is inherited from the accepted native experiment: public macOS 15 clock text, macOS 14 snapshot fallback; minute analog hand entries, no fake second animation; the large overview retains its 25-entry archive limit.

Tests: `node --test desktop-pet/native-widgets/tests/build-options.test.js`. `tests/BridgeAcceptance.swift` exercises only synthetic data and must be compiled with Shared/TodoModel/WeatherModel/WidgetBridgeSync and signed for the dedicated acceptance group. Its standalone group test is separate from the real containing-app sandbox-inheritance acceptance.

## Parent-process refresh module

`buildNativeWidgets` also returns `widgetCenterPath`. `buildWidgetCenter(repoRoot, {targetArch: 'arm64'})` can rebuild this module independently. Node headers are located using `WIDGET_NODE_INCLUDE`, `CALENDAR_NODE_INCLUDE`, `WEATHER_NODE_INCLUDE`, then the same standard Node include candidates as the existing calendar bridge. The build uses N-API 8, Objective-C++ and a Swift public WidgetKit shim, macOS 14/arm64; all runtime dependencies are system frameworks/libraries.

```js
const center = require(widgetCenterPath);
center.bundleIdentifier(); // Current process's Bundle.main ID; null outside an app bundle.
center.reload(['QiuqiuNativeTodoListProbe']); // Number of distinct validated kinds requested.
```

`reload` accepts only an array of at most 16 known kind identifiers. It validates all elements before any requests, removes duplicates and returns the number requested. Unknown kinds, nonstrings, sparse arrays and extra arguments are rejected. The caller must use it in the containing Electron process and verify its bundle ID during real integration acceptance. The return value describes requests sent to the public API; it does not claim a system timeline was accepted or a desktop view refreshed.

Module-only checks: `node --test desktop-pet/native-widgets/tests/widget-center.test.js` after building. They load the real module, query current metadata, issue no system reloads (`reload([])` only), and reject malformed arguments. Real nonempty reload delivery is checked separately inside the containing app.
