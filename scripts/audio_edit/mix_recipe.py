"""Render identified stereo mix recipes without opening or modifying a DAW project."""
import argparse
import json
from pathlib import Path
import unicodedata

import numpy as np

from audio_assets import digest, integer, output_directory, read_audio, read_json, write_json
import onset_engine as engine


def gain(db):
    if isinstance(db, bool) or not isinstance(db, (int, float)) or not np.isfinite(db) or not -120 <= db <= 36:
        raise ValueError('Gain must be finite dB between -120 and 36')
    return 10 ** (db / 20)


def validate_recipe(recipe, base):
    if recipe.get('version') != 1 or recipe.get('sampleRate') not in (44100, 48000, 88200, 96000):
        raise ValueError('Unsupported recipe version or sample rate')
    assets, sources = {}, {}
    if not 1 <= len(recipe.get('assets', [])) <= 16 or not 1 <= len(recipe.get('outputs', [])) <= 16:
        raise ValueError('A recipe needs 1–16 assets and outputs')
    samples = 0
    for asset in recipe['assets']:
        if not isinstance(asset.get('id'), str) or not asset['id'] or asset['id'] in assets:
            raise ValueError('Asset IDs must be nonempty and unique')
        integer(asset.get('projectOriginSample'), 'asset project origin')
        path, audio, rate = read_audio(asset, base)
        if rate != recipe['sampleRate'] or audio.shape != (asset.get('frames'), asset.get('channels')):
            raise ValueError('Asset dimensions or native sample rate changed')
        samples += audio.size
        if samples > 40_000_000:
            raise ValueError('Recipe exceeds the total decoded sample limit')
        assets[asset['id']] = audio
        sources[asset['id']] = (path, asset)
    names, ids = set(), set()
    for output in recipe['outputs']:
        name = output.get('filename', '')
        if not isinstance(name, str) or Path(name).name != name or not name.lower().endswith('.wav') or any(c in name for c in '\\:\x00'):
            raise ValueError('Output filename must be a plain WAV filename')
        normalized = unicodedata.normalize('NFC', name).casefold()
        if normalized in names or not isinstance(output.get('id'), str) or not output['id'] or output['id'] in ids:
            raise ValueError('Output IDs and filenames must be unique')
        names.add(normalized)
        ids.add(output['id'])
        frames = integer(output.get('frames'), 'output frames', 1)
        start = integer(output.get('projectStartSample'), 'output project start')
        fade = integer(output.get('fadeOutSamples', 0), 'fade samples')
        if frames > 30_000_000 or fade == 1 or fade > frames:
            raise ValueError('Invalid output duration or fade')
        gain(output.get('gainDb', 0))
        if not 1 <= len(output.get('terms', [])) <= 32:
            raise ValueError('Each output needs 1–32 terms')
        for term in output['terms']:
            if term.get('asset') not in assets:
                raise ValueError('Unknown input asset')
            audio = assets[term['asset']]
            a = integer(term.get('sourceStart'), 'source start')
            d = integer(term.get('destinationStart'), 'destination start')
            count = integer(term.get('frames'), 'term frames', 1)
            if a + count > len(audio) or d + count > frames:
                raise ValueError('Term exceeds source or output bounds')
            if sources[term['asset']][1]['projectOriginSample'] + a != start + d:
                raise ValueError('Term changes project timing; use an explicitly aligned asset')
            matrix = np.asarray(term.get('matrix'), dtype=float)
            if matrix.shape != (2, audio.shape[1]) or not np.isfinite(matrix).all() or np.max(np.abs(matrix)) > 1:
                raise ValueError('Expected a finite stereo channel matrix with coefficients in [-1, 1]')
            gain(term.get('gainDb', 0))
    return assets, sources


def run_recipe(recipe_path, output=None):
    recipe_path = Path(recipe_path).resolve()
    recipe_hash = digest(recipe_path)
    recipe = read_json(recipe_path)
    destination = None if output is None else output_directory(output)
    assets, sources = validate_recipe(recipe, recipe_path.parent)
    if digest(recipe_path) != recipe_hash or any(digest(path) != asset['sha256'] for path, asset in sources.values()):
        raise ValueError('Recipe or input changed during validation')
    report = {'version': 1, 'recipeSha256': recipe_hash, 'status': 'validated', 'sampleRate': recipe['sampleRate'],
              'sourceHashes': {key: asset['sha256'] for key, (_, asset) in sources.items()},
              'outputs': [], 'projectModified': False, 'listeningRequired': True}
    if destination is None:
        report['outputs'] = [{'id': o['id'], 'filename': o['filename'], 'frames': o['frames']} for o in recipe['outputs']]
        return report
    destination.mkdir(parents=True, exist_ok=False)
    report['status'] = 'rendering'
    write_json(destination / 'receipt.json', report)
    try:
        for item in recipe['outputs']:
            signal = np.zeros((item['frames'], 2))
            for term in item['terms']:
                a, d, count = term['sourceStart'], term['destinationStart'], term['frames']
                signal[d:d + count] += (assets[term['asset']][a:a + count] @ np.asarray(term['matrix']).T) * gain(term.get('gainDb', 0))
            signal *= gain(item.get('gainDb', 0))
            fade = item.get('fadeOutSamples', 0)
            if fade:
                signal[-fade:] *= np.cos(np.linspace(0, np.pi / 2, fade))[:, None] ** 2
                signal[-1] = 0
            path = destination / item['filename']
            engine.write_wav(path, signal, sample_rate=recipe['sampleRate'])
            report['outputs'].append({'id': item['id'], 'path': str(path), 'sha256': digest(path),
                                      'projectStartSample': item['projectStartSample'], 'frames': len(signal),
                                      'peak': float(np.max(np.abs(signal)))})
            write_json(destination / 'receipt.json', report)
        if digest(recipe_path) != recipe_hash or any(digest(path) != asset['sha256'] for path, asset in sources.values()):
            raise ValueError('Recipe or input changed while rendering; output must not be accepted')
        report['status'] = 'completed'
    except Exception as error:
        report.update(status='failed', error=str(error))
        write_json(destination / 'receipt.json', report)
        raise
    write_json(destination / 'receipt.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', required=True)
    parser.add_argument('--output')
    args = parser.parse_args()
    print(json.dumps(run_recipe(args.recipe, args.output)))
