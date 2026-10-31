import copy
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from audio_assets import digest
import onset_engine as engine
from mix_process import ffmpeg, filter_chain, meter, run_request


class MixProcessTest(unittest.TestCase):
    def setUp(self):
        runtime = Path(__file__).resolve().parents[2] / 'runtime/mix-process-tests'
        runtime.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=runtime)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.rate = 44100
        self.time = np.arange(self.rate * 4) / self.rate
        self.audio = (.1 * np.sin(2 * np.pi * 440 * self.time))[:, None]
        self.source = self.root / 'source.wav'
        engine.write_wav(self.source, self.audio)
        self.asset = {'path': 'source.wav', 'sha256': digest(self.source)}
        self.request = {'version': 1, 'mode': 'process', 'source': self.asset, 'projectOriginSample': 1234,
                        'chain': [{'type': 'gain', 'gainDb': -6}]}
        self.path = self.root / 'request.json'

    def save(self, request=None):
        self.path.write_text(json.dumps(self.request if request is None else request))

    def test_dry_run_and_render_preserve_identity_timing_and_gain(self):
        self.save()
        self.assertEqual(run_request(self.path)['status'], 'validated')
        result = run_request(self.path, self.root / 'render')
        self.assertEqual(result['status'], 'completed')
        signal = engine.decode(self.root / 'render/processed.wav')
        source = engine.decode(self.source)
        np.testing.assert_allclose(signal, source * 10 ** (-6 / 20), atol=2 ** -23, rtol=0)
        self.assertEqual(signal.shape, source.shape)
        self.assertEqual(result['outputs'][0]['projectOriginSample'], 1234)
        self.assertEqual(digest(self.source), self.asset['sha256'])
        with self.assertRaises(FileExistsError):
            run_request(self.path, self.root / 'render')

    def test_eq_and_filter_have_frequency_specific_effect(self):
        signal = (.1 * np.sin(2 * np.pi * 100 * self.time) + .1 * np.sin(2 * np.pi * 4000 * self.time))[:, None]
        filtered = ffmpeg(signal, self.rate, filter_chain([{'type': 'highpass', 'frequencyHz': 1000}], self.rate))
        def amplitude(audio, frequency):
            values = audio[self.rate:, 0]
            t = self.time[self.rate:]
            return abs(np.sum(values * np.exp(-2j * np.pi * frequency * t)))
        self.assertLess(amplitude(filtered, 100) / amplitude(signal, 100), .02)
        self.assertGreater(amplitude(filtered, 4000) / amplitude(signal, 4000), .95)
        eq = ffmpeg(self.audio, self.rate, filter_chain([{'type': 'eq', 'frequencyHz': 440, 'q': 1, 'gainDb': -6}], self.rate))
        self.assertAlmostEqual(amplitude(eq, 440) / amplitude(self.audio, 440), 10 ** (-6 / 20), places=3)

    def test_compressor_reduces_loud_segment_more_than_quiet(self):
        signal = self.audio.copy()
        signal[:self.rate * 2] *= .1
        signal[self.rate * 2:] *= 5
        chain = [{'type': 'compressor', 'thresholdDb': -20, 'ratio': 4, 'attackMs': 1, 'releaseMs': 50}]
        compressed = ffmpeg(signal, self.rate, filter_chain(chain, self.rate))
        quiet_gain = np.linalg.norm(compressed[self.rate:self.rate * 2]) / np.linalg.norm(signal[self.rate:self.rate * 2])
        loud_gain = np.linalg.norm(compressed[self.rate * 3:]) / np.linalg.norm(signal[self.rate * 3:])
        self.assertGreater(quiet_gain, .99)
        self.assertLess(loud_gain, .5)

    def test_stereo_cancellation_and_silence_are_not_good_mono(self):
        antiphase = np.column_stack([self.audio[:, 0], -self.audio[:, 0]])
        report = meter(antiphase, self.rate)
        self.assertAlmostEqual(report['stereo']['correlation'], -1)
        self.assertTrue(report['stereo']['monoIsSilent'])
        silent = meter(np.zeros((44100, 2)), self.rate)
        self.assertIsNone(silent['loudness']['integratedLufs'])
        self.assertIsNone(silent['stereo']['correlation'])

    def test_matched_comparison_only_attenuates_louder_signal(self):
        reference = self.root / 'reference.wav'
        engine.write_wav(reference, self.audio * .5)
        self.request.update(mode='compare', reference={'path': reference.name, 'sha256': digest(reference)}, referenceProjectOriginSample=1234)
        del self.request['chain']
        self.save()
        report = run_request(self.path, self.root / 'comparison')
        self.assertAlmostEqual(report['match']['sourceGainDb'], -6.02, delta=.1)
        self.assertEqual(report['match']['referenceGainDb'], 0)
        self.assertTrue(report['match']['verified'])
        self.assertLessEqual(report['match']['differenceLu'], report['match']['toleranceLu'])
        a = engine.decode(self.root / 'comparison/A-source.wav')
        b = engine.decode(self.root / 'comparison/B-reference.wav')
        self.assertLess(abs(20 * np.log10(np.linalg.norm(a) / np.linalg.norm(b))), .1)
        self.request['referenceProjectOriginSample'] = 0
        self.save()
        with self.assertRaisesRegex(ValueError, 'origin'):
            run_request(self.path, self.root / 'misaligned')

    def test_absolute_loudness_gate_cannot_publish_a_falsely_matched_pair(self):
        source = self.root / 'quiet-source.wav'
        reference = self.root / 'quiet-reference.wav'
        signal = self.audio * (10 ** (-59 / 20) / .1)
        signal[:int(len(signal) * .8)] *= 10 ** (-7 / 20)
        engine.write_wav(source, signal)
        engine.write_wav(reference, self.audio * (10 ** (-65 / 20) / .1))
        request = {'version': 1, 'mode': 'compare', 'projectOriginSample': 1234,
                   'source': {'path': source.name, 'sha256': digest(source)},
                   'reference': {'path': reference.name, 'sha256': digest(reference)},
                   'referenceProjectOriginSample': 1234}
        self.save(request)
        destination = self.root / 'gated-comparison'
        with self.assertRaisesRegex(ValueError, 'Loudness matching failed'):
            run_request(self.path, destination)
        receipt = json.loads((destination / 'receipt.json').read_text())
        self.assertEqual(receipt['status'], 'failed')
        self.assertFalse(receipt['match']['verified'])
        self.assertGreater(receipt['match']['differenceLu'], 2)
        self.assertEqual(receipt['outputs'], [])
        self.assertFalse((destination / 'A-source.wav').exists())
        self.assertFalse((destination / 'B-reference.wav').exists())
        self.assertEqual(digest(source), request['source']['sha256'])

    def test_invalid_fields_and_source_hash_fail_without_output(self):
        edits = [lambda r: r.update(extra=True), lambda r: r.update(version=True),
                 lambda r: r['source'].update(sha256='0' * 64),
                 lambda r: r['chain'][0].update(gainDb=float('nan')),
                 lambda r: r['chain'][0].update(gainDb=True),
                 lambda r: r['chain'][0].update(filter='amovie=private.wav'),
                 lambda r: r.update(mode='analyze')]
        for edit in edits:
            request = copy.deepcopy(self.request)
            edit(request)
            self.save(request)
            with self.assertRaises(ValueError):
                run_request(self.path, self.root / 'invalid')
            self.assertFalse((self.root / 'invalid').exists())
        self.save()
        with self.assertRaisesRegex(ValueError, 'project'):
            run_request(self.path, self.root / 'session.band/output')

    def test_saturation_and_deesser_keep_duration_and_report_real_meter_units(self):
        graph = filter_chain([{'type': 'deesser', 'intensity': 0, 'maxReduction': .5, 'frequency': .5},
                              {'type': 'saturation', 'driveDb': 12, 'outputDb': -12}], self.rate)
        signal = ffmpeg(self.audio, self.rate, graph)
        self.assertEqual(signal.shape, self.audio.shape)
        self.assertLess(np.max(np.abs(signal)), .1)
        report = meter(self.audio, self.rate)
        self.assertAlmostEqual(report['samplePeakDbfs'][0], -20, delta=.01)
        self.assertAlmostEqual(report['loudness']['truePeakDbtp'], -20, delta=.1)

    def test_clipping_records_failure_without_publishing_audio(self):
        self.request['chain'][0]['gainDb'] = 24
        self.save()
        with self.assertRaisesRegex(ValueError, 'clip'):
            run_request(self.path, self.root / 'clipped')
        receipt = json.loads((self.root / 'clipped/receipt.json').read_text())
        self.assertEqual(receipt['status'], 'failed')
        self.assertFalse((self.root / 'clipped/processed.wav').exists())


if __name__ == '__main__':
    unittest.main()
