"""Bounded, identified audio inputs and output directories outside DAW packages."""
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def integer(value, label, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f'{label} must be an integer >= {minimum}')
    return value


def output_directory(path):
    path = Path(path).resolve()
    if any(p.suffix.lower() in ('.band', '.logicx') for p in (path, *path.parents)):
        raise ValueError('Cannot write inside a DAW project package')
    return path


def write_json(path, data):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('x') as stream:
        stream.write(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + '\n')
    temporary.replace(path)


def read_json(path):
    path = Path(path)
    if path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError('JSON input exceeds 2 MiB')
    return json.loads(path.read_text())


def read_audio(asset, base):
    path = (Path(base) / asset['path']).resolve()
    expected = asset['sha256']
    if not isinstance(expected, str) or len(expected) != 64 or digest(path) != expected:
        raise ValueError(f'Source identity changed: {path.name}')
    probe = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', 'a:0',
        '-show_entries', 'stream=sample_rate,channels,duration', '-of', 'json', str(path)
    ], timeout=15))['streams'][0]
    rate, channels = int(probe['sample_rate']), int(probe['channels'])
    duration = float(probe.get('duration', 0))
    if rate not in (44100, 48000, 88200, 96000) or channels not in (1, 2) or not 0 < duration <= 600:
        raise ValueError('Expected mono/stereo audio up to 600 seconds at a supported native sample rate')
    if duration * rate * channels > 30_000_000:
        raise ValueError('Decoded input exceeds the 30 million sample limit')
    raw = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-xerror', '-protocol_whitelist', 'file,pipe', '-i', str(path),
        '-map', '0:a:0', '-t', '601', '-f', 'f64le', '-'
    ], timeout=120)
    audio = np.frombuffer(raw, dtype='<f8').reshape(-1, channels)
    if not audio.size or audio.size > 30_000_000 or not np.isfinite(audio).all():
        raise ValueError('Invalid decoded audio')
    if digest(path) != expected:
        raise ValueError('Source changed while decoding')
    return path, audio, rate
