"""Decode real GarageBand bounces, check silence/signal, and report basic audio metrics."""
import array
import json
import math
import pathlib
import subprocess
import sys

reports = []
for filename in sys.argv[1:]:
    path = pathlib.Path(filename).resolve()
    info = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)
    ]))
    stream = info['streams'][0]
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-acodec', 'pcm_f32le', '-'])
    samples = array.array('f')
    samples.frombytes(raw)
    if sys.byteorder != 'little':
        samples.byteswap()
    assert samples and all(math.isfinite(value) for value in samples), str(path)
    peak = max(abs(value) for value in samples)
    rms = math.sqrt(sum(value * value for value in samples) / len(samples))
    silent = path.stem.lower() == 'muted'
    assert (peak == 0) if silent else (peak > 0), str(path)
    assert peak < 1, str(path)
    rate, channels = int(stream['sample_rate']), int(stream['channels'])
    frame_peaks = [max(abs(value) for value in samples[index:index + channels]) for index in range(0, len(samples), channels)]
    active = [index for index, value in enumerate(frame_peaks) if value > 0.0001]
    reports.append({
        'file': str(path), 'codec': stream['codec_name'], 'sampleRate': rate, 'channels': channels,
        'durationSec': len(frame_peaks) / rate, 'peak': peak, 'rms': rms,
        'peakDbFS': 20 * math.log10(peak) if peak else None,
        'rmsDbFS': 20 * math.log10(rms) if rms else None,
        'exactSilence': peak == 0,
        'signalStartSec': active[0] / rate if active else None,
        'signalEndSec': active[-1] / rate if active else None,
    })
print(json.dumps(reports, indent=2))
