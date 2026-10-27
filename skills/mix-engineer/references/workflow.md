# Session workflow

## 1. Brief and baseline

Capture the desired emotional impact, primary genre/subgenre, references with relevant sections, intended delivery, and exclusions. References describe goals such as vocal intimacy, drum attack or low-end density; they are not templates to clone blindly. Do not copy or redistribute reference recordings.

Inventory the authorized project. Create or reuse an independent working copy with its media dependencies, then verify it opens correctly. Record track indices and names together; indices may change after edits. Record existing automation, mute/solo, pan, levels and available controls. Refresh region identifiers after any arrangement edit.

Make a baseline WAV using explicit, consistent export settings. Note whether normalization and master processing are active. Save artifacts under a visible session directory: `projects/`, `inventory/`, `plans/`, `exports/`, `analysis/`, `journal/`. The MCP automation tool's own screenshots and point progress go in `automation/` under its configured data directory. Do not assume these folders or reports are generated automatically.

## 2. Decide and act

For each iteration write:

- **Observation:** the audible issue and the section where it occurs.
- **Hypothesis:** why this specific change could help.
- **Action:** one supported setting or a small coherent group; exact project and track identity; previous value.
- **Acceptance:** a listening comparison and, when useful, a measurable check.
- **Result:** actual readback, export path, accepted/rejected/uncertain, and rollback/restoration state.

Start with faders and pan. Identify which instrument carries the low end at each section, how the lead sits against guitars/keys and where percussion supplies groove. Revisit source or arrangement conflicts before adding processing. Editing performances, replacing drums or creating new parts requires appropriate user authorization.

Change EQ for an identified masking, resonance or tonal problem; compression for a defined envelope/dynamics goal; ambience for depth and space. Use short in-context comparisons, including bypass where exposed. Maintain headroom for later changes; avoid turning every mix decision into a loudness contest.

Never silently substitute a different operation when the desired capability is missing. For a compressor threshold in dB, confirm the actual plugin/parameter and exposed unit. If only a normalized macro is available, describe that limitation and either use the macro intentionally or leave a bounded manual step.

## 3. Vocal phrase automation

Render an authorized vocal solo and restore previous states afterward. Mark phrase candidates, sustained notes, breaths and intentional dynamics. Amplitude segmentation cannot determine words or phrasing reliably; inspect or listen before accepting its boundaries. Avoid automatic uniform loudness across every phrase.

Write a compact curve with transitions outside critical consonants where practical. Respect the adapter's supported range, point spacing, time convention and project type. Evaluate the vocal both solo and in the full mix; transient behavior can change even when phrase RMS looks correct.

Compare candidate, saved/reopened, new-curve-disabled and restored full-path renders when possible. Keep normalization, export length and master chain consistent. A nonlinear master breaks simple full-minus-solo subtraction. Do not infer unchanged accompaniment from that invalid comparison. Record any manual step needed for bypass/restore.

## 4. Evaluate and deliver

Technical checks: correct source/candidate identity, duration, channels, sample rate, finite samples, signal/silence as expected, clipping and appropriate loudness/true-peak measurements when tooling exists. Use waveform/timing checks for region moves and phrase-window gains for rides. Set tolerances before declaring a pass; explain quantization and stochastic effects.

Listening checks: matched loudness, vocal intelligibility, groove, low-end definition, harshness/fatigue, stereo/mono behavior and section contrast. Mark each as performed, user-reviewed or not performed. When the agent has no playback/listening capability, provide accessible audio and request the user's artistic judgment without claiming to have heard it.

Keep the final project copy, final WAV, decision journal and evaluation. Preserve alternates and excluded tracks unless removal was requested. Summarize changes by musical role rather than dumping raw commands. Keep runtime music and evidence private unless the user separately authorizes sharing.
