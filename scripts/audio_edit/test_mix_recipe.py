import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

import onset_engine as engine
from mix_recipe import run_recipe


class MixRecipeTest(unittest.TestCase):
    def setUp(self):
        runtime = Path(__file__).resolve().parents[2] / 'runtime/recipe-tests'
        runtime.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=runtime)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        t = np.arange(4410) / 44100
        self.signals = {'40': .1 * np.sin(2 * np.pi * 220 * t), '41': .1 * np.cos(2 * np.pi * 330 * t)}
        self.assets = []
        for name, signal in self.signals.items():
            path = self.root / (name + '.wav')
            engine.write_wav(path, signal)
            self.assets.append({'id': name, 'path': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                'frames': 4410, 'channels': 1, 'projectOriginSample': 0})
        terms = [{'asset': name, 'sourceStart': 0, 'destinationStart': 0, 'frames': 4410,
                  'gainDb': 0, 'matrix': [[1], [0]] if name == '40' else [[0], [1]]} for name in self.signals]
        self.recipe = {'version': 1, 'sampleRate': 44100, 'assets': self.assets,
                       'outputs': [{'id': 'intro10', 'filename': '10 - Acoustic.wav', 'projectStartSample': 0,
                                    'frames': 4410, 'gainDb': -3, 'fadeOutSamples': 441, 'terms': terms}]}
        self.path = self.root / 'recipe.json'

    def save(self, recipe=None):
        self.path.write_text(json.dumps(self.recipe if recipe is None else recipe))

    def test_preview_has_no_outputs_and_render_preserves_sources_and_balance(self):
        self.save()
        preview = run_recipe(self.path)
        self.assertEqual(preview['status'], 'validated')
        self.assertFalse((self.root / 'result').exists())
        result = run_recipe(self.path, self.root / 'result')
        self.assertEqual(result['status'], 'completed')
        out = engine.decode(self.root / 'result/10 - Acoustic.wav')
        expected = np.column_stack([engine.decode(self.root / '40.wav')[:, 0], engine.decode(self.root / '41.wav')[:, 0]]) * 10 ** (-3 / 20)
        expected[-441:] *= np.cos(np.linspace(0, np.pi / 2, 441))[:, None] ** 2
        np.testing.assert_allclose(out, expected, atol=2 ** -23, rtol=0)
        self.assertEqual(out[-1].tolist(), [0, 0])
        for asset in self.assets:
            self.assertEqual(hashlib.sha256((self.root / asset['path']).read_bytes()).hexdigest(), asset['sha256'])
        with self.assertRaises(FileExistsError):
            run_recipe(self.path, self.root / 'result')

    def test_identity_timeline_dimensions_and_filename_are_validated_before_output(self):
        for edit in [
            lambda r: r['assets'][0].update(sha256='0' * 64),
            lambda r: r['assets'][0].update(frames=5000),
            lambda r: r['outputs'][0]['terms'][0].update(destinationStart=1, frames=4409),
            lambda r: r['outputs'][0].update(filename='../source.wav'),
            lambda r: r['outputs'].append(copy.deepcopy(r['outputs'][0])),
            lambda r: r['outputs'][0]['terms'][0].update(gainDb=float('nan')),
            lambda r: r['outputs'][0]['terms'][0].update(matrix=[[1, 0], [0, 1]]),
        ]:
            recipe = copy.deepcopy(self.recipe)
            edit(recipe)
            self.save(recipe)
            with self.assertRaises(ValueError):
                run_recipe(self.path, self.root / 'invalid')
            self.assertFalse((self.root / 'invalid').exists())

    def test_clipping_is_refused_without_a_success_receipt(self):
        self.recipe['outputs'][0]['gainDb'] = 30
        self.save()
        with self.assertRaisesRegex(ValueError, 'clip'):
            run_recipe(self.path, self.root / 'loud')
        report = json.loads((self.root / 'loud/receipt.json').read_text())
        self.assertEqual(report['status'], 'failed')
        self.assertFalse((self.root / 'loud/10 - Acoustic.wav').exists())

    def test_project_package_cannot_be_an_output_destination(self):
        self.save()
        with self.assertRaisesRegex(ValueError, 'project'):
            run_recipe(self.path, self.root / 'Untouched.band/Media/new')
        self.assertFalse((self.root / 'Untouched.band').exists())

    def test_unicode_equivalent_filenames_are_rejected_before_render(self):
        second = copy.deepcopy(self.recipe['outputs'][0])
        self.recipe['outputs'][0]['filename'] = 'Guitár.wav'
        second.update(id='second', filename='Guita\u0301r.wav')
        self.recipe['outputs'].append(second)
        self.save()
        with self.assertRaisesRegex(ValueError, 'unique'):
            run_recipe(self.path, self.root / 'collision')
        self.assertFalse((self.root / 'collision').exists())


if __name__ == '__main__':
    unittest.main()
