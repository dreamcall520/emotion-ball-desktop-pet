"""Configuration location checks only; no group container access or installation."""
from pathlib import Path
import json,shutil,subprocess,sys
source=Path(__file__).resolve().parents[1]
out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=True)
binary=out/'ConfigLocationAcceptance'
subprocess.run(['xcrun','swiftc','-parse-as-library','-target','arm64-apple-macosx14.0',str(source/'Shared.swift'),str(source/'tests/ConfigLocationAcceptance.swift'),'-o',str(binary)],check=True)
checks=[]
def check(name,passed):checks.append({'name':name,'passed':bool(passed)})
def config(path,group):
 path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps({'appGroup':'ABCDEF1234.'+group,'urlScheme':'qiuqiu-widget'}))
def run(path):return json.loads(subprocess.check_output([str(path)],text=True))
helpers=out/'Synthetic.app/Contents/Helpers';helpers.mkdir(parents=True,exist_ok=True)
helper=helpers/'Reader';shutil.copy2(binary,helper)
resources=out/'Synthetic.app/Contents/Resources/QiuqiuWidgetBridge.json'
sibling=helpers/'QiuqiuWidgetBridge.json'
config(resources,'resource');config(sibling,'sibling')
value=run(helper)
check('embedded_helper_prefers_resources',value['group']=='ABCDEF1234.resource')
check('embedded_candidates_are_exactly_resource_and_sibling',value['candidateCount']==2)
check('configured_deeplink_preserved',value['link']=='qiuqiu-widget://todos')
resources.unlink()
check('embedded_missing_resources_allows_legacy_sibling',run(helper)['group']=='ABCDEF1234.sibling')
resources.write_text('{invalid')
check('invalid_resources_can_fall_back_to_fixed_sibling',run(helper)['group']=='ABCDEF1234.sibling')
standalone=out/'standalone/Reader';standalone.parent.mkdir(exist_ok=True);shutil.copy2(binary,standalone)
config(standalone.parent/'QiuqiuWidgetBridge.json','standalone')
value=run(standalone)
check('standalone_cli_sibling_still_works',value['group']=='ABCDEF1234.standalone' and value['candidateCount']==1)
fake=out/'not-app/Contents/Helpers/Reader';fake.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(binary,fake)
config(fake.parent.parent/'Resources/QiuqiuWidgetBridge.json','must-not-read')
config(fake.parent/'QiuqiuWidgetBridge.json','fixed-sibling')
value=run(fake)
check('does_not_search_arbitrary_parent_resources',value['group']=='ABCDEF1234.fixed-sibling' and value['candidateCount']==1)
(fake.parent/'QiuqiuWidgetBridge.json').unlink()
check('no_trusted_config_fails_closed',run(fake)['group']=='')
result={'scope':'synthetic uninstalled app-directory configuration lookup only; no AppGroup, profiles, model data or GUI','passed':sum(c['passed'] for c in checks),'total':len(checks),'checks':checks}
(out/'results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
raise SystemExit(0 if all(c['passed'] for c in checks) else 1)
