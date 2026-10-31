"""Find pick attacks near reviewed anchors and extract independently reusable WAV regions.

Works offline. It never changes a GarageBand project. Native split execution is
separate and requires a verified source-to-project mapping and saved project copy.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np

import onset_engine as engine

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--anchors',type=Path,required=True,help='JSON array of approximate attack positions in source seconds')
    parser.add_argument('--project-offset',type=float,required=True,help='Verified offset: project seconds = decoded source seconds + offset')
    parser.add_argument('--end',type=float,required=True,help='Explicit source end in seconds')
    parser.add_argument('--output',type=Path,required=True,help='New directory for manifest and unprocessed extracted regions')
    args=parser.parse_args()
    anchors=np.asarray(json.loads(args.anchors.read_text()),dtype=float)
    if anchors.ndim!=1 or len(anchors)==0 or not np.all(np.isfinite(anchors)) or np.any(anchors<0) or np.any(np.diff(anchors)<=.08):raise ValueError('Anchors must be nonnegative and increase, at least 80 ms apart')
    if not np.isfinite(args.project_offset):raise ValueError('Project offset must be finite')
    if not np.isfinite(args.end) or args.end<=anchors[-1]:raise ValueError('Finite end must follow last anchor')
    if args.output.exists():raise FileExistsError(args.output)
    x=engine.decode(args.input)
    if round(args.end*engine.SR)>len(x):raise ValueError('End exceeds source duration')
    events=engine.detect(x,anchors)
    if len(events)!=len(anchors):raise ValueError('Missing attacks; no output written')
    preroll=round(.008*engine.SR)
    starts=[max(0,event['onsetSample']-preroll) for event in events]
    ends=starts[1:]+[round(args.end*engine.SR)]
    if any(end<=event['onsetSample'] for event,end in zip(events,ends)):raise ValueError('End must follow every detected attack; no output written')
    args.output.mkdir(parents=True)
    regions=[]
    for i,(event,start,end) in enumerate(zip(events,starts,ends)):
        file=f'region-{i+1:02d}.wav'
        engine.write_wav(args.output/file,x[start:end])
        regions.append({**event,'sourceRangeSamples':[start,end],'projectStartSeconds':start/engine.SR+args.project_offset,'file':file,'samples':end-start})
    result={'source':str(args.input.resolve()),'sourceSha256':hashlib.sha256(args.input.read_bytes()).hexdigest(),'decodedSampleRate':engine.SR,'sourceToProjectOffsetSeconds':args.project_offset,'preRollSamples':preroll,'mappingRequiresIndependentVerification':True,'regions':regions}
    (args.output/'manifest.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({'regions':len(regions),'output':str(args.output.resolve())}))

if __name__=='__main__':main()
