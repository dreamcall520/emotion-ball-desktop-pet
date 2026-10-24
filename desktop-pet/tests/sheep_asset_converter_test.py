"""Build-time tests: run with a Pillow-enabled Python, never write product assets."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('sheep_converter', Path(__file__).resolve().parents[1] / 'scripts/build-sheep-assets.py')
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


class AlternateAtlasTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sheep-alternate-converter-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / 'desktop-pet/assets/sheep'
        self.original_output = converter.OUTPUT
        converter.OUTPUT = self.output
        self.addCleanup(setattr, converter, 'OUTPUT', self.original_output)
        self.design = self.root / 'design'
        self.design.mkdir()
        self.config_path = self.design / 'sources.json'
        self.write_clip('a.png', 3220)
        self.write_clip('b.png', 3220, offset=20)
        Image.new('RGBA', (1254,1254), (255,0,0,128)).save(self.design/'static.png')
        for kind in ['candy','gift']:
            image=Image.new('RGBA',(32,32));ImageDraw.Draw(image).ellipse((8,8,24,24),fill=(200,30,20,255));image.save(self.design/f'{kind}.png')
        self.config={'themes':{},'source_props':{'candy':'candy.png','gift':'gift.png'}}
        for theme, extras in converter.THEME_ACTIONS.items():
            source={'actions':{action:'a.png' for action in sorted(converter.ACTIONS | extras)}}
            if theme!='none':source['static']='static.png'
            if theme in {'none','spring-festival'}:source['idleAlternate']='b.png'
            self.config['themes'][theme]=source

    def write_clip(self,name,total,offset=0,size=(320,320)):
        a=Image.new('RGBA',size);ImageDraw.Draw(a).ellipse((70+offset,70,230+offset,290),fill=(225,180,110,255))
        b=a.copy();ImageDraw.Draw(b).line((110+offset,120,130+offset,120),fill=(0,0,0,255),width=4)
        a.save(self.design/name,save_all=True,append_images=[b,a],duration=[total-620,120,500],loop=0,disposal=0,blend=0)

    def build(self,only=None):
        self.config_path.write_text(json.dumps(self.config))
        with contextlib.redirect_stdout(io.StringIO()):converter.build(self.config_path,only)

    def test_two_alternates_exact_rgba_paths_fixtures_and_selected_rebuild(self):
        self.config['themes']['none']['uprightRegions']={'idleAlternate':[[110,110,20,20],None,None]}
        self.build()
        manifest=json.loads((self.output/'manifest.json').read_text())
        fixture=json.loads((self.root/'desktop-pet/tests/fixtures/sheep-source-frames.json').read_text())
        paths=json.loads((self.design/'asset-paths.json').read_text())
        self.assertEqual(len(paths),49)
        self.assertEqual(sum(len(theme['actions']) for theme in manifest['themes'].values()),41)
        for theme in ['none','spring-festival']:
            clip=manifest['themes'][theme]['idleAlternate'];self.assertEqual(clip['file'],f'{theme}/idle-alternate.png')
            self.assertEqual(sum(clip['durations']),3220)
            atlas=Image.open(self.output/clip['file']).convert('RGBA')
            source=Image.open(self.design/'b.png')
            for index in range(3):
                source.seek(index);frame=source.convert('RGBA')
                decoded=atlas.crop((index*320,0,(index+1)*320,320))
                self.assertEqual(decoded.tobytes(),frame.tobytes())
                self.assertEqual(hashlib.sha256(decoded.tobytes()).hexdigest(),fixture[theme]['idleAlternate']['frames'][index])
            self.assertIsNone(atlas.crop((960,0,1920,320)).getchannel('A').getbbox())
            source.close()
        self.assertEqual(manifest['themes']['none']['idleAlternate']['uprightRegions'],[[110,110,20,20],None,None])
        before={str(p):(converter.digest(p),p.stat().st_mtime_ns) for p in self.output.rglob('*.png') if p!=self.output/'none/idle-alternate.png'}
        self.write_clip('b.png',3220,offset=25)
        self.build('none/idle-alternate')
        self.assertEqual(before,{p:(converter.digest(Path(p)),Path(p).stat().st_mtime_ns) for p in before})
        self.assertEqual(len(json.loads((self.design/'asset-paths.json').read_text())),49)

    def test_malformed_alternates_rejected(self):
        self.build()
        for bad in [None,{},'',42]:
            with self.subTest(value=bad):
                self.config['themes']['none']['idleAlternate']=bad
                with self.assertRaises(AssertionError):self.build('none/idle-alternate')
        self.config['themes']['none']['idleAlternate']='b.png'
        self.write_clip('b.png',3200)
        with self.assertRaisesRegex(AssertionError,'Idle duration mismatch'):self.build('none/idle-alternate')
        self.write_clip('b.png',3220,size=(321,320))
        with self.assertRaises(AssertionError):self.build('none/idle-alternate')
        self.write_clip('b.png',3220)
        for regions in [[],[[310,0,20,20],None,None],[[1,1,0,20],None,None],[[1.5,1,20,20],None,None]]:
            self.config['themes']['none']['uprightRegions']={'idleAlternate':regions}
            with self.assertRaises(AssertionError):self.build('none/idle-alternate')

    def test_alternate_is_optional_and_removed_from_full_build(self):
        self.build()
        for theme in ['none','spring-festival']:del self.config['themes'][theme]['idleAlternate']
        self.build()
        manifest=json.loads((self.output/'manifest.json').read_text())
        self.assertNotIn('idleAlternate',manifest['themes']['none'])
        self.assertFalse((self.output/'none/idle-alternate.png').exists())
        self.assertEqual(len(json.loads((self.design/'asset-paths.json').read_text())),47)

    def write_transition(self, name, last, holds=(50,60,50)):
        with Image.open(self.design/'a.png') as image:a=image.convert('RGBA')
        with Image.open(self.design/last) as image:b=image.convert('RGBA')
        middle=a.copy();ImageDraw.Draw(middle).ellipse((100,160,160,210),fill=(10,120,30,255))
        a.save(self.design/name,save_all=True,append_images=[middle,b],duration=list(holds),loop=0,disposal=0,blend=0)

    def test_six_pose_bridges_exact_endpoints_and_compatibility_metadata(self):
        self.write_clip('working.png',3220,offset=40)
        self.write_transition('work-bridge.png','working.png')
        self.write_transition('idle-bridge.png','b.png')
        for theme,source in self.config['themes'].items():
            source['actions']['working']='working.png'
            source['workingTransition']='work-bridge.png'
            if theme in {'none','spring-festival'}:source['idleTransition']='idle-bridge.png'
        self.build()
        m=json.loads((self.output/'manifest.json').read_text())
        f=json.loads((self.root/'desktop-pet/tests/fixtures/sheep-source-frames.json').read_text())
        self.assertEqual(len(json.loads((self.design/'asset-paths.json').read_text())),55)
        for theme,spec in m['themes'].items():
            self.assertTrue(spec['actions']['greet']['startsAtIdle'])
            self.assertFalse(spec['actions']['working']['startsAtIdle'])
            self.assertTrue(spec['actions']['working']['startsAtWorking'])
            self.assertEqual(f[theme]['workingTransition']['frames'][0],f[theme]['actions']['idle']['frames'][0])
            self.assertEqual(f[theme]['workingTransition']['frames'][-1],f[theme]['actions']['working']['frames'][0])
            if theme in {'none','spring-festival'}:
                self.assertEqual(f[theme]['idleTransition']['frames'][-1],f[theme]['idleAlternate']['frames'][0])
        before={str(p):(converter.digest(p),p.stat().st_mtime_ns) for p in self.output.rglob('*.png') if p!=self.output/'none/working-transition.png'}
        self.build('none/working-transition')
        self.assertEqual(before,{p:(converter.digest(Path(p)),Path(p).stat().st_mtime_ns) for p in before})

    def test_pose_bridge_rejects_wrong_endpoint_timing_and_missing_alternate(self):
        self.write_clip('working.png',3220,offset=40)
        self.config['themes']['none']['actions']['working']='working.png'
        self.config['themes']['none']['workingTransition']='bridge.png'
        self.write_transition('bridge.png','b.png')
        with self.assertRaisesRegex(AssertionError,'Pose transition endpoints'):self.build()
        self.write_transition('bridge.png','working.png',(800,800,800))
        with self.assertRaisesRegex(AssertionError,'Pose transition timing'):self.build()
        self.write_transition('bridge.png','working.png')
        self.build()
        self.config['themes']['none']['idleTransition']='bridge.png'
        del self.config['themes']['none']['idleAlternate']
        with self.assertRaisesRegex(AssertionError,'Missing idle alternate'):self.build()

    def test_optional_sleep_bridge_matches_sleep_endpoint_and_selected_rebuild(self):
        self.write_clip('sleeping.png',3220,offset=30)
        self.write_transition('sleep-bridge.png','sleeping.png')
        source=self.config['themes']['christmas']
        source['actions']['sleep']='sleeping.png'
        source['sleepTransition']='sleep-bridge.png'
        self.build()
        manifest=json.loads((self.output/'manifest.json').read_text())
        fixture=json.loads((self.root/'desktop-pet/tests/fixtures/sheep-source-frames.json').read_text())
        self.assertEqual(manifest['themes']['christmas']['sleepTransition']['file'],'christmas/sleep-transition.png')
        self.assertEqual(fixture['christmas']['sleepTransition']['frames'][0],fixture['christmas']['actions']['idle']['frames'][0])
        self.assertEqual(fixture['christmas']['sleepTransition']['frames'][-1],fixture['christmas']['actions']['sleep']['frames'][0])
        self.assertIn('assets/sheep/christmas/sleep-transition.png',json.loads((self.design/'asset-paths.json').read_text()))
        before={str(p):(converter.digest(p),p.stat().st_mtime_ns) for p in self.output.rglob('*.png') if p!=self.output/'christmas/sleep-transition.png'}
        self.build('christmas/sleep-transition')
        self.assertEqual(before,{p:(converter.digest(Path(p)),Path(p).stat().st_mtime_ns) for p in before})
        self.write_transition('sleep-bridge.png','b.png')
        with self.assertRaisesRegex(AssertionError,'Pose transition endpoints'):self.build('christmas/sleep-transition')

    def test_solid_ear_at_edge_is_rejected_even_with_transparent_corners(self):
        self.write_clip('a.png',3220)
        with Image.open(self.design/'a.png') as source:
            frames=[]
            for i in range(source.n_frames):
                source.seek(i);frame=source.convert('RGBA');frame.putpixel((0,150),(220,170,100,255));frames.append(frame)
        frames[0].save(self.design/'a.png',save_all=True,append_images=frames[1:],duration=[2600,120,500],loop=0,disposal=0,blend=0)
        with self.assertRaisesRegex(AssertionError,'Solid pose clipped'):self.build()

    def test_result_pose_is_validated_and_preserved(self):
        self.config['themes']['christmas']['resultFrames']={'receive-gift':1}
        self.build()
        manifest=json.loads((self.output/'manifest.json').read_text())
        self.assertEqual(manifest['themes']['christmas']['actions']['receive-gift']['resultFrame'],1)
        for bad in [-1,3,1.5,'1',True]:
            self.config['themes']['christmas']['resultFrames']['receive-gift']=bad
            with self.assertRaisesRegex(AssertionError,'Result frame'):self.build('christmas/receive-gift')

    def test_pose_bridges_removed_without_orphaned_resources(self):
        self.write_transition('bridge.png','b.png')
        self.config['themes']['none']['idleTransition']='bridge.png'
        self.build()
        del self.config['themes']['none']['idleTransition']
        self.build()
        self.assertFalse((self.output/'none/idle-transition.png').exists())
        self.assertNotIn('idleTransition',json.loads((self.output/'manifest.json').read_text())['themes']['none'])


if __name__=='__main__':unittest.main()
