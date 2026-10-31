"""Reviewed, sample-based phrase moves; no inferred cuts or time stretching."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

import onset_engine as engine
from quality import audit_audio, matched_pair


def integer(value, label, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f'{label} must be an integer >= {minimum}')
    return value


def validate_plan(plan, frames, channels, source_hash):
    if plan.get('version') != 1 or plan.get('sampleRate') != engine.SR:
        raise ValueError('Expected version 1 and decoded sample rate 44100')
    if plan.get('sourceSha256') != source_hash:
        raise ValueError('Source identity changed')
    if plan.get('sourceFrames') != frames or plan.get('channels') != channels:
        raise ValueError('Source dimensions changed')
    if plan.get('reviewed') is not True:
        raise ValueError('Review the cuts and protected phrases before rendering')
    total = integer(plan.get('outputFrames'), 'outputFrames', 1)
    clips = plan.get('clips', [])
    if not clips:
        raise ValueError('Plan must contain clips')
    destinations = []
    for clip in clips:
        a = integer(clip.get('sourceStart'), 'sourceStart')
        b = integer(clip.get('sourceEnd'), 'sourceEnd', 1)
        d = integer(clip.get('destinationStart'), 'destinationStart')
        fi = integer(clip.get('fadeInSamples', 0), 'fadeInSamples')
        fo = integer(clip.get('fadeOutSamples', 0), 'fadeOutSamples')
        if b <= a or b > frames or d + b - a > total or fi + fo > b - a:
            raise ValueError('Invalid clip range or overlapping fades')
        destinations.append((d, d + b - a))
    ordered = sorted(destinations)
    if any(a[1] > b[0] for a, b in zip(ordered, ordered[1:])):
        raise ValueError('Overlapping destinations require a separately reviewed crossfade plan')
    protected = []
    for phrase in plan.get('protectedPhrases', []):
        a = integer(phrase.get('start'), 'phrase start')
        b = integer(phrase.get('end'), 'phrase end', 1)
        if b <= a or b > frames or phrase.get('kind') not in ('slide', 'legato', 'pickup', 'attack', 'ringing'):
            raise ValueError('Invalid protected phrase')
        hits = [c for c in clips if c['sourceStart'] < b and c['sourceEnd'] > a]
        if len(hits) != 1:
            raise ValueError('Protected phrase would be split, duplicated or omitted')
        c = hits[0]
        if c['sourceStart'] + c.get('fadeInSamples', 0) > a or c['sourceEnd'] - c.get('fadeOutSamples', 0) < b:
            raise ValueError('Cut or fade touches a protected phrase')
        offset = c['destinationStart'] - c['sourceStart']
        protected.append((a + offset, b + offset))
    return total, protected


def render_plan(source, plan, source_hash):
    source = np.asarray(source, dtype=float)
    if source.ndim == 1:
        source = source[:, None]
    if source.ndim != 2 or not source.size or not np.all(np.isfinite(source)):
        raise ValueError('Expected finite source audio')
    total, protected = validate_plan(plan, len(source), source.shape[1], source_hash)
    reference = np.zeros((total, source.shape[1]))
    candidate = reference.copy()
    allowed = np.zeros(total, dtype=bool)
    joins = set()
    for c in plan['clips']:
        a, b, d = c['sourceStart'], c['sourceEnd'], c['destinationStart']
        segment = source[a:b].copy()
        reference[d:d + len(segment)] = segment
        fi, fo = c.get('fadeInSamples', 0), c.get('fadeOutSamples', 0)
        if fi:
            segment[:fi] *= np.sin(np.linspace(0, np.pi / 2, fi))[:, None] ** 2
            allowed[d:d + fi] = True
        if fo:
            segment[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo))[:, None] ** 2
            allowed[d + len(segment) - fo:d + len(segment)] = True
        candidate[d:d + len(segment)] = segment
        joins.update((d, d + len(segment)))
    report = audit_audio(reference, candidate, protected, allowed, sorted(joins))
    report['sourceCoverage'] = [[c['sourceStart'], c['sourceEnd']] for c in plan['clips']]
    return reference, candidate, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='New candidate directory, never an accepted deliverable')
    args = parser.parse_args()
    source_hash = hashlib.sha256(args.input.read_bytes()).hexdigest()
    plan = json.loads(args.plan.read_text())
    source = engine.decode(args.input)
    if hashlib.sha256(args.input.read_bytes()).hexdigest() != source_hash:
        raise ValueError('Source changed during decoding; no output written')
    reference, candidate, report = render_plan(source, plan, source_hash)
    args.output.mkdir(parents=True, exist_ok=False)
    report.update(sourceSha256=source_hash, plan=plan, renderComplete=False)
    (args.output / 'quality.json').write_text(json.dumps(report, indent=2) + '\n')
    if not report['technicalPass']:
        raise ValueError('Candidate rejected; inspect quality.json. No deliverable written')
    try:
        original_ab, candidate_ab, gain = matched_pair(reference, candidate)
        engine.write_wav(args.output / 'candidate.wav', candidate)
        engine.write_wav(args.output / 'original-matched.wav', original_ab)
        engine.write_wav(args.output / 'candidate-matched.wav', candidate_ab)
        report['comparisonGain'] = gain
        report['candidateSha256'] = hashlib.sha256((args.output / 'candidate.wav').read_bytes()).hexdigest()
        if hashlib.sha256(args.input.read_bytes()).hexdigest() != source_hash:
            report['sourceChanged'] = True
            raise ValueError('Source changed during processing; candidate must not be accepted')
    except Exception as error:
        report.update(technicalPass=False, renderError=str(error))
        (args.output / 'quality.json').write_text(json.dumps(report, indent=2) + '\n')
        raise
    report['renderComplete'] = True
    (args.output / 'quality.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'output': str(args.output.resolve()), 'technicalPass': True, 'listeningRequired': True}))


if __name__ == '__main__':
    main()
