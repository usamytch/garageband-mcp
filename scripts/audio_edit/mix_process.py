"""Measure, process and loudness-match identified audio without changing DAW projects."""
import argparse
import json
from pathlib import Path
import re
import subprocess

import numpy as np

from audio_assets import digest, integer, output_directory, read_audio, read_json, write_json
import onset_engine as engine


def fields(value, required, optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise ValueError(f'Expected fields {required}; optional {optional}')


def number(value, name, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f'{name} must be finite in [{minimum}, {maximum}]')
    return float(value)


def db(value):
    return float(20 * np.log10(value)) if value > 0 else None


def filter_chain(chain, rate):
    if not isinstance(chain, list) or len(chain) > 16:
        raise ValueError('Use at most 16 ordered processing stages')
    result = []
    for stage in chain:
        if not isinstance(stage, dict):
            raise ValueError('Each processing stage must be an object')
        kind = stage.get('type')
        if kind == 'gain':
            fields(stage, ('type', 'gainDb'))
            result.append(f"volume={number(stage['gainDb'], 'gainDb', -60, 24)}dB")
        elif kind in ('highpass', 'lowpass'):
            fields(stage, ('type', 'frequencyHz'))
            frequency = number(stage['frequencyHz'], 'frequencyHz', 20, min(20000, rate * .45))
            result.append(f'{kind}=f={frequency}:p=2')
        elif kind == 'eq':
            fields(stage, ('type', 'frequencyHz', 'q', 'gainDb'))
            frequency = number(stage['frequencyHz'], 'frequencyHz', 20, min(20000, rate * .45))
            q = number(stage['q'], 'q', .1, 20)
            gain = number(stage['gainDb'], 'gainDb', -24, 24)
            result.append(f'equalizer=f={frequency}:t=q:w={q}:g={gain}')
        elif kind == 'compressor':
            fields(stage, ('type', 'thresholdDb', 'ratio', 'attackMs', 'releaseMs'), ('makeupDb', 'mix'))
            threshold = 10 ** (number(stage['thresholdDb'], 'thresholdDb', -60, 0) / 20)
            ratio = number(stage['ratio'], 'ratio', 1, 20)
            attack = number(stage['attackMs'], 'attackMs', .01, 2000)
            release = number(stage['releaseMs'], 'releaseMs', .01, 9000)
            makeup = 10 ** (number(stage.get('makeupDb', 0), 'makeupDb', 0, 24) / 20)
            mix = number(stage.get('mix', 1), 'mix', 0, 1)
            result.append(f'acompressor=threshold={threshold}:ratio={ratio}:attack={attack}:release={release}:makeup={makeup}:mix={mix}:link=maximum:detection=rms')
        elif kind == 'saturation':
            fields(stage, ('type', 'driveDb', 'outputDb'))
            drive = number(stage['driveDb'], 'driveDb', 0, 24)
            output = number(stage['outputDb'], 'outputDb', -60, 0)
            result.extend([f'volume={drive}dB', 'asoftclip=type=tanh:oversample=4', f'volume={output}dB'])
        elif kind == 'deesser':
            fields(stage, ('type', 'intensity', 'maxReduction', 'frequency'))
            intensity = number(stage['intensity'], 'intensity', 0, 1)
            maximum = number(stage['maxReduction'], 'maxReduction', 0, 1)
            frequency = number(stage['frequency'], 'frequency', 0, 1)
            result.append(f'deesser=i={intensity}:m={maximum}:f={frequency}:s=o')
        else:
            raise ValueError(f'Unsupported processing stage: {kind}')
    return ','.join(result) or 'anull'


def ffmpeg(audio, rate, graph, measurement=False):
    args = ['ffmpeg', '-hide_banner', '-nostdin', '-v', 'info' if measurement else 'error',
            '-xerror', '-filter_threads', '1', '-f', 'f64le', '-ar', str(rate), '-ac', str(audio.shape[1]),
            '-i', 'pipe:0', '-af', graph]
    args += ['-f', 'null', '-'] if measurement else ['-f', 'f64le', '-']
    result = subprocess.run(args, input=np.asarray(audio, dtype='<f8').tobytes(), capture_output=True, timeout=180)
    if result.returncode:
        raise ValueError('FFmpeg failed: ' + result.stderr.decode(errors='replace')[-3000:])
    if measurement:
        matches = re.findall(r'\{\s*"input_i".*?\}', result.stderr.decode(errors='replace'), re.S)
        if len(matches) != 1:
            raise ValueError('FFmpeg loudness measurement was unavailable')
        values = json.loads(matches[0])
        def finite(key):
            value = float(values[key])
            return value if np.isfinite(value) else None
        return {'integratedLufs': finite('input_i'), 'truePeakDbtp': finite('input_tp'),
                'loudnessRangeLu': finite('input_lra'), 'gateThresholdLufs': finite('input_thresh'),
                'method': 'FFmpeg loudnorm input measurements; no normalization applied'}
    signal = np.frombuffer(result.stdout, dtype='<f8').reshape(-1, audio.shape[1])
    if signal.shape != audio.shape or not np.isfinite(signal).all():
        raise ValueError('Processing changed the frame/channel count or produced nonfinite samples')
    return signal


def meter(audio, rate):
    peaks = np.max(np.abs(audio), axis=0)
    rms = np.sqrt(np.mean(audio ** 2, axis=0))
    report = {'frames': len(audio), 'channels': audio.shape[1], 'sampleRate': rate,
              'samplePeakDbfs': [db(value) for value in peaks], 'rmsDbfs': [db(value) for value in rms],
              'crestDb': [db(p / r) if r else None for p, r in zip(peaks, rms)],
              'fullScaleSamples': [int(v) for v in np.sum(np.abs(audio) >= 1, axis=0)],
              'dcOffset': np.mean(audio, axis=0).tolist(),
              'loudness': ffmpeg(audio, rate, 'loudnorm=I=-23:TP=-1:LRA=7:print_format=json', True)}
    # Below-gate silence is not meaningful programme loudness (loudnorm can report -70).
    if float(np.max(peaks)) < 1e-8 or report['loudness']['integratedLufs'] is not None and report['loudness']['integratedLufs'] <= -70:
        report['loudness']['integratedLufs'] = None
    if audio.shape[1] == 2:
        centered = audio - np.mean(audio, axis=0)
        norms = np.sqrt(np.sum(centered ** 2, axis=0))
        correlation = float(np.sum(centered[:, 0] * centered[:, 1]) / np.prod(norms)) if np.prod(norms) > 1e-20 else None
        mono = np.mean(audio, axis=1)
        side = (audio[:, 0] - audio[:, 1]) / 2
        base = np.sqrt(np.mean(audio ** 2))
        report['stereo'] = {'correlation': correlation, 'monoRmsDbfs': db(np.sqrt(np.mean(mono ** 2))),
                            'sideRmsDbfs': db(np.sqrt(np.mean(side ** 2))),
                            'monoFoldChangeDb': db(np.sqrt(np.mean(mono ** 2)) / base) if base else None,
                            'monoIsSilent': bool(np.max(np.abs(mono)) < 1e-8)}
    return report


def load_asset(asset, base):
    fields(asset, ('path', 'sha256'))
    if not isinstance(asset['path'], str) or not asset['path'] or not isinstance(asset['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', asset['sha256']):
        raise ValueError('Use a local audio path and lowercase SHA-256')
    return read_audio(asset, base)


def run_request(request_path, output=None):
    request_path = Path(request_path).resolve()
    request_hash = digest(request_path)
    request = read_json(request_path)
    fields(request, ('version', 'mode', 'source', 'projectOriginSample'), ('chain', 'reference', 'referenceProjectOriginSample'))
    if type(request['version']) is not int or request['version'] != 1 or request['mode'] not in ('analyze', 'process', 'compare'):
        raise ValueError('Expected version 1 and mode analyze, process or compare')
    origin = integer(request['projectOriginSample'], 'projectOriginSample')
    mode = request['mode']
    if (mode == 'process') != ('chain' in request) or (mode == 'compare') != ('reference' in request) or (mode == 'compare') != ('referenceProjectOriginSample' in request):
        raise ValueError('chain belongs to process; reference and its origin belong to compare')
    destination = None if output is None else output_directory(output)
    if destination is not None and destination.exists():
        raise FileExistsError(destination)
    source, audio, rate = load_asset(request['source'], request_path.parent)
    graph = filter_chain(request['chain'], rate) if mode == 'process' else None
    reference, reference_audio = None, None
    if mode == 'compare':
        reference_origin = integer(request['referenceProjectOriginSample'], 'referenceProjectOriginSample')
        reference, reference_audio, reference_rate = load_asset(request['reference'], request_path.parent)
        if reference_rate != rate or reference_audio.shape != audio.shape or origin != reference_origin:
            raise ValueError('A/B requires the same sample rate, channels, frame count and project origin; align excerpts explicitly')
    def verify_inputs():
        if digest(request_path) != request_hash or digest(source) != request['source']['sha256'] or reference and digest(reference) != request['reference']['sha256']:
            raise ValueError('Request or source changed; output must not be accepted')
    verify_inputs()
    report = {'version': 1, 'mode': mode, 'status': 'validated', 'requestSha256': request_hash,
              'sourceSha256': request['source']['sha256'], 'projectOriginSample': origin,
              'projectModified': False, 'listeningPerformed': False, 'outputs': [],
              'ffmpegVersion': subprocess.check_output(['ffmpeg', '-version'], timeout=10).decode().splitlines()[0]}
    if mode == 'process':
        report.update(chain=request['chain'], filterGraph=graph)
    if destination is None:
        if mode == 'analyze':
            report.update(status='analyzed', measurement=meter(audio, rate))
        verify_inputs()
        return report
    destination.mkdir(parents=True, exist_ok=False)
    report['status'] = 'running'
    write_json(destination / 'receipt.json', report)
    try:
        report['before'] = meter(audio, rate)
        signals = []
        if mode == 'process':
            processed = ffmpeg(audio, rate, graph)
            if np.max(np.abs(processed)) >= 1:
                raise ValueError('Processing would clip; reduce explicit gain, no automatic normalization applied')
            report['after'] = meter(processed, rate)
            signals = [('processed.wav', processed)]
        elif mode == 'compare':
            report['referenceSha256'] = request['reference']['sha256']
            report['reference'] = meter(reference_audio, rate)
            a = report['before']['loudness']['integratedLufs']
            b = report['reference']['loudness']['integratedLufs']
            if a is None or b is None:
                raise ValueError('Loudness matching requires measurable non-silent programme material')
            target = min(a, b)
            report['match'] = {'targetLufs': target, 'sourceGainDb': target - a, 'referenceGainDb': target - b,
                               'method': 'constant attenuation only; input programme loudness, no limiting'}
            signals = [('A-source.wav', audio * 10 ** ((target - a) / 20)),
                       ('B-reference.wav', reference_audio * 10 ** ((target - b) / 20))]
            measurements = {name: meter(signal, rate) for name, signal in signals}
            measured_a = measurements['A-source.wav']['loudness']['integratedLufs']
            measured_b = measurements['B-reference.wav']['loudness']['integratedLufs']
            difference = None if measured_a is None or measured_b is None else abs(measured_a - measured_b)
            report['match'].update(measurements=measurements, differenceLu=difference, toleranceLu=.2,
                                   verified=difference is not None and difference <= .2)
            if not report['match']['verified']:
                raise ValueError('Loudness matching failed after measurement; gating changed programme loudness. Use different aligned excerpts or inspect the quiet material')
        for name, signal in signals:
            if np.max(np.abs(signal)) >= 1:
                raise ValueError('Preview would clip; inspect the input instead of silently limiting it')
            path = destination / name
            engine.write_wav(path, signal, sample_rate=rate)
            report['outputs'].append({'path': str(path), 'sha256': digest(path), 'frames': len(signal),
                                      'sampleRate': rate, 'channels': signal.shape[1], 'projectOriginSample': origin})
        verify_inputs()
        report['status'] = 'completed'
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
