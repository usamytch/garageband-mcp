"""Identified mono-vocal analysis, reviewed transposition and spectral vocoding."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

import numpy as np

from audio_assets import digest, integer, output_directory, read_audio, read_json, write_json
from onset_engine import write_wav


RATES = (44100, 48000, 88200, 96000)


def fields(value, allowed, required, label):
    if not isinstance(value, dict) or set(value) - set(allowed) or set(required) - set(value):
        raise ValueError(f'Invalid or unknown {label} fields')


def number(value, label, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{label} must be finite in [{low}, {high}]')
    return float(value)


def validate(request, base):
    fields(request, ('version', 'mode', 'asset', 'analysis', 'tune', 'vocoder', 'gainDb'),
           ('version', 'mode', 'asset'), 'request')
    if type(request['version']) is not int or request['version'] != 1 or request['mode'] not in ('analyze', 'tune', 'vocoder'):
        raise ValueError('Expected version 1 and mode analyze, tune or vocoder')
    mode = request['mode']
    if any(name in request for name in ('analysis', 'tune', 'vocoder') if name != ('analysis' if mode == 'analyze' else mode)):
        raise ValueError('Parameters for another mode are not accepted')
    asset = request['asset']
    fields(asset, ('path', 'sha256', 'frames', 'channels', 'sampleRate', 'projectOriginSample'),
           ('path', 'sha256', 'frames', 'channels', 'sampleRate', 'projectOriginSample'), 'asset')
    if not isinstance(asset['path'], str) or not asset['path']:
        raise ValueError('Asset path must be nonempty')
    integer(asset['frames'], 'frames', 2)
    integer(asset['projectOriginSample'], 'project origin')
    if type(asset['channels']) is not int or asset['channels'] != 1 or type(asset['sampleRate']) is not int or asset['sampleRate'] not in RATES:
        raise ValueError('Vocal processing requires identified mono audio at its native supported sample rate')
    if asset['frames'] > 120 * asset['sampleRate']:
        raise ValueError('Use reviewed excerpts up to 120 seconds')
    number(request.get('gainDb', 0), 'gainDb', -60, 24)
    if mode == 'analyze':
        if request.get('gainDb', 0) != 0:
            raise ValueError('Analysis does not apply gain')
        config = request.get('analysis', {})
        fields(config, ('minHz', 'maxHz', 'hopMs', 'confidence', 'gateDb'), (), 'analysis')
        low = number(config.get('minHz', 65), 'minHz', 50, 1000)
        high = number(config.get('maxHz', 1000), 'maxHz', 80, 2000)
        if high <= low:
            raise ValueError('maxHz must exceed minHz')
        hop_ms = number(config.get('hopMs', 20), 'hopMs', 10, 100)
        if np.ceil(asset['frames'] / max(1, round(asset['sampleRate'] * hop_ms / 1000))) > 6000:
            raise ValueError('Analysis exceeds 6000 frames; increase hopMs or use a shorter excerpt')
        number(config.get('confidence', .8), 'confidence', .5, .99)
        number(config.get('gateDb', -55), 'gateDb', -100, -10)
    elif mode == 'tune':
        config = request.get('tune')
        fields(config, ('backend', 'regions'), ('backend', 'regions'), 'tune')
        if config['backend'] not in ('ffmpeg-atempo', 'rubberband', 'rubberband-cli'):
            raise ValueError('Explicit backend must be ffmpeg-atempo, rubberband or rubberband-cli; no silent fallback')
        if not isinstance(config['regions'], list) or not 1 <= len(config['regions']) <= 16:
            raise ValueError('Expected 1–16 reviewed tune regions')
        previous = 0
        for region in config['regions']:
            fields(region, ('startSample', 'endSample', 'semitones', 'fadeSamples'),
                   ('startSample', 'endSample', 'semitones', 'fadeSamples'), 'tune region')
            start = integer(region['startSample'], 'region start')
            end = integer(region['endSample'], 'region end', 1)
            fade = integer(region['fadeSamples'], 'fade samples', 2)
            number(region['semitones'], 'semitones', -12, 12)
            if start < previous or end > asset['frames'] or end - start < max(2 * fade, asset['sampleRate'] // 20):
                raise ValueError('Tune regions must be ordered, disjoint, inside source and at least 50 ms with two fades')
            previous = end
    else:
        config = request.get('vocoder')
        fields(config, ('bands', 'minHz', 'maxHz', 'attackMs', 'releaseMs', 'wet', 'events'), ('events',), 'vocoder')
        bands = integer(config.get('bands', 20), 'bands', 8)
        if bands > 48:
            raise ValueError('At most 48 vocoder bands')
        low = number(config.get('minHz', 100), 'minHz', 60, 1000)
        high = number(config.get('maxHz', 8000), 'maxHz', 2000, 16000)
        if high <= low or high >= asset['sampleRate'] / 2:
            raise ValueError('Invalid vocoder band range')
        number(config.get('attackMs', 5), 'attackMs', 1, 100)
        number(config.get('releaseMs', 60), 'releaseMs', 5, 500)
        number(config.get('wet', 1), 'wet', 0, 1)
        if not isinstance(config['events'], list) or not 1 <= len(config['events']) <= 128:
            raise ValueError('Expected 1–128 carrier chord events')
        previous = 0
        for event in config['events']:
            fields(event, ('startSample', 'endSample', 'notes'), ('startSample', 'endSample', 'notes'), 'carrier event')
            start = integer(event['startSample'], 'event start')
            end = integer(event['endSample'], 'event end', 1)
            notes = event['notes']
            if start < previous or end <= start or end > asset['frames']:
                raise ValueError('Carrier events must be ordered, disjoint and inside source')
            if not isinstance(notes, list) or not 1 <= len(notes) <= 8 or any(type(n) is not int or not 24 <= n <= 96 for n in notes) or len(set(notes)) != len(notes):
                raise ValueError('Carrier chord needs 1–8 unique integer MIDI notes in [24, 96]')
            previous = end
    path, audio, rate = read_audio(asset, base)
    if rate != asset['sampleRate'] or audio.shape != (asset['frames'], 1):
        raise ValueError('Asset dimensions or native sample rate changed')
    return path, audio[:, 0], rate


def analyze_pitch(audio, rate, config):
    """Normalized autocorrelation candidates, not a transcription or tuning decision."""
    low, high = config.get('minHz', 65), config.get('maxHz', 1000)
    hop = round(rate * config.get('hopMs', 20) / 1000)
    size = max(round(rate * .06), int(np.ceil(4 * rate / low)))
    size += size % 2
    minimum, maximum = max(2, int(np.floor(rate / high))), int(np.ceil(rate / low))
    threshold, gate = config.get('confidence', .8), 10 ** (config.get('gateDb', -55) / 20)
    fft_size = 1 << (2 * size - 1).bit_length()
    rows = []
    for center in range(0, len(audio), hop):
        start, end = max(0, center - size // 2), min(len(audio), center + size // 2)
        x = audio[start:end].astype(float)
        rms = float(np.sqrt(np.mean(x * x)))
        row = {'sample': center, 'rmsDb': None if rms == 0 else float(20 * np.log10(rms)),
               'hz': None, 'midi': None, 'confidence': 0.0, 'voiced': False}
        if rms < gate or len(x) <= 2 * maximum:
            rows.append(row)
            continue
        x -= x.mean()
        spectrum = np.fft.rfft(x, n=fft_size)
        ac = np.fft.irfft(spectrum * spectrum.conj(), n=fft_size)[:maximum + 2]
        energy = np.r_[0, np.cumsum(x * x)]
        lags = np.arange(len(ac))
        denom = np.sqrt(np.maximum(energy[len(x) - lags] * (energy[len(x)] - energy[lags]), 1e-30))
        corr = np.clip(ac / denom, -1, 1)
        peaks = [i for i in range(minimum, maximum + 1) if corr[i] >= corr[i - 1] and corr[i] > corr[i + 1]]
        if peaks:
            best = max(corr[i] for i in peaks)
            lag = next(i for i in peaks if corr[i] >= max(threshold, best * .95)) if best >= threshold else max(peaks, key=lambda i: corr[i])
            confidence = float(corr[lag])
            row['confidence'] = confidence
            if confidence >= threshold:
                denominator = corr[lag - 1] - 2 * corr[lag] + corr[lag + 1]
                correction = .5 * (corr[lag - 1] - corr[lag + 1]) / denominator if abs(denominator) > 1e-12 else 0
                frequency = rate / (lag + float(np.clip(correction, -.5, .5)))
                if low <= frequency <= high:
                    row.update(hz=float(frequency), midi=float(69 + 12 * np.log2(frequency / 440)), voiced=True)
        rows.append(row)
    voiced = [row['hz'] for row in rows if row['voiced']]
    return {'frames': rows, 'voicedFraction': len(voiced) / len(rows),
            'medianHz': float(np.median(voiced)) if voiced else None,
            'analysisWindowSamples': size, 'hopSamples': hop,
            'confidenceMeaning': 'normalized periodicity, not probability of a correct musical note',
            'limitations': ['Monophonic clean pitched input only; polyphony is not detected or separated.',
                            'Octave ambiguity, vibrato and note transitions require review; speech and screams are not automatic tuning targets.',
                            'No key inference, lyric alignment, note segmentation or automatic correction is performed.']}


def pitch_backend(name):
    if name == 'rubberband-cli':
        executable = shutil.which('rubberband')
        if not executable:
            raise ValueError('Rubber Band CLI is not installed on PATH; no fallback was applied')
        help_result = subprocess.run([executable, '--full-help'], stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, timeout=15, check=False)
        help_text = help_result.stdout.decode(errors='replace')
        if help_result.returncode not in (0, 2) or any(option not in help_text for option in ('--fine', '--formant', '--pitch', '--ignore-clipping')):
            raise ValueError('Rubber Band CLI does not advertise required options; no fallback was applied')
        version = subprocess.check_output([executable, '--version'], stderr=subprocess.STDOUT, timeout=15).decode().strip()
        if not version or len(version) > 1000:
            raise ValueError('Could not verify Rubber Band CLI version')
        return {'executable': executable, 'version': version}
    filters = subprocess.check_output(['ffmpeg', '-hide_banner', '-filters'], stderr=subprocess.STDOUT, timeout=15).decode()
    required = ('rubberband',) if name == 'rubberband' else ('asetrate', 'aresample', 'atempo')
    if any(not any(line.split()[1:2] == [item] for line in filters.splitlines()) for item in required):
        raise ValueError(f'FFmpeg does not provide the requested {name} backend; no fallback was applied')


def transpose_cli(audio, rate, semitones, scratch_parent):
    if scratch_parent is None:
        raise ValueError('Rubber Band CLI requires a visible scratch directory inside the new output directory')
    scratch_parent = output_directory(scratch_parent)
    if not scratch_parent.is_dir():
        raise ValueError('Scratch parent must already exist')
    backend = pitch_backend('rubberband-cli')
    with tempfile.TemporaryDirectory(prefix='rubberband-', dir=scratch_parent) as temporary:
        temporary = Path(temporary)
        source, target = temporary / 'input.wav', temporary / 'output.wav'
        subprocess.run([
            'ffmpeg', '-v', 'error', '-xerror', '-n', '-f', 'f64le', '-ar', str(rate), '-ac', '1', '-i', 'pipe:0',
            '-c:a', 'pcm_f32le', str(source)
        ], input=audio.astype('<f8').tobytes(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=True)
        source_hash = digest(source)
        subprocess.run([
            backend['executable'], '--fine', '--formant', '--ignore-clipping', '--quiet',
            '--time', '1', '--pitch', str(semitones), str(source), str(target)
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=True)
        if digest(source) != source_hash or not target.is_file():
            raise ValueError('Rubber Band CLI changed its derived input or did not create output')
        target_hash = digest(target)
        metadata = json.loads(subprocess.check_output([
            'ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name',
            '-of', 'json', str(target)
        ], timeout=15))
        if metadata['streams'][0]['codec_name'] not in ('pcm_f32le', 'pcm_f64le'):
            raise ValueError('Rubber Band CLI output must be floating point so clipping remains detectable')
        _, result, target_rate = read_audio({'path': str(target), 'sha256': target_hash}, temporary)
        if target_rate != rate or result.shape[1] != 1:
            raise ValueError('Rubber Band CLI changed sample rate or channel count')
        return result[:, 0].copy(), {'version': backend['version'], 'engine': 'R3 fine',
                                    'derivedInputSha256': source_hash, 'derivedOutputSha256': target_hash,
                                    'automaticGainReduction': False}


def transpose(audio, rate, semitones, backend, scratch_parent=None):
    if semitones == 0:
        return audio.copy(), {'backend': 'identity', 'actualSemitones': 0.0}
    ratio = 2 ** (semitones / 12)
    if backend == 'rubberband':
        chain = f'rubberband=tempo=1:pitch={ratio:.12g}:formant=preserved'
        actual = semitones
    elif backend == 'ffmpeg-atempo':
        shifted_rate = round(rate * ratio)
        actual_ratio = shifted_rate / rate
        chain = f'asetrate={shifted_rate},aresample={rate},atempo={1 / actual_ratio:.12g}'
        actual = 12 * np.log2(actual_ratio)
    # Reflection is only DSP context. It is cropped away, never substituted for missing active output.
    context = rate // 2
    padded = np.pad(audio, (context, context), mode='reflect')
    extra = {}
    if backend == 'rubberband-cli':
        rendered, extra = transpose_cli(padded, rate, semitones, scratch_parent)
        actual = semitones
    else:
        data = subprocess.run([
            'ffmpeg', '-v', 'error', '-xerror', '-f', 'f64le', '-ar', str(rate), '-ac', '1', '-i', 'pipe:0',
            '-af', chain, '-f', 'f64le', 'pipe:1'
        ], input=padded.astype('<f8').tobytes(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=True).stdout
        rendered = np.frombuffer(data, dtype='<f8')
    if len(rendered) < context + len(audio) or not np.isfinite(rendered).all():
        raise ValueError('Pitch backend returned short or nonfinite audio; active output was not padded')
    # Rubber Band CLI can clamp float output even with --ignore-clipping.
    # Check all context before cropping or final gain can hide the clipped samples.
    if np.any(np.abs(rendered) >= 1):
        raise ValueError('Pitch backend reached full scale; possible clipping was not hidden by cropping or gain')
    return rendered[context:context + len(audio)].copy(), {
        'backend': backend, 'actualSemitones': float(actual), 'contextSamples': context,
        'formants': 'preservation requested from rubberband, listening required' if backend.startswith('rubberband') else 'not preserved',
        'timing': 'output length retained; internal consonant/transient timing can change', **extra}


def tune_audio(audio, rate, config, scratch_parent=None):
    result, regions = audio.copy(), []
    if any(item['semitones'] != 0 for item in config['regions']):
        pitch_backend(config['backend'])
    for item in config['regions']:
        a, b, fade = item['startSample'], item['endSample'], item['fadeSamples']
        if item['semitones'] == 0:
            regions.append({**item, 'backend': 'identity', 'actualSemitones': 0.0})
            continue
        context = rate // 2
        left, right = max(0, a - context), min(len(audio), b + context)
        shifted, info = transpose(audio[left:right], rate, item['semitones'], config['backend'], scratch_parent)
        replacement = shifted[a - left:b - left]
        weight = np.ones(b - a)
        weight[:fade] = np.sin(np.linspace(0, np.pi / 2, fade)) ** 2
        weight[-fade:] = np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
        result[a:b] = audio[a:b] * (1 - weight) + replacement * weight
        regions.append({**item, **info})
    return result, regions


def carrier_audio(frames, rate, events):
    carrier = np.zeros(frames)
    for event in events:
        a, b = event['startSample'], event['endSample']
        t = np.arange(a, b) / rate
        chord = np.zeros(b - a)
        for note in event['notes']:
            frequency = 440 * 2 ** ((note - 69) / 12)
            phase = np.remainder(t * frequency, 1)
            dt = frequency / rate
            wave = 2 * phase - 1
            early = phase < dt
            late = phase > 1 - dt
            q = phase[early] / dt
            wave[early] -= 2 * q - q * q - 1
            q = (phase[late] - 1) / dt
            wave[late] -= q * q + 2 * q + 1
            chord += wave / len(event['notes'])
        fade = min(round(.005 * rate), len(chord) // 2)
        if fade > 1:
            chord[:fade] *= np.sin(np.linspace(0, np.pi / 2, fade)) ** 2
            chord[-fade:] *= np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
        carrier[a:b] = chord
    return carrier


def vocode(audio, rate, config):
    wet = config.get('wet', 1)
    if wet == 0:
        return audio.copy()
    carrier = carrier_audio(len(audio), rate, config['events'])
    size = 2048 if rate <= 48000 else 4096
    hop = size // 4
    half = size // 2
    window = np.hanning(size)
    # Centred windows remove the fixed processing latency; boundaries use analysis padding only.
    source = np.pad(audio, (half, size))
    carrier = np.pad(carrier, (half, size))
    result, norm = np.zeros(len(source)), np.zeros(len(source))
    frequencies = np.fft.rfftfreq(size, 1 / rate)
    edges = np.geomspace(config.get('minHz', 100), config.get('maxHz', 8000), config.get('bands', 20) + 2)
    weights = np.array([np.maximum(0, np.minimum((frequencies - a) / (b - a), (c - frequencies) / (c - b)))
                        for a, b, c in zip(edges[:-2], edges[1:-1], edges[2:])])
    coverage = weights.sum(axis=0)
    weights[:, coverage > 0] /= coverage[coverage > 0]
    attack = np.exp(-hop / (rate * config.get('attackMs', 5) / 1000))
    release = np.exp(-hop / (rate * config.get('releaseMs', 60) / 1000))
    envelope = np.zeros(len(weights))
    for a in range(0, len(source) - size + 1, hop):
        modulator = np.fft.rfft(source[a:a + size] * window)
        synth = np.fft.rfft(carrier[a:a + size] * window)
        target = np.sqrt(weights @ (np.abs(modulator) ** 2))
        smoothing = np.where(target > envelope, attack, release)
        envelope = smoothing * envelope + (1 - smoothing) * target
        carrier_levels = np.sqrt(weights @ (np.abs(synth) ** 2))
        ratios = np.minimum(envelope / np.maximum(carrier_levels, 1e-9), 100)
        spectrum = synth * (ratios @ weights)
        result[a:a + size] += np.fft.irfft(spectrum, n=size) * window
        norm[a:a + size] += window * window
    signal = result[half:half + len(audio)] / np.maximum(norm[half:half + len(audio)], 1e-9)
    return (1 - wet) * audio + wet * signal


def run_request(request_path, output=None):
    request_path = Path(request_path).resolve()
    request_hash = digest(request_path)
    request = read_json(request_path)
    destination = None if output is None else output_directory(output)
    source, audio, rate = validate(request, request_path.parent)
    if digest(request_path) != request_hash or digest(source) != request['asset']['sha256']:
        raise ValueError('Request or source changed during validation')
    mode = request['mode']
    if mode == 'tune' and any(item['semitones'] != 0 for item in request['tune']['regions']):
        pitch_backend(request['tune']['backend'])
    report = {'version': 1, 'mode': mode, 'status': 'validated', 'requestSha256': request_hash,
              'sourceSha256': request['asset']['sha256'], 'sampleRate': rate, 'frames': len(audio),
              'projectOriginSample': request['asset']['projectOriginSample'], 'projectModified': False,
              'listeningRequired': True, 'analysis': None, 'output': None}
    if destination is None:
        if mode == 'analyze':
            report['analysis'] = analyze_pitch(audio, rate, request.get('analysis', {}))
            report['status'] = 'analyzed'
        if digest(source) != request['asset']['sha256'] or digest(request_path) != request_hash:
            raise ValueError('Source or request changed during analysis')
        return report
    destination.mkdir(parents=True, exist_ok=False)
    write_json(destination / 'receipt.json', report)
    try:
        if mode == 'analyze':
            report['analysis'] = analyze_pitch(audio, rate, request.get('analysis', {}))
            report['status'] = 'analyzed'
        else:
            if mode == 'tune':
                result, report['regions'] = tune_audio(audio, rate, request['tune'], destination)
                report['quality'] = 'reviewed constant transposition; not automatic note correction'
            else:
                result = vocode(audio, rate, request['vocoder'])
                report['quality'] = 'experimental spectral filter-bank vocoder with explicit MIDI chord carrier'
            result *= 10 ** (request.get('gainDb', 0) / 20)
            if result.shape != audio.shape or not np.isfinite(result).all():
                raise ValueError('Output timeline or samples are invalid')
            target = destination / 'vocal.wav'
            write_wav(target, result, sample_rate=rate)
            report['output'] = {'path': str(target), 'sha256': digest(target), 'frames': len(result),
                                'sampleRate': rate, 'channels': 1, 'projectOriginSample': request['asset']['projectOriginSample'],
                                'peak': float(np.max(np.abs(result))), 'gainDb': request.get('gainDb', 0)}
            report['status'] = 'completed'
        if digest(source) != request['asset']['sha256'] or digest(request_path) != request_hash:
            raise ValueError('Source or request changed during processing; output must not be accepted')
    except Exception as error:
        report.update(status='failed', error=str(error))
        write_json(destination / 'receipt.json', report)
        raise
    write_json(destination / 'receipt.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', required=True)
    parser.add_argument('--output')
    args = parser.parse_args()
    print(json.dumps(run_request(args.request, args.output), allow_nan=False))
