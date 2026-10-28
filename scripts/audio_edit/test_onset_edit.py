import unittest
import numpy as np

import onset_engine as edit

ANCHORS=np.arange(1.0,5.0,.4)

class OnsetEditTest(unittest.TestCase):
    def test_silence_has_no_attacks(self):
        self.assertEqual(edit.detect(np.zeros(6*edit.SR),ANCHORS),[])

    def test_attack_timing_and_antiphase_stereo(self):
        x=np.zeros(6*edit.SR)
        true=[]
        for i,target in enumerate(ANCHORS):
            onset=int((target+(.025 if i%2 else -.017))*edit.SR)
            true.append(onset)
            t=np.arange(int(.11*edit.SR))/edit.SR
            wave=.15*np.sin(2*np.pi*(220+i*7)*t)*np.minimum(1,t/.003)*np.exp(-t*20)
            x[onset:onset+len(wave)]+=wave
        mono=edit.detect(x,ANCHORS)
        stereo=edit.detect(np.column_stack([x,-x]),ANCHORS)
        self.assertEqual(len(mono),len(true))
        for expected,a,b in zip(true,mono,stereo):
            self.assertLess(abs(a['onsetSample']-expected)/edit.SR,.008)
            self.assertEqual(a['onsetSample'],b['onsetSample'])

    def test_pause_does_not_reopen_for_hand_noise(self):
        t=np.arange(edit.SR)/edit.SR
        x=np.where(t<.18,.1*np.sin(2*np.pi*330*t),.0004*np.sin(2*np.pi*50*t))
        x[int(.6*edit.SR):int(.61*edit.SR)]+=.02
        y=edit.clean_segment(x,.0004)
        self.assertGreater(np.max(np.abs(y[:int(.15*edit.SR)])),.09)
        self.assertEqual(np.max(np.abs(y[int(.3*edit.SR):])),0)

    def test_sustain_extension_preserves_pick(self):
        t=np.arange(10000)/edit.SR
        x=.1*np.sin(2*np.pi*330*t)
        y,changed=edit.stretch_tail(x,11000)
        self.assertTrue(changed)
        self.assertEqual(len(y),11000)
        np.testing.assert_array_equal(x[:1544],y[:1544])

if __name__=='__main__':unittest.main()
