# Offline vocal analysis, transposition and vocoder

`gb_vocal_process` runs `scripts/audio_edit/vocal_process.py` without changing GarageBand or a source file. Python with NumPy and FFmpeg/ffprobe is required. This is an addition to native GarageBand pitch correction, not a replacement for a note editor.

```text
python vocal_process.py --request /absolute/request.json
python vocal_process.py --request /absolute/request.json --output /absolute/new-result-directory
```

The first command analyzes pitch in `analyze` mode; in `tune` and `vocoder` modes it validates the complete request without rendering. The second command writes `receipt.json`, and for rendering writes `vocal.wav`. The destination must not exist and must be outside `.band`/`.logicx` packages. Every render is mono 24-bit PCM at the identified source rate, with exactly the source frame count and original `projectOriginSample`. No automatic normalization, limiter or hidden fallback is applied; clipping fails. A failed receipt can coexist with partial output and must not be accepted as a completed render.

## Shared contract

All JSON objects reject unknown fields. Version must be integer `1`. Only one mode's parameter object is accepted. JSON paths in the asset are resolved relative to the request file; absolute local paths are also supported. Use an isolated **clean mono vocal excerpt** no longer than 120 seconds. Supported native rates: 44.1, 48, 88.2 and 96 kHz. Stereo is refused rather than silently downmixed. Identify the input with its SHA-256, exact frames/channels/rate and zero-based project origin. Source and request hashes are rechecked after processing.

```json
{
  "version": 1,
  "mode": "analyze",
  "asset": {
    "path": "lead-vocal.wav",
    "sha256": "REPLACE_WITH_VERIFIED_SHA256",
    "frames": 88200,
    "channels": 1,
    "sampleRate": 44100,
    "projectOriginSample": 0
  },
  "analysis": {
    "minHz": 65,
    "maxHz": 1000,
    "hopMs": 20,
    "confidence": 0.8,
    "gateDb": -55
  }
}
```

The asset values above illustrate a two-second excerpt; replace them with measured values. `projectOriginSample` is a journalled coordinate, not an instruction to insert leading silence. For reimport into GarageBand, place at the original project position or explicitly build a zero-aligned asset using `gb_mix_recipe`; the existing import tool places its WAV at bar 1.

## Pitch analysis

The analyzer finds normalized autocorrelation peaks with sub-sample parabolic interpolation. It reports zero-based sample position, candidate Hz/fractional MIDI note, RMS level, periodicity confidence and voiced/unvoiced classification. It prefers the earliest strong peak to reduce subharmonic selection. `medianHz` is a summary, **not a song key or intended note**.

- `minHz`: 50–1000; `maxHz`: 80–2000 and above `minHz`.
- `hopMs`: 10–100; at most 6000 returned frames. Increase hop or shorten the excerpt when needed.
- `confidence`: 0.5–0.99 periodicity threshold; `gateDb`: -100 to -10 dBFS RMS.
- Defaults are detection starting points; use a singer-appropriate pitch range and inspect results.

Confidence is **not a calibrated probability**. Octave errors, breathy notes, transitions and strong harmonics remain possible. The analyzer does not detect or separate polyphony. It does not infer lyrics, key, note boundaries, tuning intent or vibrato correction. Do not interpret a speech/scream contour as a musical tuning target. Review a candidate contour against the vocal, accompaniment and intended melody before defining corrections.

## Reviewed constant transposition

Set `mode: "tune"`, remove `analysis`, and supply:

```json
{
  "backend": "ffmpeg-atempo",
  "regions": [
    {"startSample": 22050, "endSample": 66150, "semitones": -0.35, "fadeSamples": 441}
  ]
}
```

Place that object under `tune`. This moves a reviewed interval down 35 cents. Regions are ordered, nonoverlapping, within the source, at least 50 ms long, and have room for both fades. There are 1–16 regions; semitones range from -12 to 12 and may be fractional. `fadeSamples` is at least 2. Equal-gain sine-squared transitions run **inside** the stated interval; samples outside all regions remain unchanged before optional output gain. Zero semitones is an exact identity before PCM quantization.

Backend selection is explicit:

| Backend | Behavior | Limits |
|---|---|---|
| `ffmpeg-atempo` | FFmpeg `asetrate` + resampling + inverse tempo; receipt records the actual semitone ratio after integer rate rounding | Experimental transposition. Formants move. Consonant/transient timing and timbre may change. No transparent-tuning claim. |
| `rubberband-cli` | Installed Rubber Band CLI, R3 `--fine` engine at time ratio 1, `--pitch` in semitones and `--formant` | Requires a verified CLI on PATH advertising the required options. Uses identified floating-point scratch WAVs inside the output directory; scratch is removed after decoding. Preservation still needs listening review. |
| `rubberband` | FFmpeg Rubber Band filter at tempo 1 and requested pitch ratio, with formant preservation requested | Requires FFmpeg built with `librubberband`. Fails before output creation when absent; no fallback. Preservation request is not a listening-quality guarantee. |

The implementation provides real neighbouring audio as context, and reflected context at processing boundaries, then crops the processed result. Reflected context is discarded. A short active render is **rejected**, never filled with zero samples. Exact output length preserves the project timeline, but does not establish unchanged internal attack timing. A/B consonants, note entrances, vibrato, slides and fades before accepting the result. The receipt identifies the actual backend. The CLI backend checks `--full-help` and `--version`, disables its automatic clipping-triggered gain reduction with `--ignore-clipping`, and requires floating-point intermediate output. Rubber Band CLI can still clamp that output at full scale, so the adapter rejects any intermediate sample with absolute value at least 1, including context, before cropping or final gain can hide it. Backend availability is verified on the running machine; do not infer a successful CLI test from FFmpeg-only tests.

This is not automatic scale snapping or independently editable note center/drift/vibrato/formant correction. For natural vocal tuning, use native GarageBand correction or a verified dedicated note editor; choose small reviewed corrections and preserve intentional slides. For robotic hard tuning, a vocoder below produces a different, explicit synthesis effect.

## True spectral filter-bank vocoder

Set `mode: "vocoder"`, remove `analysis`, and supply a `vocoder` object:

```json
{
  "bands": 20,
  "minHz": 100,
  "maxHz": 8000,
  "attackMs": 5,
  "releaseMs": 60,
  "wet": 1,
  "events": [
    {"startSample": 0, "endSample": 88200, "notes": [48, 55, 60]}
  ]
}
```

This is a vocoder: the vocal provides changing band envelopes, while an explicitly scheduled synthesizer chord supplies pitch and harmonics. It is not a pitch-shifter or a distortion preset. The engine uses centered overlapping STFT frames, logarithmically spaced triangular bands, per-band envelope attack/release and a deterministic polyBLEP saw carrier. The carrier's band levels are replaced by the modulator's smoothed envelopes, with bounded gain. Overlap-add reconstructs the audio. No external plugin or MIDI routing is needed.

- Bands: 8–48. Frequency range defaults to 100–8000 Hz; min 60–1000 Hz, max 2000–16000 Hz below Nyquist.
- Attack: 1–100 ms; release: 5–500 ms. `wet`: 0–1; zero wet is exact dry identity before output gain/PCM quantization.
- Carrier events: 1–128 ordered, nonoverlapping intervals inside the source. Each contains 1–8 unique integer MIDI notes from 24 to 96. Chords belong in one event. Note event edges receive a 5 ms fade where their duration permits.
- An absent modulator produces silence. No carrier means no fully wet output. Gaps and short note events can leave a brief STFT/envelope transition; this is an offline effect, not a zero-tail hard gate.
- The 2048-sample frame at 44.1/48 kHz (4096 at higher rates) trades consonant detail for stable bands. This deliberately synthetic effect needs listening approval; it is not a model of any named commercial vocoder. There is no dedicated sibilant/unvoiced detector or formant-shift control.

Choose carrier notes from the actual harmony. Render dry and wet layers separately for blend decisions; do not replace the only clean lead. A top-level `gainDb` from -60 to +24 applies explicitly to renders only. Clipping is refused; reduce gain instead of assuming a hidden limiter.

## Evidence and sources

Tests exercise pitch detection on tones, silence and seeded noise; a measured two-semitone transposition; exact region-exterior preservation and dry/zero identity; vocoder dependence on both modulator and carrier; deterministic exports; invalid fields/nonfinite values/stale hashes; output collisions/project-package protection; clipping; unavailable backends and short-render rejection. The optional installed-CLI tests also exercise a real R3 render, source/scratch preservation and a synthetic vowel spectral-envelope comparison against an unpreserved shift. With the locally verified Rubber Band CLI 4.0.0, a +7-semitone test kept the lower-envelope centroid near 822 Hz versus 801 Hz in the source and 1195 Hz with the unpreserved backend. This is a narrow synthetic regression check, not proof of transparent treatment of a singer. These are technical DSP checks on synthetic fixtures, not a listening review of a singer.

- [Rubber Band official CLI source and help](https://github.com/breakfastquay/rubberband/blob/default/main/main.cpp): units, R3 engine, formant option and the default clipping-triggered gain reduction. The CLI adapter requests explicit options and checks the installed help/version.
- [FFmpeg filter documentation](https://ffmpeg.org/ffmpeg-filters.html): official contracts for `asetrate`, `aresample`, `atempo` and `rubberband`; build support is checked at runtime.
- [Paul Boersma, 1993: Accurate Short-Term Analysis of Fundamental Frequency](https://www.fon.hum.uva.nl/paul/papers/Proceedings_1993.pdf): primary background for lag-domain periodicity analysis. This small analyzer is **not** an implementation or accuracy claim for Praat/Boersma's full method.
- [Julius O. Smith, Spectral Audio Signal Processing: STFT](https://www.dsprelated.com/freebooks/sasp/Short_Time_Fourier_Transform.html): author-published mathematical basis for spectral analysis and overlapping synthesis. The specific vocoder design here is our implementation, not a copied commercial algorithm.
