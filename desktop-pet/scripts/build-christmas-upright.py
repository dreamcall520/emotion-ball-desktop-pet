"""Restore reviewed v17 Christmas performances; remove only disconnected ground gifts.
No body resize, generated repaint, temporal resampling, or whole-body motion is introduced.
"""
from pathlib import Path
from PIL import Image,ImageSequence,ImageDraw
import argparse,json,hashlib,shutil,math
import numpy as np
parser=argparse.ArgumentParser();parser.add_argument('config',type=Path);parser.add_argument('--qa-dir',type=Path,required=True);parser.add_argument('--idle-art-dir',type=Path);parser.add_argument('--working-eyes-dir',type=Path);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'assets/sheep';mf=out/'manifest.json';ff=root/'tests/fixtures/sheep-source-frames.json';manifest=json.loads(mf.read_text());fixture=json.loads(ff.read_text());source=json.loads(args.config.read_text())['themes']['christmas'];qa=args.qa_dir;qa.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest();report={'sourceConfig':str(args.config),'actions':{},'rule':'Only complete disconnected alpha components at ground-left are removed; all retained pixels and timing are identical to v17 source.'}
retained={p:sha(p.read_bytes())for p in out.rglob('*.png')if p.parent.name!='christmas'}
def remove_ground(image):
 a=np.array(image);mask=a[:,:,3]>0;seen=np.zeros(mask.shape,bool);removed=[];removal=np.zeros(mask.shape,np.uint8)
 # Search only the old independent ground-gift area; a body-connected component is never removed.
 for yy,xx in zip(*np.nonzero(mask[205:, :110])):
  yy+=205
  if seen[yy,xx]:continue
  stack=[(int(yy),int(xx))];seen[yy,xx]=True;points=[]
  while stack:
   y,x=stack.pop();points.append((x,y))
   for ny,nx in [(y-1,x),(y+1,x),(y,x-1),(y,x+1)]:
    if 0<=ny<320 and 0<=nx<320 and mask[ny,nx]and not seen[ny,nx]:seen[ny,nx]=True;stack.append((ny,nx))
  xs=[p[0]for p in points];ys=[p[1]for p in points];box=[min(xs),min(ys),max(xs)+1,max(ys)+1]
  if len(points)>100 and box[0]<90 and box[1]>=205 and box[2]<=115 and box[3]-box[1]<=105:
   for x,y in points:a[y,x]=0;removal[y,x]=255
   removed.append({'bbox':box,'pixels':len(points)})
 return Image.fromarray(a),Image.fromarray(removal),removed
clips={};masks={}
for action,path in [*source['actions'].items(),('working-transition',source['workingTransition'])]:
 p=Path(path);original=[];frames=[];durations=[];details=[];clipmasks=[]
 with Image.open(p)as src:
  for i,f in enumerate(ImageSequence.Iterator(src)):
   im=f.convert('RGBA').copy();result,mask,removed=remove_ground(im);original.append(im);frames.append(result);clipmasks.append(mask);durations.append(int(round(f.info['duration'])));details.append(removed)
 clips[action]=(frames,durations,p,original);masks[action]=clipmasks;report['actions'][action]={'source':str(p),'sourceSha256':sha(p.read_bytes()),'frameCount':len(frames),'durations':durations,'removed':details,'originalFrameRGBA':[sha(im.tobytes())for im in original]}
# Repair the documented asymmetric right-eye source poses, and any matching work-bridge frames.
working_eye_patches={}
if args.working_eyes_dir:
 eye_art=args.working_eyes_dir;eye_report=json.loads((eye_art/'working-eye-patches.json').read_text())
 for patch in eye_report['frames']:
  repaired=Image.open(eye_art/patch['file']).convert('RGBA');assert sha(repaired.tobytes())==patch['patchedRGBA'];working_eye_patches[patch['originalRGBA']]=(repaired,patch)
 for action in ['working','working-transition']:
  frames,ds,path,original=clips[action];applied=[]
  for i,im in enumerate(frames):
   key=sha(im.tobytes())
   if key in working_eye_patches:
    repaired,patch=working_eye_patches[key];frames[i]=repaired.copy();applied.append(dict(patch,clipFrame=i))
  report['actions'][action]['workingEyePatches']=applied
 report['workingEyeRepair']=eye_report
# The reviewed redraw replaces only exact old idle anchors, never authored performance frames.
replacement_sources={}
if args.idle_art_dir:
 art=args.idle_art_dir
 masters=[Image.open(art/name).convert('RGBA')for name in ['normal-stance-master-320.png','normal-stance-closed-320.png']]
 assert all(im.size==(320,320)for im in masters)
 anchors={clips['idle'][0][0].tobytes():masters[0],clips['idle'][0][1].tobytes():masters[1]}
 replacement_sources={name:sha((art/name).read_bytes())for name in ['normal-stance-generated-original.png','normal-stance-master-320.png','normal-stance-closed-320.png']}
 for name in ['normal-stance-hand-composite.png','normal-stance-left-hoof-generated-original.png','normal-stance-mouth-composite.png','normal-stance-mouth-generated-original.png']:
  if(art/name).exists():replacement_sources[name]=sha((art/name).read_bytes())
 for action,(frames,ds,path,original)in clips.items():
  flags=[]
  for i,im in enumerate(frames):
   key=im.tobytes();flags.append(key in anchors)
   if key in anchors:frames[i]=anchors[key].copy()
  report['actions'][action]['redrawnIdleAnchor']=flags
 report['rule']='All authored performance frames and timing remain v17 original, except exact idle anchors replaced by the reviewed new normal standing redraw.'
 report['idleRedraw']={'sourceArtSha256':replacement_sources,'registration':json.loads((art/'normal-stance-registration.json').read_text()),'rule':'Original normal standing redraw; uniform scale and position only. Other original performances unchanged.'}
 report['idleRedraw']['registration']['source']=Path(report['idleRedraw']['registration']['source']).name
 if(art/'left-hoof-composite.json').exists():report['idleRedraw']['handPatch']=json.loads((art/'left-hoof-composite.json').read_text())
 if(art/'closed-eye-composite.json').exists():report['idleRedraw']['eyeComposite']=json.loads((art/'closed-eye-composite.json').read_text())
 if(art/'mouth-composite.json').exists():report['idleRedraw']['mouthPatch']=json.loads((art/'mouth-composite.json').read_text())
base=clips['idle'][0][0].tobytes();working=clips['working'][0][0].tobytes()
for action,(frames,durations,p,original)in clips.items():
 columns=6;atlas=Image.new('RGBA',(columns*320,((len(frames)+columns-1)//columns)*320));maskatlas=Image.new('L',atlas.size)
 for i,im in enumerate(frames):atlas.paste(im,(i%columns*320,i//columns*320));maskatlas.paste(masks[action][i],(i%columns*320,i//columns*320))
 path=out/'christmas'/f'{action}.png';atlas.save(path,compress_level=6);maskatlas.save(qa/f'{action}-removed-mask.png')
 spec={'file':f'christmas/{action}.png','columns':columns,'cellSize':320,'frameCount':len(frames),'durations':durations,'sha256':sha(path.read_bytes()),'startsAtIdle':frames[0].tobytes()==base,'startsAtWorking':action!='idle'and frames[0].tobytes()==working}
 if action in source.get('uprightRegions',{}):spec['uprightRegions']=source['uprightRegions'][action]
 if action in source.get('resultFrames',{}):spec['resultFrame']=source['resultFrames'][action]
 entry={'sourceSha256':sha(p.read_bytes()),'sourcePngSha256':sha(p.read_bytes()),'frames':[sha(im.tobytes())for im in frames],'durations':durations,'motionSource':'v17-original-performance-disconnected-ground-gift-only','originalFrames':[sha(im.tobytes())for im in original],'removedGroundGiftPixels':[sum(x['pixels']for x in info)for info in report['actions'][action]['removed']]}
 if args.idle_art_dir:entry['redrawnIdleAnchor']=report['actions'][action]['redrawnIdleAnchor'];entry['sourceArtSha256']=replacement_sources;entry['idleRedraw']=report['idleRedraw']
 if action in ('working','working-transition')and args.working_eyes_dir:entry['workingEyePatches']=report['actions'][action]['workingEyePatches'];entry['workingEyeRepair']=report['workingEyeRepair']
 if action=='working-transition':manifest['themes']['christmas']['workingTransition']=spec;fixture['christmas']['workingTransition']=entry
 else:manifest['themes']['christmas']['actions'][action]=spec;fixture['christmas']['actions'][action]=entry
 report['actions'][action]['decodedRGBABytes']=atlas.width*atlas.height*4;report['actions'][action]['pngBytes']=path.stat().st_size
manifest['themes']['christmas'].pop('sleepTransition',None);fixture['christmas'].pop('sleepTransition',None);(out/'christmas/sleep-transition.png').unlink(missing_ok=True)
# The fallback uses the actual restored idle, so a failed atlas cannot resurrect rejected white art.
static=out/'christmas/static.png'
if args.idle_art_dir:
 # Keep static fallback/customization at authored resolution, avoiding a 320px upsample.
 registration=report['idleRedraw']['registration'];factor=1254/320;scale=registration['scale']*factor;tx,ty=[v*factor for v in registration['position']]
 raw=Image.open(args.idle_art_dir/('normal-stance-mouth-composite.png'if(args.idle_art_dir/'normal-stance-mouth-composite.png').exists()else'normal-stance-hand-composite.png'if(args.idle_art_dir/'normal-stance-hand-composite.png').exists()else'normal-stance-generated-original.png')).convert('RGBA');raw.transform((1254,1254),Image.Transform.AFFINE,(1/scale,0,-tx/scale,0,1/scale,-ty/scale),Image.Resampling.BICUBIC).save(static,compress_level=6)
else:clips['idle'][0][0].resize((1254,1254),Image.Resampling.LANCZOS).save(static,compress_level=6)
fixture['christmas']['staticSha256']=sha(static.read_bytes())
for p,digest in retained.items():assert sha(p.read_bytes())==digest,p
for p,data in [(mf,manifest),(ff,fixture)]:p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
for bgname,bg in [('light','#f5efe5'),('dark','#202833')]:
 sheet=Image.new('RGB',(1280,3*345),bg);d=ImageDraw.Draw(sheet)
 for j,(action,(frames,ds,p,original))in enumerate(clips.items()):
  i=len(frames)//2;x=j%4*320;y=j//4*345;sheet.paste(frames[i],(x,y),frames[i]);d.text((x+3,y+320),f'{action} #{i}/{len(frames)}',fill='black'if bgname=='light'else'white')
 sheet.save(qa/f'restored-all-actions-{bgname}.png')
alpha=np.array(clips['idle'][0][0])[:,:,3]>128;ys,xs=np.nonzero(alpha);report['idleInk']={'bbox':[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)],'height':int(ys.max()-ys.min()+1),'baseline':int(ys.max()+1)};report['decodedRGBABytesTotal']=sum(v['decodedRGBABytes']for v in report['actions'].values());report['pngBytesTotal']=sum(v['pngBytes']for v in report['actions'].values());report['rule']='Original timelines remain unchanged. Every idle-anchor replacement and working-eye ROI repair is recorded; unmodified performance pixels retain source RGBA.';(qa/'restore-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:report[k]for k in ['idleInk','decodedRGBABytesTotal','pngBytesTotal']}))
