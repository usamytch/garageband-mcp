# Onset-guided editing helpers

The offline prototype finds attacks near reviewed time anchors and extracts adjacent WAV regions. It never opens GarageBand or modifies a project. The detector, noise cleanup and sustain helpers were extracted from a local guitar-intro editing session; the song, private paths, recordings and session logs are not part of this repository.

## Offline extraction

Requirements: Python 3, NumPy 2.x, FFmpeg and ffprobe. The MCP server itself still requires no Python packages. Install the optional dependency in a Python environment of your choice:

```sh
python3 -m pip install -r scripts/audio_edit/requirements.txt
python3 -m unittest discover -s scripts/audio_edit -p 'test_*.py'
```

Provide a JSON array of approximate attacks in source seconds, for example `[0.8, 1.4, 2.0]`. Confirm the relationship between source time and project time independently, then run:

```sh
python3 scripts/audio_edit/onset_regions.py \
  --input /absolute/path/to/take.wav \
  --anchors /absolute/path/to/anchors.json \
  --project-offset 3.2 --end 2.7 \
  --output /absolute/path/to/new-regions
```

The destination must not exist. The manifest records the input SHA-256, attack and peak samples, source ranges, the supplied project offset and an 8 ms pre-roll. Files are decoded to 44.1 kHz; sample indices refer to that decoded PCM. Output regions are unprocessed 24-bit WAVs. Concatenating them reconstructs the corresponding decoded source interval. Stereo energy is analyzed without summing opposite-polarity channels.

This is an anchor-guided pick detector, not a general phrase recognizer. It selects a candidate near each anchor and does not establish that the candidate is musically correct. Review the boundaries and listen before moving audio. The offset alone does not describe Flex, reverse, loops, tempo maps or take folders. Those need a separate mapping implementation.

`onset_engine.py` also contains the session's mono pause-cleaning and spectral/envelope comparison primitives. They are opt-in building blocks, not automatically applied by the extraction command. Noise thresholds and tail policies need review for the recording in use.

### Continuity and stretch safety

Do not split a slide, bend, ringing chord or legato phrase at every grid anchor. Preserve the phrase and review its timing as a unit. The detector now requires an energy rise; the steady-tone and stationary-noise regression cases are rejected instead of manufacturing one event per anchor. It still cannot certify that a candidate is a picked note.

`stretch_tail` extends existing digital silence without processing the source. Active sustain is rejected by default. `allow_time_stretch=True` is only for a separately reviewed steady sustain, never automatic permission inferred from an RMS threshold. The first 50 ms remain verbatim. A non-finite or short FFmpeg result fails the edit; it is never padded with zeroes inside the note. Trimming is a separate operation. This stricter contract intentionally stops legacy recipes that assumed every requested duration could be produced.

The previous implementation trusted the requested tempo ratio, then padded a short `atempo` result to its expected length. This introduced an abrupt interior transition into silence even when the eventual segment boundary was faded to zero. Length, first-25-ms identity, peak level and boundary samples all missed that failure. Inspect the entire processed interval, protected articulations, joins and fades. Numerical checks are necessary but do not replace matched-level listening.

`write_wav` validates finite, nonempty audio and PCM range, writes a complete 24-bit WAV in the destination directory, then publishes it without overwriting an existing path. Use a new candidate filename; replacement of an accepted deliverable is an explicit separate operation after verification. No audio-processing failure should silently replace the user's source.

### Reviewed phrase plans

Use `python3 scripts/audio_edit/edit_plan.py --input source.wav --plan plan.json --output new-candidate` for new timing edits. The sample timeline is the decoded 44.1 kHz source, not a guessed GarageBand tick rate. A version-1 plan contains `sampleRate`, `sourceSha256`, `sourceFrames`, `channels`, `outputFrames`, `reviewed: true`, `protectedPhrases` and `clips`. Each clip has `sourceStart`, `sourceEnd`, `destinationStart`, and optional `fadeInSamples` / `fadeOutSamples`; all are integer sample counts. A protected phrase has `start`, `end` and `kind` (`slide`, `legato`, `pickup`, `attack` or `ringing`).

Review protection ranges before setting `reviewed`. Every protected phrase must be covered exactly once by a whole clip, with no cut or fade touching it. Clips move without stretching; overlapping destination ranges are rejected. Unprotected omissions and timing moves remain explicit choices in the plan. This does not infer musical phrasing from an RMS threshold.

The candidate is compared against the same source clips on the planned destination timeline. The report covers internal dropouts, discontinuities, joins, protected samples and changes outside planned fades. A failed technical check writes a report and no deliverable. A passing run writes `candidate.wav`, `quality.json`, `original-matched.wav` and `candidate-matched.wav`. Require both `technicalPass` and `renderComplete`; interrupted or failed output writes must not be accepted. The A/B pair uses only level reductions, with shared peak headroom. It compares the planned, unprocessed source segments with the processed candidate; it is not an unshifted original-performance comparison. Listening acceptance is always separate.

Legacy session-specific scripts may contain their own unreviewed padding or cutting policies. Do not copy those branches into a new recipe; use the reviewed plan and shared quality checks. Existing private recordings and historical edit reports do not belong in the repository.

## Guarded native examples

Run `npm test` to generate `test-build/` before using `examples/onset-edit/run-ax.mjs`. The runner requires a saved project, canonicalizes its path, holds the shared GUI lock, verifies the target and records a new journal file. It never reuses an existing journal.

```sh
node examples/onset-edit/run-ax.mjs \
  /absolute/path/to/Disposable-Copy.band \
  examples/onset-edit/final-view.jxa \
  /absolute/path/to/new-view-journal.json
```

`final-view.jxa` hides side panes, sets an approximate overview zoom with native mouse actions and resets horizontal scrolling. `seek-position.jxa` is limited to stopped transport, the Beats LCD and the locally tested 4/4 bar/beat/division/tick fields. Pass a JSON object such as `'{"bar":3,"beat":1,"division":1,"tick":1}'` as the final argument. Do not infer a ticks-per-quarter rate from the field names; calibrate against an export first.

`split-at-playhead.jxa` requires exactly one selected region, its exact `regionName`, `trackIndex`, and the expected LCD `position`. It checks those before invoking Split Regions at Playhead, then verifies one added region and unchanged neighboring tracks. Each run is one edit. A failed verification may leave a completed or partial edit: inspect the journal instead of blindly retrying or undoing. Use only a disposable copy, hide automation, and verify the exported audio after save/reopen. The extracted examples were syntax-checked; the parameterized wrappers have not been run as a general compatibility suite.

## Timeline zoom crash workaround

On GarageBand 10.4.14 / macOS 26.6.1, writing `AXValue` directly to Horizontal Zoom reproduced a later `EXC_BAD_ACCESS` at address `0x360` in `CLgZoomSliderView` during project reopening. Its first application-frame offset matched two earlier crash reports. Ordinary close/reopen, rename, new-track creation and export without that zoom write did not reproduce the crash in the local controls.

Use the `setTimelineZoom` helper in `native-ax.ts`. It uses normal mouse events and reads back the result; the generic `setSlider` helper rejects timeline zoom. Native clicks advance the control in coarse steps, so the result is approximate and the actual value is returned. No Accessibility requests occur between mouse-down and mouse-up, and mouse release is protected by `finally`.

Five local save/close/reopen cycles at different requested zoom values completed in the same GarageBand process, without new crash reports. Mixer state was unchanged and the subsequent full-song PCM export matched the baseline exactly. This verifies the local automation workaround; it is not a patch to GarageBand or a claim about unrelated crashes.

## Evidence and cleanup

Synthetic tests cover attack timing, silence, opposite-polarity stereo, pause cleanup, preserved pick samples, source preservation, existing-output rejection and exact reconstruction of extracted PCM. The local music session additionally verified 38 native splits across two takes, source-track preservation and sample-identical save/reopen renders. Auditory evaluation by the agent was not performed.

Keep final projects, delivered previews, source hashes, edit plans and verification summaries in the user's task folder. Intermediate full-song renders, extracted segment copies, diagnostic project clones and bytecode caches can be removed after preserving the results. Keep `test-build/` while the guarded examples depend on it. Private session material stays outside Git.
