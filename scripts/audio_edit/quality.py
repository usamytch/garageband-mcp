"""Whole-interval diagnostics; numerical acceptance never implies listening approval."""
import numpy as np

from onset_engine import SR


def runs(mask, minimum=1):
    changes = np.diff(np.r_[False, mask, False].astype(int))
    return [[int(a), int(b)] for a, b in zip(np.flatnonzero(changes == 1), np.flatnonzero(changes == -1)) if b - a >= minimum]


def audit_audio(reference, candidate, protected=(), allowed_fades=None, joins=()):
    reference, candidate = np.asarray(reference), np.asarray(candidate)
    if reference.ndim == 1:
        reference = reference[:, None]
    if candidate.ndim == 1:
        candidate = candidate[:, None]
    if reference.shape != candidate.shape or candidate.ndim != 2 or not candidate.size:
        raise ValueError('Comparison requires the same nonempty sample timeline and channels')
    finite = bool(np.all(np.isfinite(candidate)) and np.all(np.isfinite(reference)))
    if not finite:
        return {'technicalPass': False, 'finite': False, 'listeningRequired': True}
    allowed = np.zeros(len(candidate), dtype=bool) if allowed_fades is None else np.asarray(allowed_fades, dtype=bool)
    if allowed.shape != (len(candidate),):
        raise ValueError('Invalid fade mask')
    envelope = np.sqrt(np.convolve(np.mean(reference ** 2, axis=1), np.ones(44) / 44, mode='full')[21:21 + len(reference)])
    zero = np.max(np.abs(candidate), axis=1) < 1e-8
    dropouts = runs(zero & (envelope > .001) & ~allowed, 44)
    delta = np.max(np.abs(np.diff(candidate, axis=0) - np.diff(reference, axis=0)), axis=1)
    jumps = np.flatnonzero((delta > .02) & ~allowed[1:] & ~allowed[:-1]) + 1
    # A newly assembled cut can already be present in reference. Check it directly.
    bad_joins = [int(i) for i in joins if 0 < i < len(candidate) and np.max(np.abs(candidate[i] - candidate[i - 1])) > .02]
    changed = [[int(a), int(b)] for a, b in protected if not np.allclose(candidate[a:b], reference[a:b], atol=2 ** -23, rtol=0)]
    unplanned = runs((np.max(np.abs(candidate - reference), axis=1) > 2 ** -23) & ~allowed)
    peak = float(np.max(np.abs(candidate)))
    return {
        'technicalPass': bool(not dropouts and not len(jumps) and not bad_joins and not changed and not unplanned and peak < 1),
        'finite': True, 'peak': peak, 'newDropoutsSamples': dropouts,
        'discontinuitySamples': jumps.tolist(), 'badJoinSamples': bad_joins,
        'changedProtectedRanges': changed, 'sampleRate': SR, 'listeningRequired': True,
        'unplannedChangeRanges': unplanned,
        'thresholds': {'zeroAmplitude': 1e-8, 'activeRms': .001, 'minimumDropoutSamples': 44, 'jumpAmplitude': .02},
    }


def matched_pair(reference, candidate):
    levels = [float(np.sqrt(np.mean(x ** 2))) for x in (reference, candidate)]
    target = min(levels)
    gains = [target / level if level else 1 for level in levels]
    peak = max(float(np.max(np.abs(x))) * gain for x, gain in zip((reference, candidate), gains))
    headroom = min(1, .89 / peak) if peak else 1
    gains = [gain * headroom for gain in gains]
    return reference * gains[0], candidate * gains[1], gains
