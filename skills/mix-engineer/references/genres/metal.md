# Metal: subgenre and articulation first

**Aim:** readable riffs, controlled density and a convincing physical impact. Distinguish classic/heavy, thrash/extreme, modern metalcore/progressive, and slower doom/sludge intentions. For mathcore or stop/start material, preserve asymmetric accents and rests; do not convert irregular phrasing into uniform loudness.

## Engineer evidence

Andy Sneap prioritizes vocals, low end and drum/guitar detail; he relates low-end weight to song speed. He describes dynamic control of low-mid guitar buildup on strong chugs, selective manual drum cleanup, and changing reverb by section. The cited frequency example is source-specific, not a value to paste onto every guitar. [Waves interview, 2017](https://www.waves.com/metal-mixing-tips-andy-sneap), source `sneap-2017`.

Mark Mynett emphasizes preparation and phase relationships among multiple recordings of a source in his engineer-authored extreme-metal guide. Its historical global filtering recommendations are not adopted here as defaults. [Mixing Metal, 2009](https://www.soundonsound.com/techniques/mixing-metal), source `mynett-2009`.

The HiMMP research commissioned eight engineers, including Jens Bogren, Nolly Getgood, Buster Odeholm and Andrew Scheps, to mix the same recording. Their different results support an aesthetic continuum rather than one correct metal sound. [Herbst and Smialek, 2025](https://storage.gmth.de/zgmth/pdf/1222), source `himmp-2025`. This study was read; its complete audio/video collection was not auditioned.

## Multitrack decisions — our proposed workflow

1. Map fastest passage, lowest tuning/register, clean section, breakdown, cymbal-heavy section and final peak. Record which parts are DI, amp, multi-mic, real doubles or sample reinforcement. Diagnose tuning and performance conflicts separately from tonal balance.
2. Compare close drum mics, overheads and rooms as an ensemble. Investigate cancellation between same-source channels; preserve room perspective unless a changed perspective is intentional. Do not automatically align every overhead transient or invert bass polarity to one kick hit: unrelated pitched parts do not have one permanently correct phase relationship.
3. Allocate low-end roles by section. Check kick length against the fastest kick pattern, bass sustain against riff gaps, and guitar low-mid weight against both. A slow heavy passage may tolerate more sustain than fast double-kick passages.
4. Establish a real double-track guitar balance. Add extra layers only if already intended and useful. Identify whether muddiness occurs on every note or only palm mutes. Compare a small static correction with selective dynamics only when an appropriate tool exists. Keep open chords from becoming thin to fix a few chugs.
5. Build bass from the available sources; preserve a stable foundation and enough harmonic definition to follow the line. If adding a separate distorted path, verify alignment, polarity and mono recombination. Do not assume that clean lows plus distorted highs is mandatory or that any crossover is phase-neutral.
6. Put vocals into the dense passage early enough to reserve space. Treat clean singing, pitched grit and unpitched screams differently. Control harshness against cymbals and guitar fizz in the full mix; a darker scream in solo may sit correctly.
7. Shape section impact: retain stops, cymbal tails and intentional feedback; automate a fill or transition only for a clear reason. Do not let the largest low note drive the entire mix bus into a different balance. Any limiter-heavy audition must also be checked with comparable loudness and known master settings.

| Symptom | First discriminating test | Reject the change when |
|---|---|---|
| Chugs boom, open chords sound good | Compare the same guitar across those gestures | Static removal hollows out every chord |
| Fast kick becomes a rumble | Compare sustain/overlap and bass contribution | Extra click turns it into detached tapping |
| Guitar seems quiet | Check missing midrange and bass masking before level | Louder guitar hides vocal and snare |
| Cymbals are harsh after drum compression | Compare direct/room/overhead contributions | Global darkening removes useful snare articulation |
| Breakdown is big only in stereo | Compare parallel paths and doubles in mono | Width depends on destructive centre cancellation |

**Vocal tuning:** tune stable melodic phrases only against verified harmony; keep bends, grit and transitions expressive. A detector's confident octave error is still wrong. Avoid automatic pitch correction of screams, stacked vocals or guitar-contaminated live vocal tracks. Industrial/robotic layers should have a clear role and independent dry intelligibility when needed.

**GarageBand execution:** sample-level alignment, multiband/dynamic EQ and arbitrary buses are not implied by a successful fader or Smart Control call. Verify capabilities and use explicit offline or manual processing where needed. Do not write whole-bar region moves as a substitute for fine drum alignment. See [adapter contract](../garageband.md).

**Acceptance:** note separation in the fastest and densest sections; sustained weight in slower ones; readable lead; coherent drum image; mono low-end continuity; no new clicks/tail truncation; tolerable cymbal/guitar fatigue over a full passage. Measure edits and listen to them as separate checks.
