"""Convert reviewed design GIFs to lossless runtime atlases; Pillow is a build-time tool only."""
from pathlib import Path
from PIL import Image, ImageSequence
import hashlib
import json
import shutil
import sys

OUTPUT = Path(__file__).resolve().parents[1] / 'assets/sheep'
SIZE, COLUMNS = 320, 6
ACTIONS = {'idle', 'walk', 'greet', 'joy', 'sleep', 'working', 'complete'}
THEME_ACTIONS = {'none': {'ear', 'bell', 'stretch'}, 'halloween': {'candy', 'magic', 'pumpkin'}, 'christmas': {'gift', 'receive-gift', 'scarf', 'snow'}, 'spring-festival': {'fortune', 'firecrackers', 'dumplings'}}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def build(config_path, only=None):
    config_path = config_path.resolve()
    config = json.loads(config_path.read_text())
    sources = config['themes']
    assert 'none' in sources and set(sources) <= {'none', 'halloween', 'christmas', 'spring-festival'}
    fixture_path = OUTPUT.parents[1] / 'tests/fixtures/sheep-source-frames.json'
    selected = only.split('/') if only else None
    if selected:
        assert len(selected) == 2 and selected[0] in sources and selected[1] in ACTIONS | THEME_ACTIONS[selected[0]] | {'idle-alternate', 'idle-transition', 'working-transition', 'sleep-transition'}
    manifest = json.loads((OUTPUT / 'manifest.json').read_text()) if selected else dict(version=1, width=SIZE, height=SIZE, themes={})
    verification = json.loads((config_path.parent / 'asset-verification.json').read_text()) if selected else {}
    fixture = json.loads(fixture_path.read_text()) if selected else {}
    retained = {p: (digest(p), p.stat().st_mtime_ns) for p in OUTPUT.rglob('*.png')
                if selected and p != OUTPUT / f'{only}.png'}
    for theme, source in sources.items():
        if selected and selected[0] != theme:
            continue
        assert set(source['actions']) == ACTIONS | THEME_ACTIONS[theme], f'Incomplete actions: {theme}'
        directory = OUTPUT / theme
        directory.mkdir(parents=True, exist_ok=True)
        theme_manifest = manifest['themes'][theme] if selected else dict(actions={})
        if not selected:
            verification[theme] = {}
            fixture[theme] = dict(actions={})
        if not selected and source.get('static'):
            static = (config_path.parent / source['static']).resolve()
            with Image.open(static) as image:
                assert image.format == 'PNG' and image.size == (1254, 1254) and image.mode == 'RGBA'
            shutil.copy2(static, directory / 'static.png')
            assert digest(static) == digest(directory / 'static.png')
            theme_manifest['staticFile'] = f'{theme}/static.png'
            verification[theme]['static'] = dict(source=str(static), sha256=digest(static), size=list(image.size))
            fixture[theme]['staticSha256'] = digest(static)
        clips = list(source['actions'].items())
        for key, name in [('idleAlternate', 'idle-alternate'), ('idleTransition', 'idle-transition'), ('workingTransition', 'working-transition'), ('sleepTransition', 'sleep-transition')]:
            if key in source:
                assert isinstance(source[key], str) and source[key], f'Invalid {key}: {theme}'
                if key == 'idleTransition':
                    assert 'idleAlternate' in source, f'Missing idle alternate: {theme}'
                clips.append((name, source[key]))
            elif not selected:
                (directory / f'{name}.png').unlink(missing_ok=True)
            if selected and selected[1] == name:
                assert key in source, f'Missing {key}: {theme}'
        with Image.open((config_path.parent / source['actions']['idle']).resolve()) as primary:
            idle_frame = primary.convert('RGBA').tobytes()
        with Image.open((config_path.parent / source['actions']['working']).resolve()) as working:
            working_frame = working.convert('RGBA').tobytes()
        for action, name in clips:
            if selected and selected[1] != action:
                continue
            path = (config_path.parent / name).resolve()
            with Image.open(path) as gif:
                assert gif.format in {'GIF', 'PNG'} and gif.size == (SIZE, SIZE) and gif.info.get('loop') == 0
                frames, durations = [], []
                for frame in ImageSequence.Iterator(gif):
                    frame = frame.convert('RGBA')
                    assert frame.getchannel('A').getbbox(), f'Blank source frame: {theme}/{action}'
                    assert all(frame.getpixel(point)[3] == 0 for point in [(0, 0), (319, 0), (0, 319), (319, 319)])
                    assert max(frame.getpixel(point)[3] for edge in range(SIZE) for point in [(0, edge), (319, edge), (edge, 0), (edge, 319)]) <= 128, f'Solid pose clipped at canvas edge: {theme}/{action}'
                    frames.append(frame.copy())
                    durations.append(int(round(frame.info['duration'])))
                assert 1 <= len(frames) <= 256 and all(isinstance(ms, int) and 10 <= ms <= 60000 for ms in durations)
                assert sum(durations) <= 60000
                atlas = Image.new('RGBA', (COLUMNS * SIZE, ((len(frames) + COLUMNS - 1) // COLUMNS) * SIZE))
                for index, frame in enumerate(frames):
                    atlas.paste(frame, (index % COLUMNS * SIZE, index // COLUMNS * SIZE))
                target = directory / f'{action}.png'
                atlas.save(target, optimize=True)
                decoded = Image.open(target).convert('RGBA')
                for index, frame in enumerate(frames):
                    x, y = index % COLUMNS * SIZE, index // COLUMNS * SIZE
                    assert decoded.crop((x, y, x + SIZE, y + SIZE)).tobytes() == frame.tobytes(), f'Pixel mismatch: {theme}/{action}/{index}'
                for index in range(len(frames), COLUMNS * ((len(frames) + COLUMNS - 1) // COLUMNS)):
                    x, y = index % COLUMNS * SIZE, index // COLUMNS * SIZE
                    assert decoded.crop((x, y, x + SIZE, y + SIZE)).getchannel('A').getbbox() is None
                clip_spec = dict(file=f'{theme}/{action}.png', columns=COLUMNS,
                    frameCount=len(frames), cellSize=SIZE, durations=durations, sha256=digest(target))
                clip_spec['startsAtIdle'] = frames[0].tobytes() == idle_frame
                clip_spec['startsAtWorking'] = action != 'idle' and frames[0].tobytes() == working_frame
                key = {'idle-alternate': 'idleAlternate', 'idle-transition': 'idleTransition', 'working-transition': 'workingTransition', 'sleep-transition': 'sleepTransition'}.get(action, action)
                result_frame = source.get('resultFrames', {}).get(key)
                if result_frame is not None:
                    assert type(result_frame) is int and 0 <= result_frame < len(frames), f'Result frame: {theme}/{action}'
                    clip_spec['resultFrame'] = result_frame
                upright = source.get('uprightRegions', {}).get(key)
                if upright is not None:
                    assert isinstance(upright, list) and len(upright) == len(frames), f'Symbol frames: {theme}/{action}'
                    assert all(rect is None or (isinstance(rect, list) and len(rect) == 4 and all(type(v) is int for v in rect) and
                        rect[0] >= 0 and rect[1] >= 0 and rect[2] > 0 and rect[3] > 0 and
                        rect[0]+rect[2] <= SIZE and rect[1]+rect[3] <= SIZE) for rect in upright), f'Symbol bounds: {theme}/{action}'
                    clip_spec['uprightRegions'] = upright
                if action in {'idle-transition', 'working-transition', 'sleep-transition'}:
                    target_frame = working_frame
                    if action == 'idle-transition':
                        with Image.open((config_path.parent / source['idleAlternate']).resolve()) as alternate:
                            target_frame = alternate.convert('RGBA').tobytes()
                    elif action == 'sleep-transition':
                        with Image.open((config_path.parent / source['actions']['sleep']).resolve()) as sleeping:
                            target_frame = sleeping.convert('RGBA').tobytes()
                    assert 3 <= len(frames) <= 16 and sum(durations) <= 1500, f'Pose transition timing: {theme}/{action}'
                    assert frames[0].tobytes() == idle_frame and frames[-1].tobytes() == target_frame, f'Pose transition endpoints: {theme}/{action}'
                    theme_manifest[key] = clip_spec
                elif action == 'idle-alternate':
                    assert sum(durations) == sum(theme_manifest['actions']['idle']['durations']), f'Idle duration mismatch: {theme}'
                    theme_manifest['idleAlternate'] = clip_spec
                else:
                    theme_manifest['actions'][action] = clip_spec
                verification[theme][key] = dict(source=str(path), source_sha256=digest(path), atlas_sha256=digest(target),
                    frame_count=len(frames), duration_ms=sum(durations), source_frames_equal_atlas=True,
                    transparent_corners=True, unused_cells_transparent=True,
                    frame_rgba_sha256=[hashlib.sha256(frame.tobytes()).hexdigest() for frame in frames])
                clip_fixture = dict(sourceSha256=digest(path), **({'sourceGifSha256': digest(path)} if gif.format == 'GIF' else {'sourcePngSha256': digest(path)}), durations=durations,
                    frames=verification[theme][key]['frame_rgba_sha256'])
                if action in {'idle-alternate', 'idle-transition', 'working-transition', 'sleep-transition'}:
                    fixture[theme][key] = clip_fixture
                else:
                    fixture[theme]['actions'][action] = clip_fixture
        if theme_manifest.get('idleAlternate'):
            assert sum(theme_manifest['idleAlternate']['durations']) == sum(theme_manifest['actions']['idle']['durations']), f'Idle duration mismatch: {theme}'
        manifest['themes'][theme] = theme_manifest
    for path, before in retained.items():
        assert (digest(path), path.stat().st_mtime_ns) == before, f'Unrelated asset changed: {path}'
    asset_paths = ['assets/sheep/manifest.json']
    # Copy the two approved standalone drag props without touching character atlases.
    for kind, name in (config.get('source_props', {}) if not selected else {}).items():
        assert kind in {'candy', 'gift'}
        source_prop = (config_path.parent / name).resolve()
        with Image.open(source_prop) as image:
            assert image.format == 'PNG' and image.mode == 'RGBA' and image.getchannel('A').getbbox()
        target_prop = OUTPUT / 'props' / f'{kind}.png'
        target_prop.parent.mkdir(parents=True, exist_ok=True)
        if digest(source_prop) != (digest(target_prop) if target_prop.exists() else None):
            shutil.copy2(source_prop, target_prop)
    for kind in ['candy', 'gift']:
        prop = OUTPUT / 'props' / f'{kind}.png'
        assert prop.is_file(), f'Missing offering prop: {kind}'
        asset_paths.append(f'assets/sheep/props/{kind}.png')
    for theme in manifest['themes'].values():
        if theme.get('staticFile'):
            asset_paths.append(f"assets/sheep/{theme['staticFile']}")
        asset_paths.extend(f"assets/sheep/{clip['file']}" for clip in theme['actions'].values())
        if theme.get('idleAlternate'):
            asset_paths.append(f"assets/sheep/{theme['idleAlternate']['file']}")
        if theme.get('idleTransition'):
            asset_paths.append(f"assets/sheep/{theme['idleTransition']['file']}")
        if theme.get('workingTransition'):
            asset_paths.append(f"assets/sheep/{theme['workingTransition']['file']}")
        if theme.get('sleepTransition'):
            asset_paths.append(f"assets/sheep/{theme['sleepTransition']['file']}")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    write_json(OUTPUT / 'manifest.json', manifest)
    write_json(config_path.parent / 'asset-verification.json', verification)
    write_json(config_path.parent / 'asset-paths.json', asset_paths)
    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(fixture_path, fixture)
    print(json.dumps(dict(themes=list(manifest['themes']), selected_clip=only, runtime_files=len(asset_paths),
                          untouched_runtime_pngs=len(retained), verified=True), ensure_ascii=False))


if __name__ == '__main__':
    build(Path(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else None)
