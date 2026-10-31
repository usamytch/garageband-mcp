import unittest
import json
import tempfile
from pathlib import Path
import wave

import numpy as np

from join_review import review_joins, run_review
from audio_assets import digest
import onset_engine as engine


class JoinReviewTest(unittest.TestCase):
    def setUp(self):
        self.sr = 48000
        t = np.arange(self.sr) / self.sr
        self.source = .15 * np.sin(2 * np.pi * (110 * t + 80 * t ** 2))

    def test_clean_pick_and_slide_are_not_new_clicks(self):
        source = self.source.copy()
        source[5000] += .3
        report = review_joins(source, self.sr, [{'sample': 5000, 'label': 'pick'}], source,
                              [{'start': 12000, 'end': 19000, 'referenceStart': 12000}])
        self.assertEqual(report['findings'], [])
        self.assertTrue(report['listeningRequired'])
        self.assertEqual(report['joins'][0]['projectSeconds'], 5000 / self.sr)

    def test_join_at_first_sample_is_not_discarded_and_antiphase_cannot_cancel(self):
        source = np.zeros((1000, 2))
        candidate = source.copy()
        candidate[0] = [.4, -.4]
        report = review_joins(candidate, self.sr, [{'sample': 0}], source)
        findings = report['findings']
        self.assertTrue(any(f['kind'] == 'discontinuity' and f['sample'] == 0 for f in findings))
        self.assertEqual({f['channel'] for f in findings}, {1, 2})
        self.assertTrue(report['joins'][0]['contextClipped'])

    def test_known_dropouts_are_reported_per_channel_with_exact_coordinates(self):
        source = np.column_stack([np.ones(48000) * .1, np.zeros(48000)])
        for length in [150, 666]:
            candidate = source.copy()
            candidate[9000:9000 + length, 0] = 0
            report = review_joins(candidate, self.sr, [{'sample': 9000}], source,
                                  project_origin_seconds=4)
            dropouts = [f for f in report['findings'] if f['kind'] == 'dropout']
            self.assertEqual([(f['sample'], f['endSample'], f['channel']) for f in dropouts], [(9000, 9000 + length, 1)])
            self.assertEqual(dropouts[0]['projectSeconds'], 4 + 9000 / self.sr)

    def test_protected_slide_uses_source_mapping_even_away_from_a_join(self):
        candidate = np.r_[np.zeros(100), self.source]
        protected = [{'start': 10100, 'end': 19100, 'referenceStart': 10000}]
        self.assertEqual(review_joins(candidate, self.sr, [{'sample': 100}], self.source, protected)['findings'], [])
        candidate[15000] *= .9
        report = review_joins(candidate, self.sr, [{'sample': 100}], self.source, protected)
        self.assertTrue(any(f['kind'] == 'protected_phrase_changed' for f in report['findings']))

    def test_real_pause_and_last_join_are_checked(self):
        source = np.zeros(48000)
        self.assertEqual(review_joins(source, self.sr, [{'sample': len(source)}], source)['findings'], [])
        source[-1] = .3
        report = review_joins(source, self.sr, [{'sample': len(source)}])
        self.assertTrue(any(f['kind'] == 'discontinuity' for f in report['findings']))

    def test_malformed_ranges_nonfinite_audio_and_missing_reference_are_rejected(self):
        for joins in [[{'sample': -1}], [{'sample': 1.5}], [{'sample': True}], [{'sample': 49000}]]:
            with self.assertRaises(ValueError):
                review_joins(self.source, self.sr, joins)
        with self.assertRaises(ValueError):
            review_joins([float('nan')], self.sr, [{'sample': 0}])
        with self.assertRaises(ValueError):
            review_joins(self.source, self.sr, [], protected=[{'start': 0, 'end': 100}])

    def test_file_review_retains_native_rate_identity_and_never_overwrites(self):
        runtime = Path(__file__).resolve().parents[2] / 'runtime/join-tests'
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            root = Path(directory)
            source = root / 'source.wav'
            engine.write_wav(source, self.source, sample_rate=self.sr)
            original = digest(source)
            request = {'version': 1, 'trackLabel': '41', 'candidate': {'path': source.name, 'sha256': original},
                       'reference': {'path': source.name, 'sha256': original}, 'joins': [{'sample': 10000}]}
            path = root / 'request.json'
            path.write_text(json.dumps(request))
            result = run_review(path, root / 'review')
            self.assertEqual(result['status'], 'no_findings')
            with wave.open(str(root / 'review/join-001.wav')) as preview:
                self.assertEqual(preview.getframerate(), self.sr)
                self.assertEqual(preview.getnframes(), round(.24 * self.sr))
            with self.assertRaises(FileExistsError):
                run_review(path, root / 'review')
            request['candidate']['sha256'] = '0' * 64
            path.write_text(json.dumps(request))
            with self.assertRaisesRegex(ValueError, 'identity'):
                run_review(path, root / 'invalid')
            self.assertFalse((root / 'invalid').exists())
            self.assertEqual(digest(source), original)


if __name__ == '__main__':
    unittest.main()
