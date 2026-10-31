# GarageBand adapter: capability and verification contract

Discover tools from the connected server, not a remembered tool count. Another installation may not include the additions. Use `gb_check_permissions` and `gb_list_projects` to inspect readiness. All project-bound tools require the absolute saved `.band` path in `projectPath`. `gb_open_project` takes `path`.

Use `gb_set_automation_view` with `visible: false` before region reads/moves; repeated calls are idempotent and do not bypass or edit curves. `gb_list_regions` exposes literal `startPosition`/`endPosition` bar/beat/division/tick fields. Missing units are null, not zero. Fractional readback does not enable fractional moves: the whole-bar movement preconditions still apply.

## Reliable primitives within tested scope

- `gb_list_tracks`, `gb_select_track`, `gb_set_track_mute`, `gb_set_track_solo`: inspect current state and set explicit state. Preserve the session's exclusions.
- `gb_set_track_volume_db`: requests dB and verifies GarageBand readback within its supported tolerance. `gb_set_track_volume` and `gb_set_master_volume` instead use a percentage of fader travel; it is not dB.
- `gb_set_track_pan`: -100 to 100, with quantized readback.
- `gb_list_smart_controls`: discover the selected track's actual knobs/switches. Set with `gb_set_smart_control` (0–1 normalized) or `gb_set_smart_switch`. Use an explicit track index. Refresh after switching tracks; reject ambiguous names.
- `gb_list_regions`, `gb_move_region`: whole-bar ordinary audio/MIDI only, stopped transport, visible source/destination, compatible tracks, no overlaps. Refresh IDs after edits. Fractional regions, Drummer and loops are unsupported; hide automation before region discovery/moves.
- `gb_export_song`: use explicit filename, format and directory; preserve/restore normalization. Confirm completion and inspect the actual audio file.
- `gb_export_batch`: WAV variants with per-job solo/mute overrides and restoration journals. Range trimming requires a verified `exportOriginSeconds`; never assume a whole-song bounce begins at project zero. State restoration is verified even after setup/action failure. A partial failure retains completed outputs for inspection.
- `gb_import_audio`: SHA-256-identified WAV into an existing named empty audio track at bar 1. Checks the region, neighboring tracks and identical WAV format/audio data in the project media copy; GarageBand may add metadata chunks. It does not save the project or prove persistence; save/reopen and compare a control export when authorized. Do not repeat a partial failed import blindly.
- `gb_screenshot`: captures a window identified by GarageBand's process and window ID; overlapping applications are excluded. Ambiguous identity is an error.

Exports require FFmpeg and ffprobe on the server's PATH. Successful completion includes a finished export UI, finalized WAV chunks when applicable, valid audio metadata and full decoding. Evidence, recovery journals and scratch captures use `GARAGEBAND_MCP_DATA_DIR` (default `~/Music/GarageBand MCP`); choose the current task's visible evidence directory. Screenshots and exports never overwrite an existing destination.

A switch labelled “Bypass Compressor” had checked=true when compression was active in one tested patch. Labels alone cannot establish signal processing state across patches. Verify the behavior before describing a switch as bypassed/active.

## Experimental volume automation

`gb_add_volume_automation` requires `trackIndex`, exact `expectedTrackName`, `confirmEmptyVolumeLaneOnCopy: true`, and `points: [{beat, db}, ...]`, plus `projectPath`. The confirmation is valid only for a verified fresh disposable copy and an empty target lane; do not assert it merely to satisfy the schema.

Current constraints:

- Stopped 4/4 project, English interface, unlocked desktop and Screen Recording access.
- 2–64 strictly increasing points starting at beat 0; beat means zero-based quarter notes, not a one-based bar number.
- Levels from -20 to 0 dB, within 3 dB of the initial point.
- All points visible with at least six screen pixels separation. Placement is quantized to pixels, not samples/ticks.
- Empty Volume lane; the tool does not erase existing automation. An empty screenshot cannot exclude hidden/offscreen points.

The response `drawn_requires_render_verification` is provisional. Keep its evidence directory, requested/placed beats, readback and placement bound. Export, save/reopen and export again. Use controlled bypass/restore if available; the MCP currently has no general automation bypass command. Do not invent it.

## Failure behavior

The FIFO and cross-process lock serialize cooperating GUI operations. A human or another automation program can still interfere. Target checks reduce wrong-project risk but are not a GarageBand transaction. After mismatch, timeout, partial write or focus loss, inspect the project before continuing. Do not reset the global lock file or run a second server to bypass ownership. A crash can leave native work alive even though the lock is released.

The server cannot promise arbitrary Audio Unit parameters in physical units, sample-accurate GUI placement, rollback of a partial edit, or unattended operation across every version. Record unavailable steps in the plan; request a bounded manual action only if needed to complete the authorized goal.

## Offline mix and vocal processing

- `gb_mix_audio`: input LUFS/true peak, per-channel peak/RMS/crest/DC and stereo/mono diagnostics; ordered EQ, HP/LP filters, compressor, saturation and de-esser; aligned loudness-matched A/B previews. Consult [schema and units](mix-processing.md). De-esser parameters are normalized; EQ and compressor fields have explicit units.
- `gb_vocal_process`: reviewed mono vocal pitch analysis, explicit interval shifts and filter-bank vocoder renders. Consult [vocal workflow](vocals.md) and [request schema](vocal-processing.md). No promise of transparent auto-tuning, natural formants or automatic melody decisions.
- These commands run without opening GarageBand and require the configured Python environment with NumPy plus FFmpeg. They do not require `projectPath`, do not insert plug-ins and do not change `.band` media. Keep source hashes, sample origin, full duration and an unchanged dry copy. Import the accepted candidate through `gb_import_audio` only after preparing a separate empty audio track in the working copy.
- Native Pitch Correction amount/key limiting, note-blob editing, formant AU automation, sidechain synth-vocoder routing and general plug-in chains are not controlled by this adapter. Test an installed AU's actual input/routing before offering it as a workflow; an AU appearing in the browser does not prove external carrier or MIDI routing.
