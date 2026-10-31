# Validation and limits

## Automated checks

```sh
npm ci
npm run check
```

Audio helpers have a separate Python/FFmpeg dependency set. After installing
`scripts/audio_edit/requirements.txt`, run `npm run check:all` to include them.
CI runs both the Node checks and a separate audio job. Audio regression cases
cover short renderer output, protected phrases requiring review, false attacks
on steady material, finite mappings, non-destructive WAV publication and PCM
reconstruction. They do not certify the musical quality of a stretched phrase.

The suite exercises control conversions/readback, idempotent setters, stale/overlapping region plans, export completion, normalization restoration, stale Smart Control refresh, FIFO/error/cancellation behavior, a real cross-process lock, project-switch rejection through MCP's in-memory transport, automation geometry and drag release, and portable data paths.

Export/import regressions also cover unfinished WAV containers, metadata-only WAV changes versus changed samples, recovery-journal failures, partial setting writes, bounded streaming downloads and HTTPS redirects, window-owner selection and neighboring-region preservation. Python cases reject silent gaps inside active audio and edits crossing protected phrases; a failed output write cannot leave a successful render report.

The stdio smoke test starts the built server, lists 68 tools, checks that 52 require `projectPath`, and confirms a missing target is rejected before any GUI action. It also checks the generated tool catalog. It does not launch GarageBand, create a MIDI port or render audio. CI runs these checks on macOS with Node 22; it has no interactive GarageBand session.

Durable-export tests use a fake renderer with real files, locks and detached Node processes. They kill a client, kill a worker after rendering, retain an orphan child, and crash after completion before recovery-fence cleanup. Additional cases cover late completion, failed restoration, corrupted journals, output collisions and changed mixer state. GUI preparation must succeed before reading or changing settings; recovery waits for native rendering to finish before preparing the window. These prove process/recovery behavior without exercising GarageBand's export dialog. Offline tests cover per-channel seam diagnostics, boundary context, known short dropouts, protected slide mappings, native-rate previews, recipe timing/identity, channel matrices, clipping rejection and non-overwriting output.

## Live evidence

The publication environment has macOS 26.6.1 and GarageBand 10.4.14. The GUI adapter was exercised with English labels. Earlier local live checks covered mixer writes, ordinary audio/MIDI region moves, save/reopen and WAV exports. An experimental vocal automation run used 33 points; 12 measured vocal plateaus differed from their recorded fader-level deltas by at most 0.101 dB. Controlled save/reopen and bypass/restore exports were compared. This is a bounded local observation, not a compatibility matrix or a listening-quality certification.

A subsequent local automation-view roundtrip used a disposable 73-region project copy. Repeated visibility requests, rejection of region reads while automation was visible, unchanged region/selection/mixer state and save/reopen passed through a fresh stdio client. All 73 regions exposed parsed display positions, including 48 with fractional boundaries. The 195.2-second stereo 24-bit WAV differed from its existing baseline by at most one 24-bit PCM step (RMS difference -168.54 dBFS). This validates the view/readback change on that setup, not fractional movement or attack-based splitting.

The export/import update was checked on the existing disposable fixture through a fresh MCP process. Whole-song and solo-variant exports decoded as 195.2-second stereo 24-bit WAVs; all 14 original tracks and their region state were identical after the batch. An eight-second synthetic WAV imported at bar 1, retained identical audio data despite added GarageBand metadata, and survived save/close/reopen with identical region state. Its control export had zero sample offset and less than one 24-bit PCM step of residual after constant-gain fitting. A batch range produced exactly 352800 frames with a one-second fade ending at zero; its samples matched the specified fade within one 24-bit PCM step. These are technical checks on this fixture, not listening approval or general compatibility claims.

The durable exporter was subsequently exercised on that existing 14-track, 73-region fixture through fresh stdio clients. A normal export, a killed MCP server, a worker killed after its WAV appeared, and a save/reopen control export all produced identical decoded PCM: 8608320 stereo frames at 44.1 kHz, 24-bit, 195.2 seconds. WAV container metadata differed. Recovery retained the rendered source's inode and modification time, restored the original solo state, and blocked an unrelated GUI edit until recovery completed. Tracks, selection, region layout and transport matched their initial snapshots after every scenario and after reopening. All 506 files in the separate working projects remained hash-identical; saving the disposable fixture changed its project/display metadata but none of its audio files. The first native attempt exposed missing window preparation before reading export preferences; it stopped before mixer writes, and the corrected path passed these checks. These observations cover this local fixture and do not certify listening quality or other GarageBand setups.

Private projects, recordings, screenshots and measurement outputs are deliberately not redistributed. Publication-time automated tests do not reproduce that live session. New machine/OS/patch combinations require their own disposable-project checks. Timing from visible pixels is not sample-accurate timing.

## Opt-in live fixture scripts

The `.band` fixture is not shipped. Create an expendable project at **this checkout's** `fixtures/MCP-Mixer-Test.band`, save and open it, turn automation display off, stop transport and make the relevant bars/tracks visible. Every script asserts its expected fixture shape before editing. The scripts modify the fixture and leave a documented state; they are not one interchangeable test suite.

1. `node test/live.mjs "$PWD/fixtures/MCP-Mixer-Test.band"`: start with exactly two compatible software-instrument tracks, each containing one ordinary MIDI region from bar 1 to bar 6. It checks mixer behavior, moves, stale/overlap rejection, reopen and WAV output, then leaves the first region at bars 3–8. Muted output must be silent.
2. Prepare the next phase manually: keep the first MIDI region at bars 3–8; insert an audio track in position 2 containing a two-bar nonlooped audio region named `Audio-Region-Fixture` at bars 1–3; keep the second MIDI track at position 3, bars 1–6. Save.
3. `node test/live-audio.mjs "$PWD/fixtures/MCP-Mixer-Test.band"`: checks wrong-track rejection and audio moves, adds track 4 and leaves the audio at bars 5–7 there. It exports solo and full audio.
4. `node test/live-region-smoke.mjs "$PWD/fixtures/MCP-Mixer-Test.band"`: with that final four-track shape, moves the audio between tracks and restores its layout. This smoke case does not itself render.
5. `node test/live-saved.mjs "$PWD/fixtures/MCP-Mixer-Test.band"`: requires the exact final shape and mixer state from the earlier phases; checks persistence and exports again.

Separate view/timing scenario: `node test/live-view.mjs "$PWD/fixtures/MCP-Mixer-Test.band"` accepts any expendable saved project copy with at least one track and stopped transport. It toggles automation visibility twice in each direction, checks that region reads reject the automation view, compares all region and mixer state, saves/reopens, and exports `View-Roundtrip.wav`. To exercise fractional readback, include fractional audio boundaries. Compare the export with a baseline from the same source project; the script alone does not establish audio equivalence. Do not replace an existing fixture without preserving it first.

Results go under `runtime/live/<scenario>-<timestamp>/`. A failure can leave a partially edited fixture. Inspect the journal and project before retrying; recreate the disposable fixture when its preconditions no longer hold.

Verify exports with `python3 test/verify-audio.py <wav> ...` (FFmpeg required). A file whose stem is `Muted` is expected to be exactly silent; others must contain signal and sample peaks below full scale. `test/compare-audio.py <source> <bounce> <offset-seconds>` checks a moved dry fixture's waveform up to constant gain; disable nonlinear/time-varying processing for that specific test. Neither script measures true peak or musical quality.

## Future work

- Fractional-bar writes with explicit beat/tick conversion and rendered timing checks. Readback now preserves the literal Accessibility bar/beat/division/tick fields; missing units remain null, and no tick rate or time signature is inferred.
- [Attack-based region extraction](attack-region-design.md): source-to-project mapping, onset analysis, precise seek/split and verified copy/paste.
- Automation point enumeration/editing where reliable; geometry-independent timing and explicit rollback semantics.
- Audio Unit parameter discovery in physical units, with per-plugin metadata and capability detection.
- More GarageBand versions, display scales and project types; checked-in synthetic fixture generation.
- Structured, repeatable listening evaluations for the six genre profiles.
