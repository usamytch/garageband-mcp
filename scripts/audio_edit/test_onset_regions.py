import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import numpy as np
import onset_engine as engine


class RegionExtractionTest(unittest.TestCase):
    def setUp(self):
        runtime = Path(__file__).resolve().parents[2] / 'runtime/audio-edit-tests'
        runtime.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=runtime)
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.input = self.root / 'synthetic.wav'
        self.anchors = self.root / 'anchors.json'
        self.anchors.write_text(json.dumps([.8, 1.4, 2.0]))
        self.output = self.root / 'regions'

    def run_cli(self):
        return subprocess.run([
            sys.executable, str(Path(__file__).with_name('onset_regions.py')),
            '--input', str(self.input), '--anchors', str(self.anchors),
            '--project-offset', '3.2', '--end', '2.7', '--output', str(self.output)
        ], capture_output=True, text=True)

    def test_extracted_regions_reconstruct_stereo_pcm_without_changing_source(self):
        mono = np.zeros(3 * engine.SR)
        for start in [.82, 1.38, 2.02]:
            t = np.arange(round(.15 * engine.SR)) / engine.SR
            note = .2 * np.sin(2 * np.pi * 330 * t) * np.minimum(1, t / .003) * np.exp(-15 * t)
            offset = round(start * engine.SR)
            mono[offset:offset + len(note)] = note
        engine.write_wav(self.input, np.column_stack([mono, -mono]))
        original_hash = hashlib.sha256(self.input.read_bytes()).hexdigest()
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.output / 'manifest.json').read_text())
        self.assertEqual(manifest['sourceSha256'], original_hash)
        self.assertEqual(len(manifest['regions']), 3)
        clips = [engine.decode(self.output / item['file']) for item in manifest['regions']]
        start = manifest['regions'][0]['sourceRangeSamples'][0]
        end = manifest['regions'][-1]['sourceRangeSamples'][1]
        np.testing.assert_array_equal(np.concatenate(clips), engine.decode(self.input)[start:end])
        self.assertEqual(hashlib.sha256(self.input.read_bytes()).hexdigest(), original_hash)
        self.assertNotEqual(self.run_cli().returncode, 0, 'Existing output must never be overwritten')

    def test_silence_produces_no_regions_or_output_directory(self):
        engine.write_wav(self.input, np.zeros(3 * engine.SR))
        self.assertNotEqual(self.run_cli().returncode, 0)
        self.assertFalse(self.output.exists())

    def test_end_before_actual_attack_is_rejected_before_any_output(self):
        mono = np.zeros(3 * engine.SR)
        for start in [.82, 1.38, 2.09]:
            t = np.arange(round(.15 * engine.SR)) / engine.SR
            note = .2 * np.sin(2 * np.pi * 330 * t) * np.minimum(1, t / .003) * np.exp(-15 * t)
            offset = round(start * engine.SR)
            mono[offset:offset + len(note)] = note
        engine.write_wav(self.input, mono)
        result = subprocess.run([
            sys.executable, str(Path(__file__).with_name('onset_regions.py')),
            '--input', str(self.input), '--anchors', str(self.anchors),
            '--project-offset', '3.2', '--end', '2.01', '--output', str(self.output)
        ], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('detected attack', result.stderr)
        self.assertFalse(self.output.exists())

    def test_invalid_mapping_is_rejected_before_output_creation(self):
        engine.write_wav(self.input, np.zeros(3 * engine.SR))
        for flag, value in [('--project-offset', 'nan'), ('--project-offset', 'inf'), ('--end', 'nan')]:
            result = subprocess.run([
                sys.executable, str(Path(__file__).with_name('onset_regions.py')),
                '--input', str(self.input), '--anchors', str(self.anchors),
                '--project-offset', '3.2', '--end', '2.7', '--output', str(self.output), flag, value
            ], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('finite', result.stderr.lower())
            self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
