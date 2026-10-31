import copy
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from audio_assets import digest, read_audio
from onset_engine import write_wav
from vocal_process import analyze_pitch, pitch_backend, run_request, transpose, tune_audio, vocode


class VocalProcessTest(unittest.TestCase):
    def setUp(self):
        runtime = Path(__file__).resolve().parents[2] / 'runtime/vocal-tests'
        runtime.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=runtime)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.rate = 44100
        t = np.arange(self.rate * 2) / self.rate
        self.audio = .1 * np.sin(2 * np.pi * 220 * t)
        self.source = self.root / 'source.wav'
        write_wav(self.source, self.audio)
        self.asset = {'path': 'source.wav', 'sha256': digest(self.source), 'frames': len(self.audio),
                      'channels': 1, 'sampleRate': self.rate, 'projectOriginSample': 4410}
        self.request = {'version': 1, 'mode': 'analyze', 'asset': self.asset}
        self.path = self.root / 'request.json'

    def save(self):
        self.path.write_text(json.dumps(self.request))
        return self.path

    def test_analysis_detects_tone_and_rejects_silence_and_noise(self):
        result = run_request(self.save())
        self.assertEqual(result['status'], 'analyzed')
        self.assertAlmostEqual(result['analysis']['medianHz'], 220, delta=.2)
        self.assertGreater(result['analysis']['voicedFraction'], .95)
        self.assertTrue(all(x['hz'] is None for x in analyze_pitch(np.zeros(self.rate), self.rate, {})['frames']))
        noise = np.random.default_rng(7).normal(0, .1, self.rate)
        self.assertLess(analyze_pitch(noise, self.rate, {})['voicedFraction'], .05)
        self.assertEqual(digest(self.source), self.asset['sha256'])
        self.assertEqual(list(self.root.glob('*.wav')), [self.source])

    def test_explicit_tuning_changes_pitch_preserves_timeline_and_outside_regions(self):
        self.request.update(mode='tune', tune={'backend': 'ffmpeg-atempo', 'regions': [
            {'startSample': self.rate // 2, 'endSample': self.rate * 3 // 2, 'semitones': 2, 'fadeSamples': 441}
        ]})
        result = run_request(self.save(), self.root / 'tuned')
        output = result['output']
        _, audio, rate = read_audio({'path': output['path'], 'sha256': output['sha256']}, self.root)
        self.assertEqual(audio.shape, (len(self.audio), 1))
        analysis = analyze_pitch(audio[self.rate * 3 // 4:self.rate * 5 // 4, 0], rate, {})
        self.assertAlmostEqual(analysis['medianHz'], 220 * 2 ** (2 / 12), delta=.6)
        _, original, _ = read_audio(self.asset, self.root)
        np.testing.assert_array_equal(audio[:self.rate // 2], original[:self.rate // 2])
        np.testing.assert_array_equal(audio[self.rate * 3 // 2:], original[self.rate * 3 // 2:])
        self.assertEqual(output['projectOriginSample'], 4410)
        self.assertEqual(result['regions'][0]['formants'], 'not preserved')
        self.assertEqual(digest(self.source), self.asset['sha256'])

    def test_zero_transpose_and_dry_vocoder_are_exact_identity(self):
        result, info = transpose(self.audio, self.rate, 0, 'ffmpeg-atempo')
        np.testing.assert_array_equal(result, self.audio)
        self.assertEqual(info['backend'], 'identity')
        tuned, _ = tune_audio(self.audio, self.rate, {'backend': 'ffmpeg-atempo', 'regions': [
            {'startSample': 0, 'endSample': len(self.audio), 'semitones': 0, 'fadeSamples': 441}]})
        np.testing.assert_array_equal(tuned, self.audio)
        result = vocode(self.audio, self.rate, {'wet': 0, 'events': []})
        np.testing.assert_array_equal(result, self.audio)

    def test_vocoder_requires_modulator_and_carrier_and_preserves_duration(self):
        config = {'events': [{'startSample': 0, 'endSample': len(self.audio), 'notes': [48, 55, 60]}]}
        rendered = vocode(self.audio, self.rate, config)
        self.assertEqual(rendered.shape, self.audio.shape)
        self.assertTrue(np.isfinite(rendered).all())
        self.assertGreater(np.sqrt(np.mean(rendered ** 2)), .01)
        np.testing.assert_array_equal(vocode(np.zeros_like(self.audio), self.rate, config), np.zeros_like(self.audio))
        np.testing.assert_array_equal(vocode(self.audio, self.rate, {'events': []}), np.zeros_like(self.audio))
        changed = vocode(self.audio, self.rate, {'events': [{'startSample': 0, 'endSample': len(self.audio), 'notes': [57]}]})
        self.assertGreater(np.sqrt(np.mean((rendered - changed) ** 2)), .01)
        self.assertGreater(np.sqrt(np.mean((rendered - self.audio) ** 2)), .01)

    def test_vocoder_render_is_reproducible_and_preserves_source(self):
        self.request.update(mode='vocoder', vocoder={'events': [{'startSample': 0, 'endSample': len(self.audio), 'notes': [48, 55]}]})
        self.save()
        one = run_request(self.path, self.root / 'one')
        two = run_request(self.path, self.root / 'two')
        self.assertEqual(one['output']['sha256'], two['output']['sha256'])
        self.assertEqual(digest(self.source), self.asset['sha256'])
        with self.assertRaises(FileExistsError):
            run_request(self.path, self.root / 'one')

    def test_invalid_and_stale_inputs_fail_before_directory_creation(self):
        original = copy.deepcopy(self.request)
        mutations = [
            lambda r: r.update(version=True),
            lambda r: r.update(unknown=True),
            lambda r: r.update(analysis={'confidence': float('nan')}),
            lambda r: r.update(analysis={'minHz': 1000, 'maxHz': 100}),
            lambda r: r.update(gainDb=float('inf')),
            lambda r: r['asset'].update(channels=2),
            lambda r: r['asset'].update(frames=100),
            lambda r: r['asset'].update(sha256='0' * 64),
            lambda r: r.update(mode='vocoder', vocoder={'events': [{'startSample': 0, 'endSample': 1, 'notes': [False]}]}),
            lambda r: r.update(mode='tune', tune={'backend': 'auto', 'regions': []}),
            lambda r: r.update(mode='tune', tune={'backend': 'ffmpeg-atempo', 'regions': [
                {'startSample': 4000, 'endSample': 8000, 'semitones': 2, 'fadeSamples': 4},
                {'startSample': 6000, 'endSample': 9000, 'semitones': 3, 'fadeSamples': 4}]}),
        ]
        for change in mutations:
            self.request = copy.deepcopy(original)
            change(self.request)
            with self.assertRaises(ValueError):
                run_request(self.save(), self.root / 'bad')
            self.assertFalse((self.root / 'bad').exists())

    def test_unavailable_backend_and_short_render_never_silently_fallback_or_pad(self):
        with patch('vocal_process.subprocess.check_output', return_value=b' ... atempo A->A'):
            with self.assertRaisesRegex(ValueError, 'no fallback'):
                pitch_backend('rubberband')
        with patch('vocal_process.subprocess.run') as process:
            process.return_value.stdout = np.zeros(10, dtype='<f8').tobytes()
            with self.assertRaisesRegex(ValueError, 'not padded'):
                transpose(self.audio, self.rate, 2, 'ffmpeg-atempo')

    def test_cli_unavailable_fails_before_output_creation(self):
        self.request.update(mode='tune', tune={'backend': 'rubberband-cli', 'regions': [
            {'startSample': 0, 'endSample': len(self.audio), 'semitones': 1, 'fadeSamples': 441}]})
        with patch('vocal_process.shutil.which', return_value=None):
            with self.assertRaisesRegex(ValueError, 'no fallback'):
                run_request(self.save(), self.root / 'missing-cli')
        self.assertFalse((self.root / 'missing-cli').exists())

    def test_pitch_render_rejects_full_scale_in_active_audio_and_both_contexts(self):
        context = self.rate // 2
        for backend in ('ffmpeg-atempo', 'rubberband-cli'):
            for position in (0, context + self.rate, len(self.audio) + 2 * context - 1):
                for value in (-1.01, -1.0, 1.0, 1.01):
                    with self.subTest(backend=backend, position=position, value=value):
                        rendered = np.zeros(len(self.audio) + 2 * context, dtype='<f8')
                        rendered[position] = value
                        with patch('vocal_process.transpose_cli', return_value=(rendered, {})), patch('vocal_process.subprocess.run') as process:
                            process.return_value.stdout = rendered.tobytes()
                            with self.assertRaisesRegex(ValueError, 'full scale'):
                                transpose(self.audio, self.rate, 2, backend, self.root)

    def test_final_attenuation_cannot_hide_clipped_pitch_context(self):
        self.request.update(mode='tune', gainDb=-12, tune={'backend': 'rubberband-cli', 'regions': [
            {'startSample': 0, 'endSample': len(self.audio), 'semitones': 2, 'fadeSamples': 441}]})
        rendered = np.zeros(len(self.audio) + self.rate)
        rendered[0] = -1
        with patch('vocal_process.pitch_backend'), patch('vocal_process.transpose_cli', return_value=(rendered, {})):
            with self.assertRaisesRegex(ValueError, 'full scale'):
                run_request(self.save(), self.root / 'clipped-pitch')
        receipt = json.loads((self.root / 'clipped-pitch/receipt.json').read_text())
        self.assertEqual(receipt['status'], 'failed')
        self.assertFalse((self.root / 'clipped-pitch/vocal.wav').exists())
        self.assertEqual(digest(self.source), self.asset['sha256'])

    @unittest.skipUnless(shutil.which('rubberband'), 'Rubber Band CLI is not installed')
    def test_cli_render_has_verified_engine_exact_timeline_and_no_leftover_scratch(self):
        self.request.update(mode='tune', tune={'backend': 'rubberband-cli', 'regions': [
            {'startSample': 0, 'endSample': len(self.audio), 'semitones': 2, 'fadeSamples': 441}]})
        report = run_request(self.save(), self.root / 'cli')
        output = report['output']
        _, rendered, _ = read_audio({'path': output['path'], 'sha256': output['sha256']}, self.root)
        self.assertEqual(rendered.shape, (len(self.audio), 1))
        hz = analyze_pitch(rendered[self.rate // 2:self.rate * 3 // 2, 0], self.rate, {})['medianHz']
        self.assertAlmostEqual(hz, 220 * 2 ** (2 / 12), delta=.6)
        self.assertEqual(report['regions'][0]['engine'], 'R3 fine')
        self.assertTrue(report['regions'][0]['version'])
        self.assertFalse(report['regions'][0]['automaticGainReduction'])
        self.assertEqual(sorted(p.name for p in (self.root / 'cli').iterdir()), ['receipt.json', 'vocal.wav'])
        self.assertEqual(digest(self.source), self.asset['sha256'])

    @unittest.skipUnless(shutil.which('rubberband'), 'Rubber Band CLI is not installed')
    def test_cli_preserves_a_synthetic_vowel_envelope_better_than_unpreserved_shift(self):
        t = np.arange(self.rate * 2) / self.rate
        vowel = np.zeros(len(t))
        for harmonic in range(1, 80):
            frequency = 110 * harmonic
            amplitude = (np.exp(-.5 * ((frequency - 800) / 140) ** 2)
                         + .6 * np.exp(-.5 * ((frequency - 2200) / 240) ** 2) + .02)
            vowel += amplitude * np.sin(2 * np.pi * frequency * t) / 100
        preserved, info = transpose(vowel, self.rate, 7, 'rubberband-cli', self.root)
        unpreserved, _ = transpose(vowel, self.rate, 7, 'ffmpeg-atempo')

        def lower_formant_centroid(audio):
            excerpt = audio[self.rate // 2:self.rate * 3 // 2]
            frequencies = np.fft.rfftfreq(len(excerpt), 1 / self.rate)
            power = np.abs(np.fft.rfft(excerpt * np.hanning(len(excerpt)))) ** 2
            band = (frequencies > 400) & (frequencies < 1600)
            return float(np.sum(frequencies[band] * power[band]) / np.sum(power[band]))

        original = lower_formant_centroid(vowel)
        preserved_error = abs(lower_formant_centroid(preserved) - original)
        shifted_error = abs(lower_formant_centroid(unpreserved) - original)
        self.assertLess(preserved_error, 100)
        self.assertGreater(shifted_error, 250)
        self.assertLess(preserved_error, shifted_error / 3)
        self.assertIn('preservation requested', info['formants'])

    def test_output_packages_and_clipping_are_refused(self):
        with self.assertRaisesRegex(ValueError, 'project'):
            run_request(self.save(), self.root / 'Keep.band/new')
        self.request.update(mode='vocoder', gainDb=24, vocoder={'wet': 0, 'events': [
            {'startSample': 0, 'endSample': len(self.audio), 'notes': [48]}]})
        with self.assertRaisesRegex(ValueError, 'clip'):
            run_request(self.save(), self.root / 'clipped')
        receipt = json.loads((self.root / 'clipped/receipt.json').read_text())
        self.assertEqual(receipt['status'], 'failed')
        self.assertFalse((self.root / 'clipped/vocal.wav').exists())
        self.assertEqual(digest(self.source), self.asset['sha256'])


if __name__ == '__main__':
    unittest.main()
