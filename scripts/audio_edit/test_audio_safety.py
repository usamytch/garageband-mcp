import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

import onset_engine as edit


class AudioSafetyTest(unittest.TestCase):
    def tone(self, samples=10000):
        return .2 * np.cos(2 * np.pi * 220 * np.arange(samples) / edit.SR)

    def test_active_tail_requires_explicit_review(self):
        with self.assertRaisesRegex(ValueError, 'review'):
            edit.stretch_tail(self.tone(), 12000)

    def test_short_active_fragment_must_not_be_padded_with_silence(self):
        with self.assertRaises(ValueError):
            edit.stretch_tail(np.full(1000, .1), 1500)

    def test_short_renderer_output_is_rejected_instead_of_zero_padded(self):
        # A successful process can still return fewer samples than requested.
        with patch.object(edit.subprocess, 'check_output', return_value=np.full(4000, .1, dtype='<f4').tobytes()):
            with self.assertRaisesRegex(ValueError, 'short|samples'):
                edit.stretch_tail(self.tone(), 12000, allow_time_stretch=True)

    def test_reviewed_render_preserves_entire_protected_attack(self):
        x = self.tone()
        rendered = np.full(12000, .1, dtype='<f4')
        with patch.object(edit.subprocess, 'check_output', return_value=rendered.tobytes()):
            y, changed = edit.stretch_tail(x, 12000, allow_time_stretch=True)
        self.assertTrue(changed)
        self.assertEqual(len(y), 12000)
        np.testing.assert_array_equal(y[:2205], x[:2205])
        self.assertGreater(np.min(y[3000:]), .09, 'No silent dropout inside a continuous rendered tail')

    def test_existing_silence_can_be_extended_without_touching_source(self):
        x = np.r_[self.tone(4000), np.zeros(1000)]
        y, changed = edit.stretch_tail(x, 6000)
        self.assertFalse(changed)
        np.testing.assert_array_equal(y[:len(x)], x)
        self.assertTrue(np.all(y[len(x):] == 0))

    def test_nonfinite_renderer_output_is_rejected(self):
        with patch.object(edit.subprocess, 'check_output', return_value=np.full(12000, np.nan, dtype='<f4').tobytes()):
            with self.assertRaisesRegex(ValueError, 'finite'):
                edit.stretch_tail(self.tone(), 12000, allow_time_stretch=True)

    def test_steady_tone_and_stationary_noise_are_not_grid_attacks(self):
        rng = np.random.default_rng(53)
        for x in [self.tone(3 * edit.SR), rng.normal(0, .02, 3 * edit.SR)]:
            with self.subTest(signal=x[:3]):
                with self.assertRaises(ValueError):
                    edit.detect(x, [1, 1.4, 1.8])

    def test_invalid_anchors_are_rejected(self):
        for anchors in [[-1], [4], [np.nan], [1.2, 1.1], [[1, 1.4]]]:
            with self.subTest(anchors=anchors):
                with self.assertRaises(ValueError):
                    edit.detect(self.tone(3 * edit.SR), anchors)

    def test_wav_writer_rejects_invalid_audio_and_keeps_existing_file(self):
        runtime = Path(__file__).resolve().parents[2] / 'runtime/audio-edit-tests'
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            target = Path(directory) / 'source.wav'
            target.write_bytes(b'protected original')
            with self.assertRaises(FileExistsError):
                edit.write_wav(target, self.tone())
            self.assertEqual(target.read_bytes(), b'protected original')
            for x in [np.array([]), np.array([np.nan]), np.array([np.inf]), np.array([1.2]), np.array([-.999, 1.0]), np.zeros((2, 0))]:
                with self.subTest(signal=x):
                    new = Path(directory) / 'invalid.wav'
                    with self.assertRaises(ValueError):
                        edit.write_wav(new, x)
                    self.assertFalse(new.exists())


if __name__ == '__main__':
    unittest.main()
