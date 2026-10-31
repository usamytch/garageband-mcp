# Join review, mix recipes and durable export

These tools preserve input audio and refuse output directories inside `.band` or `.logicx` packages. Offline tools never open GarageBand. Musical balances belong in versioned recipe data, not hard-coded genre presets. Files, source hashes and private recipes stay outside Git.

## Dependencies

Build the server with `npm run build`. Install `scripts/audio_edit/requirements.txt` in a Python environment and make FFmpeg/ffprobe available on `PATH`. Set `GARAGEBAND_MCP_PYTHON` to that environment's absolute Python executable. The source installation must retain `scripts/audio_edit` beside `dist`. Run `npm run check:all` with the same Python environment on `PATH`.

## Per-join review

Call `gb_check_audio_joins` with absolute `requestPath` and a new `outputDirectory`. Request version 1:

```json
{
  "version": 1,
  "trackLabel": "Acoustic right",
  "projectOriginSeconds": 0,
  "candidate": { "path": "aligned.wav", "sha256": "<64 lowercase hex characters>" },
  "reference": { "path": "original.wav", "sha256": "<64 lowercase hex characters>" },
  "joins": [{ "sample": 344000, "label": "crossfade start" }],
  "protected": [{ "start": 396045, "end": 453375, "referenceStart": 396900, "label": "slide" }]
}
```

Asset paths resolve relative to the request. Coordinates are integer samples in the decoded native-rate files; interval ends are exclusive. Each protected interval explicitly maps the candidate to its source, so a translated slide can remain sample-identical. Include the start, center and end of each crossfade in `joins`. A reference used for seam-derivative/dropout comparison must already share the candidate's full timeline; a differently sized source pool is used only for explicit protected mappings. A same-length but differently aligned reference is not suitable.

The report records source hashes, project coordinates, labels, channels, thresholds and limited scope. Checks cover abrupt sample jumps, full-scale samples, near-zero runs of at least 1 ms in active context and changed protected phrases. Context extends 25 ms on both sides; file-edge joins are retained. Channels are measured separately, including antiphase stereo. A source-identical pick transient is not labeled a newly introduced jump. This is a heuristic: nonzero energy dips, subtle timbral changes and artifacts away from listed joins can escape detection.

Up to 512 joins/phrases are accepted. The first 32 joins get ±120 ms WAV previews; `previewsTruncated` reports that cap. Preview attenuation, if needed, is disclosed and does not affect measurements. Inputs are limited to mono/stereo at 44.1/48/88.2/96 kHz, at most 600 seconds and 30 million decoded samples per asset. `no_findings` means no findings from these checks, never listening approval. Outputs are written to a new directory only.

## Stereo recipes (including Intro 10/11)

Call `gb_mix_recipe` with an absolute `recipePath`. Omit `outputDirectory` for validation; provide a new directory to render 24-bit WAVs and `receipt.json`. The receipt contains the recipe/source hashes, status, output hashes and project origin. A failed or interrupted receipt must not be treated as a delivery.

Version 1 fields:

| Object | Required data |
| --- | --- |
| Recipe | `version: 1`, `sampleRate`, `assets`, `outputs` |
| Asset | Unique `id`, `path`, `sha256`, `frames`, `channels`, `projectOriginSample` |
| Output | Unique `id`, plain `.wav` `filename`, `projectStartSample`, `frames`, `terms`; optional `gainDb`, `fadeOutSamples` |
| Term | `asset`, `sourceStart`, `destinationStart`, `frames`, 2×input-channel `matrix`; optional `gainDb` |

The timeline equation is `asset.projectOriginSample + sourceStart == output.projectStartSample + destinationStart`. No resampling, time stretching or automatic timing shifts occur. Terms must fit both the source and output. Uncovered output samples are explicitly silent by recipe construction. Gains are in dB; channel matrix coefficients lie in [-1, 1]. Summation uses floating point followed by one output quantization. Clipping is rejected. An optional cosine-squared fade ends at zero.

For Intro 10, route identified corrected 40 to left (`[[1],[0]]`) and corrected 41 to right (`[[0],[1]]`) with the approved pair balance and acoustic gain. For Intro 11, add the identified existing clean/overdrive stereo bed (`[[1,0],[0,1]]`), retain its frame range, and apply the approved acoustic-in-mix and overall gains. Session-specific hashes and gains belong in the private recipe. This reproduces an exported balance; it does not recreate live GarageBand plug-ins or region edits.

Limits: 1–16 assets/outputs, 1–32 terms per output, 40 million input samples total, 30 million output frames. Output names are unique across case and Unicode normalization. Existing destinations are never reused or overwritten. Hashes are checked before and after rendering.

## Durable GarageBand exports

`gb_export_start` accepts the same explicit saved `projectPath`, an output `directory`, an `idempotencyKey` and 1–16 `jobs`. Filenames omit `.wav`; output is WAV. Each job can specify track `index` plus exact `name`, optional explicit `solo`/`mute`, optional `normalize`, and a `range` with `startSeconds`, `endSeconds`, `exportOriginSeconds`, optional `fadeOutSeconds`. Enabling Solo or Mute clears its coupled control; both original states are snapshotted and restored. Requesting both enabled is rejected. Other unlisted mixer fields remain as they are. Supply every relevant track state when isolation is required; this is not an automatic solo-exclusive command. Range coordinates use the recorded export origin, not the current playhead.

The call returns a job ID promptly. A detached worker owns the shared GUI lock. It brings GarageBand forward before reading or changing settings and refuses preparation while an export dialog/render is active. Disconnecting or killing the MCP client does not cancel it. Repeating the same key and request returns the same job; a different request with that key is rejected. Journals live under `GARAGEBAND_MCP_DATA_DIR/exports/jobs` (or the default user data directory). Keep this directory and server installation available while jobs run.

Use `gb_export_status` to read progress without touching GarageBand. It reports `workerAlive`, `recoveryRequired`, settings restoration and each completed file. `completed` requires validated audio and verified restoration. States include `queued`, `running`, `interrupted`, `needs_review`, `completed`, `abandoned`. `workerAlive` means the recorded process group still exists; a surviving native child counts too. A start/launch failure can also appear as `workerError`; inspect it rather than inferring success from the job ID.

New journals use version 2 to retain coupled Solo/Mute snapshots. Existing version 1 journals remain readable without migration. If a legacy journal lacks the original coupled state or its verified restoration, status reports `mixerRestored: false` with a warning even for an old completed job; inspect the actual track state. Recovery restores recorded values but does not guess missing snapshots.

Use `gb_export_resume(jobId, action="continue")` after an interrupted worker has exited. Open the same saved project manually first if necessary. Recovery checks track identities, the saved mixer snapshot and full WAV decoding/hashes. Completed outputs are retained. A valid late render is recovered without a second submission. A worker/process group still alive prevents another launch. If submission was ambiguous and no valid WAV exists, recovery stops; it never guesses that repeating Export is safe.

`action="restore"` restores recorded settings and abandons remaining work, retaining all files and diagnostics. After that, a new key and new output names can start a new export. Partial/unrecognized files and collisions require inspection; the server does not delete them automatically. Successful publication uses a checked private staging file and an exclusive hard link, including recovery from a crash immediately after that link. Existing colleague files are never replaced.

A recovery fence blocks cooperating GUI edits while settings may be unrestored; read-only UI diagnostics remain available. Do not delete the fence to bypass recovery. If the journal itself is damaged, recovery refuses GUI writes; inspect the retained snapshot and resolve manually. Initialization failure before the journal exists also requires inspection or a new key. The worker never saves a project, creates tracks or creates a DAW project. Mixer changes are temporary, but GarageBand itself may autosave; use an authorized working project.

These guarantees cover cooperating processes and process crashes, not arbitrary manual edits, malicious filesystem races or disk/power failure. No general GarageBand transaction or automatic Undo is claimed. The older `gb_export_batch` remains synchronous; use the new start/status/resume tools for persistence across disconnects. Detached-process tests use a synthetic renderer; [live evidence](testing.md#live-evidence) records the bounded native GarageBand checks. Other setups still require their own disposable-project check.
