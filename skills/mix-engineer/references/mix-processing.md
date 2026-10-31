# Offline mixing in physical units

`gb_mix_audio(requestPath, outputDirectory?)` adds deterministic processing and measurement beside the GarageBand GUI. It never changes a project or a source file. Use exported, identified stems with a verified project origin. After rendering, audition in context and import the accepted WAV on a separate track in the authorized project copy.

This is FFmpeg processing, not remote control of GarageBand plug-ins. It does not reproduce a named console, compressor, engineer or commercial plug-in. Keep genre decisions in the mixing skill. The current implementation has no send buses, sidechain routing, reverb, time-varying EQ or compressor gain-reduction history. Use the existing `gb_mix_recipe` to combine aligned processed stems or parallel branches explicitly; this does not recreate native GarageBand bus routing.

## Requests

All requests have `version: 1`, `mode`, `source: {path, sha256}`, and `projectOriginSample`. Paths resolve relative to the JSON request; SHA-256 is lowercase hexadecimal. Origins are nonnegative integer samples at the native sample rate, verified by the caller. Unknown fields are rejected. Inputs use the existing audio limits: mono/stereo, 44.1/48/88.2/96 kHz, at most 600 seconds and 30 million decoded samples per asset.

### Analyze

```json
{
  "version": 1,
  "mode": "analyze",
  "source": {"path": "baseline.wav", "sha256": "<source SHA-256>"},
  "projectOriginSample": 0
}
```

With no output directory, returns measurements without creating files. With a new output directory, retains `receipt.json`. Measurements include per-channel sample peak, RMS, crest factor, DC offset and full-scale sample count; FFmpeg input integrated LUFS, loudness range and true peak; stereo correlation, side RMS and arithmetic mono fold-down. A silent mono fold is explicit. Null means silence/unavailable, never a perfect score. Gated or very short material may have no useful integrated loudness. These metrics cannot determine words, masking, correct polarity, musical balance or acceptable distortion.

### Process

```json
{
  "version": 1,
  "mode": "process",
  "source": {"path": "lead-vocal.wav", "sha256": "<source SHA-256>"},
  "projectOriginSample": 0,
  "chain": [
    {"type": "eq", "frequencyHz": 260, "q": 1.2, "gainDb": -2},
    {"type": "compressor", "thresholdDb": -18, "ratio": 2.5, "attackMs": 15, "releaseMs": 100, "makeupDb": 0, "mix": 1},
    {"type": "gain", "gainDb": -1}
  ]
}
```

The example demonstrates the schema; it is not a vocal preset. Omit output directory to validate source identity and settings. Supply a **new** directory to render `processed.wav` (24-bit PCM) and a receipt containing before/after measurements, the actual filter graph and FFmpeg version. Order is explicit, with 0–16 stages. Frame/channel count must remain unchanged. Source identity is checked before and after work. Output that would clip is rejected; there is no automatic makeup, normalization or limiter.

| Stage | Required parameters and units |
| --- | --- |
| `gain` | `gainDb`: −60…24 dB |
| `highpass`, `lowpass` | `frequencyHz`: 20…min(20000, 0.45×sampleRate); two poles |
| `eq` | `frequencyHz` as above, `q`: 0.1…20, `gainDb`: −24…24 dB; peaking EQ |
| `compressor` | `thresholdDb`: −60…0 dBFS, `ratio`: 1…20, `attackMs`: 0.01…2000, `releaseMs`: 0.01…9000; optional `makeupDb`: 0…24 (default 0), `mix`: 0…1 (default 1); RMS detection and maximum-linked stereo |
| `saturation` | `driveDb`: 0…24, `outputDb`: −60…0; tanh curve with 4× oversampling, no claimed hardware model |
| `deesser` | `intensity`, `maxReduction`, `frequency`: all 0…1 **FFmpeg normalized parameters**, not dB/Hz; no invented physical conversion |

Frame count and project origin are preserved; equal length does not imply phase-identical or zero-latency processing. In the synthetic check, 4× oversampled saturation moved an impulse peak by one sample. Check parallel dry/wet alignment; no automatic compensation is applied. IIR filters change phase; compressor and saturation can change transients; same frame count does not prove perceptual timing preservation. No effect is added automatically. Oversampling reduces but does not guarantee removal of aliasing. Review consonants, cymbals, sustained notes and reverb tails at matched level.

### Compare

Use `mode: "compare"`, add `reference: {path, sha256}` and `referenceProjectOriginSample`, and omit `chain`. Both files must describe the same explicitly aligned excerpt: matching origin, sample rate, channel count and frame count. This tool does not align songs or identify corresponding sections.

Without an output directory, validates the pair. With a new directory, writes `A-source.wav`, `B-reference.wav` and their measurements. It matches integrated programme loudness by **attenuating** to the quieter input; it never boosts or limits either input. Both prepared previews are measured again before publication. A difference above 0.2 LU fails the request and no A/B WAVs are written. FFmpeg measurement rounding and gating mean this is not a sample-null test. Inputs with no measurable programme loudness are rejected. Reference material remains local; this tool provides no download or publication permission.

## Review and recovery

`validated` means schema/identity validation only. `completed` means processing and the described technical checks completed; `listeningPerformed: false` remains explicit. A running/failed receipt or a timed-out call is not a deliverable. Inspect retained files; never retry into the same destination. Output directories inside `.band`/`.logicx` are rejected. A second invocation cannot overwrite an existing output directory. These guarantees assume ordinary local files, not malicious concurrent filesystem replacement.

Dependencies and tool installation are shared with the MCP source installation and its `docs/audio-workflows.md`. Processing behavior and units come from the installed FFmpeg filters and the [official filter documentation](https://ffmpeg.org/ffmpeg-filters.html); receipts record the actual version. Synthetic regression checks establish signal behavior and source preservation, not artistic equivalence to a studio mix.
