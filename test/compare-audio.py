"""Verify that moving an imported fixture preserves its decoded waveform, allowing output gain."""
import array
import json
import math
import pathlib
import subprocess
import sys

source, bounce = map(lambda value: pathlib.Path(value).resolve(), sys.argv[1:3])
offset_seconds = float(sys.argv[3])
rate = 44100

def decode(path):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(rate), '-f', 'f32le', '-'])
    samples = array.array('f')
    samples.frombytes(raw)
    if sys.byteorder != 'little':
        samples.byteswap()
    return samples

original = decode(source)
rendered = decode(bounce)
start = round(offset_seconds * rate)
excerpt = rendered[start:start + len(original)]
assert len(original) == len(excerpt) and original
xx = sum(value * value for value in original)
yy = sum(value * value for value in excerpt)
xy = sum(left * right for left, right in zip(original, excerpt))
assert xx > 0 and yy > 0
gain = xy / xx
correlation = xy / math.sqrt(xx * yy)
residual = max(abs(right - gain * left) for left, right in zip(original, excerpt))
assert correlation > 0.99999 and residual < 0.00001
print(json.dumps({
    'source': str(source), 'bounce': str(bounce), 'offsetSeconds': offset_seconds,
    'durationSeconds': len(original) / rate, 'correlation': correlation,
    'gain': gain, 'maxResidual': residual, 'passed': True,
}, indent=2))
