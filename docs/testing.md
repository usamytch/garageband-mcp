# Validation and limits

## Automated checks

```sh
npm ci
npm run check
```

The suite exercises control conversions/readback, idempotent setters, stale/overlapping region plans, export completion, normalization restoration, stale Smart Control refresh, FIFO/error/cancellation behavior, a real cross-process lock, project-switch rejection through MCP's in-memory transport, automation geometry and drag release, and portable data paths.

The stdio smoke test starts the built server, lists 60 tools, checks that 48 require `projectPath`, and confirms a missing target is rejected before any GUI action. It also checks the generated tool catalog. It does not launch GarageBand, create a MIDI port or render audio. CI runs these checks on macOS with Node 22; it has no interactive GarageBand session.

## Live evidence

The publication environment has macOS 26.6.1 and GarageBand 10.4.14. The GUI adapter was exercised with English labels. Earlier local live checks covered mixer writes, ordinary audio/MIDI region moves, save/reopen and WAV exports. An experimental vocal automation run used 33 points; 12 measured vocal plateaus differed from their recorded fader-level deltas by at most 0.101 dB. Controlled save/reopen and bypass/restore exports were compared. This is a bounded local observation, not a compatibility matrix or a listening-quality certification.

Private projects, recordings, screenshots and measurement outputs are deliberately not redistributed. Publication-time automated tests do not reproduce that live session. New machine/OS/patch combinations require their own disposable-project checks. Timing from visible pixels is not sample-accurate timing.

## Opt-in live fixture scripts

The `.band` fixture is not shipped. Create an expendable project at **this checkout's** `fixtures/MCP-Mixer-Test.band`, save and open it, turn automation display off, stop transport and make the relevant bars/tracks visible. Every script asserts its expected fixture shape before editing. The scripts modify the fixture and leave a documented state; they are not one interchangeable test suite.

1. `node test/live.mjs "$PWD/fixtures/MCP-Mixer-Test.band"`: start with exactly two compatible software-instrument tracks, each containing one ordinary MIDI region from bar 1 to bar 6. It checks mixer behavior, moves, stale/overlap rejection, reopen and WAV output, then leaves the first region at bars 3–8. Muted output must be silent.
2. Prepare the next phase manually: keep the first MIDI region at bars 3–8; insert an audio track in position 2 containing a two-bar nonlooped audio region named `Audio-Region-Fixture` at bars 1–3; keep the second MIDI track at position 3, bars 1–6. Save.
3. `node test/live-audio.mjs "$PWD/fixtures/MCP-Mixer-Test.band"`: checks wrong-track rejection and audio moves, adds track 4 and leaves the audio at bars 5–7 there. It exports solo and full audio.
4. `node test/live-region-smoke.mjs "$PWD/fixtures/MCP-Mixer-Test.band"`: with that final four-track shape, moves the audio between tracks and restores its layout. This smoke case does not itself render.
5. `node test/live-saved.mjs "$PWD/fixtures/MCP-Mixer-Test.band"`: requires the exact final shape and mixer state from the earlier phases; checks persistence and exports again.

Results go under `runtime/live/<scenario>-<timestamp>/`. A failure can leave a partially edited fixture. Inspect the journal and project before retrying; recreate the disposable fixture when its preconditions no longer hold.

Verify exports with `python3 test/verify-audio.py <wav> ...` (FFmpeg required). A file whose stem is `Muted` is expected to be exactly silent; others must contain signal and sample peaks below full scale. `test/compare-audio.py <source> <bounce> <offset-seconds>` checks a moved dry fixture's waveform up to constant gain; disable nonlinear/time-varying processing for that specific test. Neither script measures true peak or musical quality.

## Future work

- Fractional-bar region positions with explicit beat/tick conversion and rendered timing checks.
- Automation point enumeration/editing where reliable; geometry-independent timing and explicit rollback semantics.
- Audio Unit parameter discovery in physical units, with per-plugin metadata and capability detection.
- More GarageBand versions, display scales and project types; checked-in synthetic fixture generation.
- Structured, repeatable listening evaluations for the six genre profiles.
