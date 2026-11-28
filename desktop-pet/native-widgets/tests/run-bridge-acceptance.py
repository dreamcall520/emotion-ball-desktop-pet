"""Compile/sign dedicated synthetic helpers; never install/register or open a real profile."""
from pathlib import Path
import hashlib
import json
import plistlib
import shutil
import subprocess
import sys

source = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
group = 'SUUX53KQQV.qiuqiu.widgetprobe.acceptance'
(out / 'QiuqiuWidgetBridge.json').write_text(json.dumps({'schema': 1, 'appGroup': group, 'urlScheme': 'qiuqiu-widget'}))
# This tests the group store directly, not inheritance from a MAS containing process.
(out / 'test.entitlements.plist').write_bytes(plistlib.dumps({'com.apple.security.application-groups': [group]}))
shared = ['Shared.swift', 'TodoModel.swift', 'WeatherModel.swift', 'WidgetBridgeSync.swift']
for filename, main in [('BridgeAcceptance', 'tests/BridgeAcceptance.swift'), ('QiuqiuWidgetBridge', 'WidgetBridgeMain.swift')]:
    binary = out / filename
    subprocess.run(['xcrun', 'swiftc', '-parse-as-library', '-O', '-target', 'arm64-apple-macosx14.0', *[str(source / name) for name in shared], str(source / main), '-o', str(binary)], check=True)
    subprocess.run(['codesign', '--force', '--identifier', 'local.xiaokun.widgetbridge.acceptance.' + filename.lower(), '--sign', 'Developer ID Application: ma xiaokun (SUUX53KQQV)', '--entitlements', str(out / 'test.entitlements.plist'), '--options', 'runtime', '--timestamp=none', str(binary)], check=True)
core = subprocess.run([str(out / 'BridgeAcceptance')], capture_output=True, check=True)
core_results = json.loads(core.stdout)
(out / 'acceptance-results.json').write_text(json.dumps(core_results, indent=2))
checks = []
def check(name, passed):
    checks.append({'name': name, 'passed': bool(passed)})
def sync(value=None, data=None, args=('--sync',)):
    result = subprocess.run([str(out / 'QiuqiuWidgetBridge'), *args], input=data if data is not None else json.dumps(value).encode(), capture_output=True)
    return result.returncode, json.loads(result.stdout)
missing = {'state': 'missing'}
request = {'schema': 1, 'sourceID': 'c' * 64, 'todo': missing, 'weatherConfig': missing, 'weatherCache': missing}
rc, value = sync(request)
check('cli_sync_missing_waiting_null', rc == 0 and value['todo']['state'] == 'waiting' and value['todo']['count'] is None and value['weather']['state'] == 'waiting')
rc, value = sync(request)
check('cli_second_process_unchanged_no_reload', rc == 0 and value['changed'] is False)
for name, data in [('malformed_json', b'{bad'), ('oversized_16MiB', b' ' * (16 * 1024 * 1024 + 1))]:
    rc, value = sync(data=data)
    check('cli_' + name + '_safe_rejection', rc == 2 and value == {'ok': False, 'state': 'invalid'})
rc, value = sync(request, args=())
check('cli_requires_explicit_sync', rc == 2 and value == {'ok': False, 'state': 'invalid'})
invalid = dict(request, sourceID='../private')
rc, value = sync(invalid)
check('cli_rejects_nonhash_source_identity', rc == 2 and value == {'ok': False, 'state': 'invalid'})
rc, value = sync(request)
check('cli_rejected_requests_preserve_previous_snapshots', rc == 0 and value['changed'] is False)
check('stdout_metadata_keys_only', set(value) == {'ok', 'state', 'todo', 'weather', 'changed'} and set(value['todo']) == {'state', 'count', 'revision', 'changed'} and set(value['weather']) == {'state', 'count', 'changed'})
result = {'scope': 'dedicated synthetic group only; not MAS sandbox inheritance, native rendering, install or submission', 'core': core_results, 'cli': {'checks': checks, 'passed': sum(c['passed'] for c in checks), 'total': len(checks)}, 'sourceHashes': {name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in shared + ['WidgetBridgeMain.swift']}}
(out / 'review.json').write_text(json.dumps(result, indent=2))
print(json.dumps({'core': [core_results['passed'], core_results['total']], 'cli': [result['cli']['passed'], result['cli']['total']]}))
raise SystemExit(0 if core_results['passed'] == core_results['total'] and all(c['passed'] for c in checks) else 1)
