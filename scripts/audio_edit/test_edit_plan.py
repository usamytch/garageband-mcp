import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from edit_plan import render_plan, main
from quality import audit_audio, matched_pair
import onset_engine as engine


class PhrasePlanTest(unittest.TestCase):
    def setUp(self):
        t = np.arange(10000) / 44100
        self.source = .2 * np.sin(2 * np.pi * (120 * t + 800 * t ** 2))
        self.source[:200] = 0
        self.source[-200:] = 0
        self.plan = {'version': 1, 'sampleRate': 44100, 'sourceSha256': 'verified',
                     'sourceFrames': 10000, 'channels': 1, 'reviewed': True, 'outputFrames': 13000,
                     'protectedPhrases': [{'start': 200, 'end': 9800, 'kind': 'slide'}],
                     'clips': [{'sourceStart': 0, 'sourceEnd': 10000, 'destinationStart': 3000}]}

    def test_slide_moves_as_one_phrase_without_changing_its_samples(self):
        ref, result, report = render_plan(self.source, self.plan, 'verified')
        np.testing.assert_array_equal(result[3000:, 0], self.source)
        self.assertTrue(report['technicalPass'])
        self.assertTrue(report['listeningRequired'])
        np.testing.assert_array_equal(ref, result)

    def test_protected_phrase_cannot_be_split_faded_omitted_or_duplicated(self):
        for clips in [
            [{'sourceStart': 0, 'sourceEnd': 5000, 'destinationStart': 0}, {'sourceStart': 5000, 'sourceEnd': 10000, 'destinationStart': 5000}],
            [{'sourceStart': 0, 'sourceEnd': 10000, 'destinationStart': 0, 'fadeOutSamples': 500}],
            [{'sourceStart': 0, 'sourceEnd': 100, 'destinationStart': 0}],
            [{'sourceStart': 0, 'sourceEnd': 10000, 'destinationStart': 0}, {'sourceStart': 200, 'sourceEnd': 1000, 'destinationStart': 11000}],
        ]:
            plan = {**self.plan, 'clips': clips}
            with self.subTest(clips=clips), self.assertRaisesRegex(ValueError, 'phrase'):
                render_plan(self.source, plan, 'verified')

    def test_identity_review_ranges_and_overlap_are_validated(self):
        for change in [{'sourceSha256': 'wrong'}, {'reviewed': False}, {'outputFrames': 500}, {'sourceFrames': 3}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                render_plan(self.source, {**self.plan, **change}, 'verified')
        plan = copy.deepcopy(self.plan)
        plan['clips'].append(plan['clips'][0])
        with self.assertRaisesRegex(ValueError, 'Overlapping'):
            render_plan(self.source, plan, 'verified')

    def test_known_short_render_dropouts_are_detected_inside_not_only_at_edges(self):
        for duration in [150, 666]:
            result = self.source.copy()
            result[6000:6000 + duration] = 0
            report = audit_audio(self.source, result)
            self.assertFalse(report['technicalPass'])
            self.assertEqual(report['newDropoutsSamples'], [[6000, 6000 + duration]])

    def test_quiet_active_audio_and_legato_modifications_are_not_silence(self):
        reference = self.source * .025
        candidate = reference.copy()
        candidate[6000:6200] = 0
        self.assertFalse(audit_audio(reference, candidate)['technicalPass'])
        candidate = self.source.copy()
        candidate[6000:6200] *= .5
        self.assertEqual(audit_audio(self.source, candidate, [(200, 9800)])['changedProtectedRanges'], [[200, 9800]])

    def test_real_silence_and_reviewed_fades_are_allowed(self):
        source = np.r_[np.zeros(100), np.ones(1000) * .1, np.zeros(100)]
        candidate = source.copy()
        candidate[100:300] *= np.linspace(0, 1, 200)
        mask = np.zeros(len(source), dtype=bool)
        mask[100:300] = True
        self.assertTrue(audit_audio(source, candidate, allowed_fades=mask)['technicalPass'])
        self.assertFalse(audit_audio(source, source, joins=[100])['technicalPass'])

    def test_comparison_matches_rms_without_boosting_or_clipping(self):
        a, b, gains = matched_pair(self.source, self.source * .4)
        self.assertAlmostEqual(float(np.sqrt(np.mean(a ** 2))), float(np.sqrt(np.mean(b ** 2))))
        self.assertTrue(all(0 < g <= 1 for g in gains))

    def test_short_audio_and_unplanned_quiet_signal_are_checked(self):
        self.assertTrue(audit_audio(np.zeros(10), np.zeros(10))['technicalPass'])
        self.assertFalse(audit_audio(np.zeros(1000), np.ones(1000) * .0001)['technicalPass'])

    def test_cli_creates_reviewable_candidate_and_preserves_source(self):
        runtime = Path(__file__).resolve().parents[2] / 'runtime/audio-edit-tests'
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            root = Path(directory)
            source, plan_path, output = root / 'source.wav', root / 'plan.json', root / 'candidate'
            engine.write_wav(source, self.source)
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            plan_path.write_text(json.dumps({**self.plan, 'sourceSha256': digest}))
            command = [sys.executable, str(Path(__file__).with_name('edit_plan.py')), '--input', str(source), '--plan', str(plan_path), '--output', str(output)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((output / 'quality.json').read_text())
            self.assertTrue(report['technicalPass'])
            self.assertTrue(report['renderComplete'])
            self.assertTrue(report['listeningRequired'])
            np.testing.assert_array_equal(engine.decode(output / 'candidate.wav')[3000:], engine.decode(source))
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), digest)
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)

    def test_failed_wav_write_cannot_leave_a_success_report(self):
        runtime = Path(__file__).resolve().parents[2] / 'runtime/audio-edit-tests'
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            root = Path(directory)
            source, plan_path, output = root / 'source.wav', root / 'plan.json', root / 'candidate'
            engine.write_wav(source, self.source)
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            plan_path.write_text(json.dumps({**self.plan, 'sourceSha256': digest}))
            arguments = ['edit_plan', '--input', str(source), '--plan', str(plan_path), '--output', str(output)]
            with patch.object(sys, 'argv', arguments), patch.object(engine, 'write_wav', side_effect=OSError('disk full')):
                with self.assertRaisesRegex(OSError, 'disk full'):
                    main()
            report = json.loads((output / 'quality.json').read_text())
            self.assertFalse(report['technicalPass'])
            self.assertFalse(report['renderComplete'])
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), digest)


if __name__ == '__main__':
    unittest.main()
