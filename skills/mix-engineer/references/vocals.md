# Vocal tuning, character and vocoding

Use for sung-vocal intonation, vocal tone, doubles/harmonies, hard tuning and robot effects. Capability names in this guide describe operations, not a promise that the connected MCP exposes them. Read [the adapter](garageband.md), inspect its current tools and record the engine actually used. Research checked 2026-11-01; detailed provenance is in [vocal-sources.json](vocal-sources.json).

The new offline route is `gb_vocal_process`: pitch analysis, explicit reviewed interval shifts and a filter-bank vocoder. It does not automate GarageBand's native Pitch Correction inspector. Native correction below is a manual application workflow until a guarded, verified native tool exists. An interval shift is not automatic note correction, and native controls are not a fallback to invoke through unverified clicks.

## Choose the musical operation

| Desired result | Operation | What to preserve/check |
| --- | --- | --- |
| A few notes sound flat/sharp | Correct the intended note centers or reviewed phrases | Melody, approaches to notes, vibrato, vowel identity |
| Entire recording needs a fixed pitch offset | Transpose by an explicit semitone/cents offset | Timing and duration; this does not repair individual wrong notes |
| Voice should sound darker, brighter, smaller or larger | EQ and/or independent formant processing | Fundamental melody versus vowel color; these are different controls |
| Deliberate stepped, synthetic singing | Fast pitch correction toward a reviewed note set | Note choices and transitions; hard tuning is not a vocoder |
| Speech/singing should articulate a synthesizer or chord | Vocoder: voice modulator plus pitched/noisy carrier | Carrier harmony, consonants and alignment of the two signals |
| Aggressive edge or telephone texture | Saturation/distortion and filtering, often on a parallel layer | Intelligibility, sibilance, clipping and level-matched comparison |

Decide from the brief and reference first. “Tune the tone” can mean pitch or timbre; use the surrounding context. If the intended melody is genuinely ambiguous, prepare the unaffected parts and resolve that musical choice before changing it. Do not infer a new melody merely from a detector's nearest-note output.

Pitch-center, slow pitch drift and fast modulation/vibrato are separable aspects. Flattening all three is an effect, not a default repair. Celemony's documentation makes this distinction explicitly; it does not establish that GarageBand has those separate controls. [Pitch modulation and drift](https://helpcenter.celemony.com/M5/doc/melodyneStudio5/en/M5tour_ToolModulationDrift_2)

## Diagnose before correcting

1. Identify the intended lead, doubles, harmonies, ad-libs and pitched versus screamed/spoken phrases. Keep excluded tracks excluded. Work from the dry comp or a dry identified export with a known project origin; reverberant/full-mix audio is a poor substitute for an isolated vocal.
2. Listen against the harmonic accompaniment. Mark the words/phrases that actually distract, their intended notes, and protected scoops, falls, bends, vibrato and blue notes. Confirm the tuning reference if the accompaniment is consistently displaced from the expected concert pitch.
3. An F0 curve can locate candidates. Preserve its confidence/voicing mask and flag octave jumps; do not turn every frame into a note. pYIN supplies F0, a voiced flag and a voiced probability; unvoiced estimates normally remain undefined. Its centered-frame convention matters when mapping analysis to source samples. This is analysis evidence, not proof of the intended melody. [librosa pYIN](https://librosa.org/doc/0.11.0/generated/librosa.pyin.html)
4. Separate a local wrong note from a broad track-level drift. Resolve wrong-octave detections, breaths, consonants, rasp and overlapping singers before any automatic target selection. Choose phrase-level boundaries that leave connected slides intact.

The sequence below is a proposed working method, not an attributed engineer preset: comp/cleanup as authorized → modest level preparation if needed → pitch processing on clean input → corrective tone/dynamics → character effect → space → rides in context. Reorder only for an audible reason, and log the alternative compared. A compressor or de-esser can help a particular detector; it can also hide an input problem. Avoid committing a destructive preprocessing chain just to make a graph look cleaner.

## Native GarageBand route

Apple documents Pitch Correction in the Audio Editor's **Track** inspector. It changes **all regions on the selected audio track**. Its supported material is monophonic; chromatic nearest-note correction is the default, and Limit to Key constrains it to the project key. This is not a selected-note editor. [Apple: correct pitch](https://support.apple.com/en-euro/guide/garageband/gbnde08420a0/mac)

Operational consequences for this workflow:

- Read the actual track identity, inspector mode, correction amount, Limit to Key and project key before writing. A selected region does not make a track-wide control local.
- Start with the smallest useful change and compare representative held notes, quick ornaments, phrase attacks and ends. The GUI amount is an application control; do not relabel it as cents or retune milliseconds.
- Use key limitation only after reviewing the melody against the harmony. Chromatic approaches, borrowed chords, modulations and intentional blue notes can be damaged by a single major/minor note set.
- Do not change the global project key as an unnoticed prerequisite. Audit other regions, loops, MIDI and Follow Tempo and Pitch behavior first. If this is unnecessary for the requested result, use chromatic correction or an independent processor with its own note set.
- If two phrases need different treatment, use an authorized separated working track or offline reviewed phrase processing. Do not promise that native per-note, per-region correction strength or its automation exists.
- Treat region Transpose as a separate operation. Verify its available range and Follow Tempo and Pitch prerequisites in the live application. Do not enable a timing-following option solely to unlock a control without checking the resulting timing.

MIDI pitch bend controls an instrument's MIDI performance; it is not an audio-vocal tuner.

## Natural correction and deliberate hard tuning

For natural correction, first fix a distracting center while retaining the contour. Leave an intentional approach to a note and its release alone when possible. Correct neighboring notes together when a transition connects them. A shift applied to an entire phrase retains its internal contour but cannot independently repair multiple different errors inside that phrase. Use note-specific processing when the phrase requires it.

For hard tuning, select the intended allowed notes first, then shorten transitions if that is the requested aesthetic. Check rap-like passages separately: an unstable pitch tracker can create unintended melodic jumps. Keep a dry version and label the synthetic version by its actual effect. Do not call it a vocoder unless a carrier is being modulated.

A no-purchase plugin candidate is **Graillon 3 Free**: the vendor offers AU, pitch correction, pitch shifting and formant processing. PTM, keyboard tuning and the doubler are Full-only features. Installation and host compatibility are separate from the plugin's advertised capabilities; discover what is installed before proposing a dependency. [Graillon product](https://www.auburnsounds.com/products/Graillon.html)

When that plugin is available, inspect its actual version. The 3.2 manual calls the newer engine **I2**, while the product page still says I1. Smooth governs transition speed; Snap Min allows a tolerance around notes; Snap Max limits capture distance; Inertia can change the melody by making notes stick. These deserve independent A/B choices, not a universal “professional” preset. The formant preservation and formant-shift controls serve different purposes. [Graillon 3.2 manual](https://www.auburnsounds.com/downloads/Graillon%203%20User%27s%20Guide.pdf)

## True vocoder route

The carrier provides harmonic material; the modulator supplies the changing speech-like envelope. Decide whether the carrier follows the vocal melody, plays an independent harmony, sustains a drone or uses noise. Prepare the carrier as a musical part with explicit notes and timing. A vocoder can work on speech that has no stable singing pitch.

**TAL-Vocoder** is a candidate AU with an internal synthesizer and external routing. Its v3 changelog explicitly removes the old left/right carrier/modulator input mode in favor of sidechain routing. Do not apply a tutorial for v2 to v3. [TAL product and changes](https://tal-software.com/products/tal-vocoder)

The manual requires both carrier and modulator signals; the internal carrier is triggered by MIDI. It describes release, consonant enhancement and separate input meters. Although it names GarageBand among tested hosts, the shown routing examples are for other DAWs. That is not evidence that the current GarageBand/MCP can establish the required MIDI/sidechain route. Verify both meters, then render a short phrase before building a full effect track. [TAL manual](https://tal-software.com/downloads/docs/TAL-Vocoder-UserManual.pdf)

If the route is unavailable, render the vocoder offline and import the result as a new aligned effect track. Audacity supplies a documented no-purchase example: voice in the left channel, carrier in the right channel of an unsplit stereo track, with a selectable vocoder output. Those channel assignments are specific to that effect. [Audacity vocoder](https://manual.audacityteam.org/man/vocoder.html)

For intelligibility, compare voiced vowels and unvoiced consonants separately. Start with a harmonically rich carrier; test a controlled consonant/noise contribution or a little dry voice if words disappear. Keep the dry and effect layers aligned and judge their combined tone in mono. Choose a release that connects vowels without smearing rhythmic gaps. These are experiments to hear, not guaranteed settings.

## Offline processing contract

Use the repository's identified-asset/render approach when the operation exists: source SHA-256, native sample rate/channels, frame count, project-origin sample, explicit reviewed interval, engine/version/options, new output path and receipt. Keep sources and `.band` internals intact. Return separate dry, processed and, when useful, matched comparison excerpts.

Rubber Band can shift pitch independently of duration; it is a renderer, not a note detector or automatic melody corrector. Its R3 engine is intended to improve quality for material including vocals at higher CPU cost. Invoke an installed tool rather than assuming availability or redistributing binaries. [Rubber Band project](https://github.com/breakfastquay/rubberband/blob/default/README.md)

FFmpeg's optional `rubberband` filter accepts a **frequency ratio** and supports formant preservation. The standalone Rubber Band CLI's `--pitch` uses **semitones**. For a cents offset, the ratio is `2 ** (cents / 1200)`. Probe the installed build and options; do not pass cents into a ratio parameter. A pitch-preserving duration check remains necessary even when the requested tempo ratio is one. [FFmpeg filter](https://ffmpeg.org/ffmpeg-filters.html#rubberband), [Rubber Band CLI implementation](https://github.com/breakfastquay/rubberband/blob/default/main/main.cpp)

For local correction, render with sufficient surrounding context, keep the accepted interval aligned to original samples, and use reviewed joins outside sensitive attacks or continuous glides. Reject unexplained truncation or latency. Do not conceal a short active render by appending silence. Preserve breaths and consonants unless altering them is specifically part of the effect. A custom spectral vocoder or pitch tracker must be labelled by its implemented algorithm and tested scope; it is not equivalent to a commercial note editor merely because it produces audio.

## Level 34 vocal decisions

These are starting hypotheses for our profiles. The reference and singer override the genre label.

| Profile | Tuning priority | Character/space experiment | Reject when |
| --- | --- | --- | --- |
| Clean / acoustic | Audible center errors only; protect small vibrato and intimate transitions | Minimal character processing; maintain breaths that carry phrasing | The voice loses identity, becomes metallic or the room pumps |
| Punk | Preserve urgency, slides and roughness; fix notes that fight the song | Parallel grit or filtered delay for energy; automation before constant extra compression | Shouts become warbling notes, consonants get buried, every syllable sounds identical |
| Funk | Preserve rhythmic diction, bends and blue notes | Short space, selective doubles, optional vocoder call-and-response | A major/minor mask erases blues inflections or effect tails obscure syncopation |
| Metal | Treat clean, harsh and layered parts separately; tune clean hooks deliberately | Clean center plus distinct harsh/character layers; control abrasive buildup in context | Screams are forced onto unreliable F0 targets or stacked vocals become phasey |
| Pop | Review every exposed note and transition; tighten doubles against lead intent | Deliberate contrast between intimate verse, wider chorus, throws and optional hard-tune | Perfect-looking curves produce lisping, note hopping or smaller emotional delivery |
| Rock | Keep expressive vibrato, grit and sustained-note movement | Fit vocal midrange against guitars; try saturation and timed space after pitch decisions | Presence becomes harshness or correction flattens the singer's phrasing |
| Latin | Specify substyle: acoustic/salsa phrasing differs from urban/pop hard tuning | Preserve runs and syllable groove; use space/effects to support percussion, not mask it | Fast ornaments snap to wrong notes or rhythmic tails smear the groove |
| Robot / vocoder | Tune only if needed for the requested source; carrier owns its harmony | Compare melody, chord and drone carriers; shape consonant audibility | Either input is missing, harmony is accidental or the result is only distorted dry voice |

## Acceptance

Technical checks: correct asset/track, unchanged source hash, supported mono or explicit channel policy, duration and project alignment, finite samples, no new clipped samples, reviewed joins, no unexplained latency, restored temporary solo/mute and export settings. For native changes, read back the setting, save/reopen the copy and compare its new export. For vocal doubling, check stereo and mono; sample-identical copies are not independent performances.

Listening checks: target melody against accompaniment; vibrato, scoops, word onsets and releases; breaths/sibilants; formant identity; artifacts in solo and full mix; chorus/verse contrast; level-matched bypass. Pitch statistics and successful export establish technical behavior only. If listening was not performed, say so and leave artistic acceptance open.

## Implemented analysis backend

The current `gb_vocal_process` pitch detector uses normalized autocorrelation, not pYIN. Its confidence measures periodicity and is not a probability of the intended note. The executable requests and limits are in [vocal processing](vocal-processing.md). Native GarageBand pitch correction remains manual; an offline interval shift does not correct drift within a note.
