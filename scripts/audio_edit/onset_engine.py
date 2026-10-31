"""Offline 44.1 kHz onset/edit primitives; never opens or modifies GarageBand."""
import json
import os
import subprocess
import tempfile
import wave
from pathlib import Path
import numpy as np

SR = 44100


def decode(path):
    info = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_streams', '-of', 'json', str(path)
    ]))
    channels = info['streams'][0]['channels']
    data = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0', '-ar', str(SR), '-f', 'f32le', '-'
    ])
    return np.frombuffer(data, dtype='<f4').reshape(-1, channels).astype(float)


def write_wav(path,x):
    path=Path(path)
    x=np.asarray(x,dtype=float)
    if x.ndim not in (1,2) or not x.size or not np.all(np.isfinite(x)):
        raise ValueError('Audio must contain finite mono or interleaved channel samples')
    if np.max(np.abs(x))>=1:raise ValueError('Audio would clip; adjust gain explicitly before writing')
    pcm=np.rint(x.reshape(-1)*2**23).astype(np.int32)
    if np.any(pcm>=2**23):raise ValueError('Audio exceeds the positive 24-bit PCM range')
    channels=1 if x.ndim==1 else x.shape[1]
    packed=((pcm[:,None] >> np.array([0,8,16])) & 255).astype(np.uint8).tobytes()
    # Publish only a complete WAV; hard-link creation cannot overwrite a source.
    with tempfile.NamedTemporaryFile(prefix='audio-write-',suffix='.wav',dir=path.parent,delete=False) as temporary:
        temporary_path=Path(temporary.name)
    try:
        with wave.open(str(temporary_path),'wb') as output:
            output.setparams((channels,3,SR,0,'NONE','not compressed'))
            output.writeframes(packed)
        os.link(temporary_path,path)
    finally:
        temporary_path.unlink()

def detect(x,grid):
    # Analyse channels by energy, never summing antiphase stereo to mono.
    x=np.asarray(x,dtype=float)
    grid=np.asarray(grid,dtype=float)
    if x.ndim==1:x=x[:,None]
    if x.ndim!=2 or not x.shape[1] or not np.all(np.isfinite(x)):raise ValueError('Expected finite audio channels')
    if grid.ndim!=1 or not np.all(np.isfinite(grid)) or np.any(np.diff(grid)<=.08) or np.any(grid<0) or np.any(grid>=len(x)/SR):
        raise ValueError('Anchors must be finite, increasing, at least 80 ms apart and inside the source')
    if not len(grid):return []
    if len(x)<882 or np.max(np.abs(x))<1e-6:return []
    hop=88;win=882
    frames=np.lib.stride_tricks.sliding_window_view(x,win,axis=0)[::hop]
    rms=np.sqrt(np.mean(frames**2,axis=(1,2)))
    spectrum=np.abs(np.fft.rfft(frames*np.hanning(win),n=2048,axis=-1))
    flux=np.r_[0,np.maximum(np.diff(np.log1p(spectrum*10),axis=0),0).mean(axis=(1,2))]
    t=(np.arange(len(flux))*hop+win/2)/SR
    events=[]
    for index,expected in enumerate(grid):
        left=max(expected-.17,(grid[index-1]+expected)/2+.005) if index else expected-.17
        right=min(expected+.13,(expected+grid[index+1])/2-.005) if index+1<len(grid) else expected+.13
        lo,hi=np.searchsorted(t,[left,right])
        candidates=[]
        for candidate in range(lo,hi):
            preceding=float(np.mean(rms[max(0,candidate-18):max(1,candidate-5)]))
            following=float(np.mean(rms[candidate+2:candidate+15]))
            if following>=max(.001,preceding*1.25):candidates.append(candidate)
        if not candidates:raise ValueError(f'No confident rising attack near {expected:.3f} seconds')
        p=max(candidates,key=lambda candidate:flux[candidate])
        floor=max(0,p-12)
        q=p
        while q>floor and flux[q-1]>.25*flux[p]:q-=1
        # The centred FFT includes future energy; local RMS refines silent attacks.
        begin=int((t[q]-.005)*SR)
        peak=int(t[p]*SR)
        finehop=44
        low=max(0,peak-int(.055*SR));high=min(len(x),peak+int(.025*SR))
        if high-low<220:raise ValueError('Attack too close to source boundary for reliable refinement')
        fine=np.sqrt(np.mean(np.lib.stride_tricks.sliding_window_view(x[low:high],220,axis=0)[::finehop]**2,axis=(1,2)))
        base=float(np.min(fine[:max(1,len(fine)//2)]));top=float(np.percentile(fine,90))
        if base<top*.15:
            candidates=np.flatnonzero(fine>max(top*.16,base*4))
            if len(candidates):begin=low+int(candidates[0])*finehop+110
        begin=max(low,min(begin,peak))
        events.append({'expected':float(expected),'peakSample':peak,'onsetSample':begin,'onsetSeconds':begin/SR,'strength':float(flux[p]),'gridShiftMs':float((expected-begin/SR)*1000)})
    assert all(b['onsetSample']-a['onsetSample']>int(.08*SR) for a,b in zip(events,events[1:]))
    return events

def envelope(x,hop=88):
    # 2 ms block energy with a 6 ms analysis window.
    pad=np.pad(x,(0,264))
    return np.sqrt(np.mean(np.lib.stride_tricks.sliding_window_view(pad,264)[::hop]**2,axis=1))

def clean_segment(x,noise):
    env=envelope(x);threshold=max(noise*7,.0025)
    active=env>threshold
    # Keep 8 ms pre-roll and 24 ms release; remove only sustained low-level gaps.
    expanded=np.zeros_like(active)
    for shift in range(-4,13):
        if shift>=0:expanded[shift:] |= active[:len(active)-shift] if shift else active
        else:expanded[:shift] |= active[-shift:]
    gain=np.interp(np.arange(len(x)),np.arange(len(expanded))*88,expanded.astype(float))
    started=False
    quiet=0
    for i,on in enumerate(active):
        if on:started=True;quiet=0
        elif started:quiet+=1
        if quiet>=18:
            release=max(0,(i-quiet+1)*88)
            end=min(len(gain),release+882)
            gain[release:end]*=np.linspace(1,0,end-release)
            gain[end:]=0
            break
    kernel=np.hanning(441);kernel/=kernel.sum()
    gain=np.convolve(np.pad(gain,(220,220),mode='edge'),kernel,mode='valid')[:len(x)]
    return x*gain

def stretch_tail(x,wanted,*,allow_time_stretch=False):
    # Only reviewed steady sustain may be stretched, never an inferred slide.
    x=np.asarray(x,dtype=float)
    if x.ndim!=1 or not len(x) or not np.all(np.isfinite(x)):raise ValueError('Expected finite nonempty mono audio')
    if isinstance(wanted,bool) or not isinstance(wanted,(int,np.integer)) or wanted<len(x):
        raise ValueError('Requested samples must preserve the source; trimming is a separate edit')
    if wanted==len(x):return x.copy(),False
    if not np.any(x[-min(882,len(x)):]):
        return np.pad(x,(0,wanted-len(x))),False
    if not allow_time_stretch:raise ValueError('Active sustain requires review; preserve slides as a single phrase')
    if len(x)<3000:raise ValueError('Too few samples for a protected attack and continuous sustain')
    protect=2205;overlap=661
    tail=x[protect:]
    target=wanted-protect
    tempo=len(tail)/target
    if tempo<.5:raise ValueError('Requested stretch exceeds the reviewed single-stage tempo range')
    result=subprocess.check_output(['ffmpeg','-v','error','-f','f32le','-ar',str(SR),'-ac','1','-i','-','-af',f'atempo={tempo:.10f}','-f','f32le','-'],input=tail.astype('<f4').tobytes())
    y=np.frombuffer(result,dtype='<f4').astype(float)
    if not np.all(np.isfinite(y)):raise ValueError('Renderer returned non-finite samples')
    if len(y)<target:raise ValueError(f'Renderer returned a short tail ({len(y)} of {target} samples); refusing a silent dropout')
    y=y[:target]
    fade=np.linspace(0,1,overlap)
    z=np.r_[x[:protect],x[protect:protect+overlap]*(1-fade)+y[:overlap]*fade,y[overlap:]]
    return z[:wanted],True

def event_features(x,start,end):
    clip=x[start:end]
    env=envelope(clip)
    shape=np.interp(np.linspace(0,max(0,len(env)-1),120),np.arange(len(env)),env)
    shape/=max(.001,np.max(shape))
    window=clip[:min(len(clip),int(.18*SR))]
    spec=np.abs(np.fft.rfft(window*np.hanning(len(window)),n=16384))
    freqs=np.fft.rfftfreq(16384,1/SR)
    bands=np.array([np.sum(spec[(freqs>=a)&(freqs<b)]**2) for a,b in zip([60,100,150,230,350,550,850,1300,2000,3200],[100,150,230,350,550,850,1300,2000,3200,6000])])
    bands=np.sqrt(bands);bands/=max(1e-9,np.linalg.norm(bands))
    return shape,bands
