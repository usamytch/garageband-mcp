"""Read-only, per-channel join diagnostics with explicit source/project coordinates."""
import argparse
from pathlib import Path

import numpy as np

from audio_assets import digest, integer, output_directory, read_audio, read_json, write_json
import onset_engine as engine
from quality import runs


def channels(audio):
    audio = np.asarray(audio, dtype=float)
    if audio.ndim == 1:
        audio = audio[:, None]
    if audio.ndim != 2 or not audio.size or not np.isfinite(audio).all():
        raise ValueError('Expected nonempty finite audio channels')
    return audio


def review_joins(candidate, sample_rate, joins, reference=None, protected=(), project_origin_seconds=0):
    candidate = channels(candidate)
    reference = None if reference is None else channels(reference)
    integer(sample_rate, 'sample rate', 1)
    if reference is not None and reference.shape[1] != candidate.shape[1]:
        raise ValueError('Reference channels differ')
    if not np.isfinite(project_origin_seconds) or project_origin_seconds < 0:
        raise ValueError('Invalid project origin')
    if len(joins) > 512 or len(protected) > 512:
        raise ValueError('At most 512 joins and protected phrases per review')
    findings, details = [], []
    seen = set()

    def finding(kind, sample, end, channel, label):
        key = (kind, sample, end, channel)
        if key not in seen:
            seen.add(key)
            findings.append({'kind': kind, 'sample': sample, 'endSample': end, 'channel': channel,
                             'projectSeconds': project_origin_seconds + sample / sample_rate, 'label': label})

    half = max(2, round(.025 * sample_rate))
    zero_runs = [runs(np.abs(candidate[:, c]) < 1e-8, max(2, round(.001 * sample_rate)))
                 for c in range(candidate.shape[1])]
    for join in joins:
        point = integer(join.get('sample'), 'join sample')
        if point > len(candidate):
            raise ValueError('Join is outside the file')
        label = str(join.get('label', 'join'))
        start, end = max(0, point - half), min(len(candidate), point + half)
        details.append({'sample': point, 'label': label, 'projectSeconds': project_origin_seconds + point / sample_rate,
                        'windowSamples': [start, end], 'contextClipped': start == 0 or end == len(candidate)})
        for channel in range(candidate.shape[1]):
            signal = candidate[:, channel]
            before = signal[point - 1] if point else 0
            after = signal[point] if point < len(signal) else 0
            difference = abs(after - before)
            local = np.abs(np.diff(signal[start:end]))
            # Exclude the seam itself when estimating the surrounding musical slopes.
            local = np.delete(local, point - start - 1) if 0 < point - start <= len(local) else local
            limit = max(.002, float(np.percentile(local, 99)) * 6 if local.size else 0)
            same_attack = False
            if reference is not None and len(reference) == len(candidate):
                ref_before = reference[point - 1, channel] if point else 0
                ref_after = reference[point, channel] if point < len(signal) else 0
                same_attack = abs((after - before) - (ref_after - ref_before)) <= 2 ** -23
            if difference > limit and not same_attack:
                finding('discontinuity', point, point, channel + 1, label)
            for a, b in runs(np.abs(signal[start:end]) >= 1):
                finding('clipping', start + a, start + b, channel + 1, label)
            # Keep the real surrounding context, including the edges of a review window.
            for a, b in zero_runs[channel]:
                if a >= end or b <= start:
                    continue
                if reference is not None and len(reference) == len(candidate):
                    active = float(np.sqrt(np.mean(reference[a:b, channel] ** 2))) > .001
                else:
                    left, right = signal[max(0, a - half):a], signal[b:min(len(signal), b + half)]
                    active = bool(left.size and right.size and min(np.sqrt(np.mean(left ** 2)), np.sqrt(np.mean(right ** 2))) > .001)
                if active:
                    finding('dropout', a, b, channel + 1, label)
    for phrase in protected:
        a = integer(phrase.get('start'), 'protected start')
        b = integer(phrase.get('end'), 'protected end', 1)
        source = integer(phrase.get('referenceStart', a), 'reference start')
        if reference is None or b <= a or b > len(candidate) or source + b - a > len(reference):
            raise ValueError('Protected phrase requires valid candidate and reference ranges')
        for channel in range(candidate.shape[1]):
            if not np.allclose(candidate[a:b, channel], reference[source:source + b - a, channel], atol=2 ** -23, rtol=0):
                finding('protected_phrase_changed', a, b, channel + 1, str(phrase.get('label', 'protected phrase')))
    return {'version': 1, 'status': 'review_required' if findings else 'no_findings', 'sampleRate': sample_rate,
            'frames': len(candidate), 'joins': details, 'findings': findings, 'listeningRequired': True,
            'thresholds': {'jumpFloor': .002, 'localSlopeFactor': 6, 'contextSeconds': .025,
                           'zeroAmplitude': 1e-8, 'activeRms': .001, 'minimumDropoutSeconds': .001},
            'scope': 'listed joins and explicitly protected phrases; not a whole-file listening verdict'}


def run_review(request_path, output):
    request_path = Path(request_path).resolve()
    request = read_json(request_path)
    if request.get('version') != 1:
        raise ValueError('Expected join review version 1')
    source, candidate, rate = read_audio(request['candidate'], request_path.parent)
    reference, reference_path = None, None
    if request.get('reference'):
        reference_path, reference, ref_rate = read_audio(request['reference'], request_path.parent)
        if ref_rate != rate:
            raise ValueError('Comparison requires the same native sample rate')
    report = review_joins(candidate, rate, request['joins'], reference, request.get('protected', []),
                          request.get('projectOriginSeconds', 0))
    report.update(candidate=request['candidate'], reference=request.get('reference'), trackLabel=request.get('trackLabel'))
    output = output_directory(output)
    output.mkdir(parents=True, exist_ok=False)
    report['previews'] = []
    report['previewsTruncated'] = len(report['joins']) > 32
    for index, join in enumerate(report['joins'][:32]):
        a, b = max(0, join['sample'] - round(.12 * rate)), min(len(candidate), join['sample'] + round(.12 * rate))
        # Preview attenuation is disclosed; measurements always use the unchanged candidate.
        peak = float(np.max(np.abs(candidate[a:b])))
        gain = min(1, .95 / peak) if peak else 1
        preview = output / f'join-{index + 1:03d}.wav'
        engine.write_wav(preview, candidate[a:b] * gain, sample_rate=rate)
        report['previews'].append({'path': str(preview), 'startSample': a, 'endSample': b, 'gain': gain})
    if digest(source) != request['candidate']['sha256'] or (reference_path and digest(reference_path) != request['reference']['sha256']):
        raise ValueError('Input changed during review; output must not be accepted')
    write_json(output / 'review.json', report)
    return {'reportPath': str(output / 'review.json'), 'status': report['status'], 'findingCount': len(report['findings']),
            'listeningRequired': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    import json
    print(json.dumps(run_review(args.request, args.output)))
