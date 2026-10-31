# Engineer methods: evidence into musical decisions

Use this reference when designing a full multitrack mix, comparing approaches or explaining an engineer influence. The six genre profiles contain the working decisions. These names are a deliberately selected set of influential practitioners with accessible material, not an objective ranking of the world's best engineers.

Research updated 2026-11-01. Interviews establish how an engineer described particular work. They do not establish that this MCP can execute the same routing, that the listener will prefer it, or that a reconstructed mix matches the original.

## What the research changes

| Engineer / primary evidence | Documented emphasis | Decision to explore in our sessions |
|---|---|---|
| [Tom Lord-Alge](https://www.waves.com/inside-the-mix-tom-lord-alge), `tla-2017` | Impactful drums and distinguishable guitar parts | Find the guitar/drum hierarchy before adding more brightness |
| [Mick Guzauski](https://www.uaudio.com/blogs/ua/artist-interview-mick-guzauski), `guzauski-ua-2013` | Organic blend and source tone on *Random Access Memories* | Preserve useful groove and timbre instead of processing by habit |
| [Andy Sneap](https://www.waves.com/metal-mixing-tips-andy-sneap), `sneap-2017` | Low-end detail, audible vocals and section-dependent choices | Distinguish persistent mud from a chug-only buildup |
| [Andy Wallace](https://www.soundonsound.com/techniques/inside-track-linkin-parks-hunting-party), `wallace-2014` | Rapid overall balance, followed by detailed rides | Solve large relationships before chasing individual bass notes |
| [Serban Ghenea](https://www.waves.com/waves-grammys-2021-serban-ghenea-taylor-swift), `ghenea-2021` | Song-specific emotional focus rather than a fixed recipe | Name the listener's focal point for each section |
| [Tony Maserati](https://en.audiofanzine.com/sound-technique/editorial/articles/mixing-in-the-fast-lane.html), `maserati-2018` | Vocal tone, parallel density and changing spatial perspective | Separate a level problem from a front/back problem |
| [Josh Gudwin](https://www.mixonline.com/recording/josh-gudwin-on-mixing-part-1-juanes-bad-bunny-and-dua-lipa), `gudwin-2021` | Retaining production intent and controllable effects | Keep a valuable printed sound; request dry/wet separation only when it helps |
| [Manny Marroquin](https://www.waves.com/waves-grammys-2021-manny-marroquin-post-malone), `marroquin-2021` | Lyrical direction and selective distortion for section emphasis | Compare added harmonic presence with a simple level increase |
| [Jaycen Joshua](https://www.soundonsound.com/techniques/secrets-mix-engineers-jaycen-joshua), `joshua-2010` | Starting with the dominant musical element and shaping transitions | Choose an anchor from the song rather than always starting with kick |

Mark Mynett's engineer-authored metal guide contributes preparation/phase diagnostics. The [HiMMP study](https://storage.gmth.de/zgmth/pdf/1222), `himmp-2025`, provides an unusually useful controlled comparison: different professional mixes of the same performance. It reinforces the need for level-matched comparisons and a chosen aesthetic. Its research cohort is not representative of all metal production, and its audio/video corpus was not completely auditioned here.

## A mix architecture before a plugin chain

For each representative section, make a small role map:

| Role | What to determine | Common false solution |
|---|---|---|
| Focus | Which voice, riff or hook should draw attention now? | Make every part equally clear and equally loud |
| Pulse | Which attacks establish motion and which answer them? | Quantize or flatten every intentional accent |
| Foundation | Which source supplies weight, pitch and sustain? | Boost kick, bass and guitars in the same region |
| Width | Which independent performances or textures can live outside the centre? | Duplicate one track and call it a real double |
| Depth | Which parts feel close, supporting or distant? | Add a different long reverb to everything |
| Contrast | What changes across the next transition? | Raise only the master or limiter input |

The map is our implementation framework, not an engineer's secret formula. Resolve ambiguous alternatives from the user's brief and session; do not ask for information already established.

## Diagnose the job before choosing the tool

- **Level vs timbre:** temporarily change level before deciding a part needs more treble or compression. A presence deficit, a masking conflict and a quiet phrase can sound similar at first.
- **Static vs event-specific:** compare the offending event with a good event on the same track. A permanent EQ cut can damage the good event; an event-level adjustment or dynamic processor may be more appropriate.
- **Source combination vs EQ:** check multiple microphones/DI/parallel paths as combinations. Keep same-source alignment distinct from performance timing. A polarity inversion is not a universal phase-alignment operation.
- **Compression vs rides:** compression changes an envelope and potentially colour; a ride changes level over musical time. Decide whether the problem is transient shape, sustained density or a phrase that needs attention.
- **Parallel vs serial:** a parallel path is useful only if recombination is controlled. Confirm latency, filtering and polarity; judge it at matched loudness. Duplicate tracks alone do not prove a transparent parallel bus.
- **Mix vs production:** comping, retiming, replacing samples, changing harmony and inventing carrier chords alter the production. Use them when the brief calls for them; do not smuggle them in as routine EQ work.
- **Pitch vs tone:** tuning corrects or designs note behaviour. EQ/saturation/formant changes alter timbre. Vocoding combines a modulator with a carrier. Each needs its own musical target and validation.

## Transfer to GarageBand without claiming false equivalence

Translate the *purpose* of a source technique, then verify the available operation in [the adapter contract](garageband.md).

| Research technique | What must actually exist | Legitimate simpler option |
|---|---|---|
| Console fader ride | Verified automation with known time and level semantics | A static balance or separately rendered gain envelope, explicitly labelled |
| Dynamic low-mid control | An exposed dynamic EQ/multiband processor with known parameters | A small static tonal compromise, only if it solves the problem acceptably |
| Vocal parallel compression | A controllable return or separately aligned render | Serial compression or rides; these are different effects |
| Phrase delay throw | Correct routing and automation, or an explicit offline effect render | A simpler fixed delay if musically acceptable |
| Note-by-note tuning | Intended-note map and a capable editor/rendering backend | Native global pitch correction only when its limits fit the material |
| Vocoder harmony | Carrier, modulator, routing and known timing | A rendered vocoder layer; distortion or Auto-Tune is not equivalent |

Do not call an unavailable tool or buy/install a plugin merely because an interview mentions it. The research is not a shopping list. Discover installed capabilities and preserve the original media.

## Evaluation with a named reason to keep the change

Use excerpts with musical context: the whole phrase plus its entry and exit, and the transition into the relevant section. Compare equal time ranges; level-match the audition without silently normalizing final files. A sparse verse and a dense chorus should retain their intended relationship.

Keep a candidate only when the intended benefit survives in the full mix and its costs are acceptable. Listen for pitch artifacts, consonant damage, masked backbeat, shortened tails, low-end blur, mono cancellation and fatigue. A change can pass clipping, duration and loudness checks while failing all the musical ones.

If audio perception is unavailable, describe the work as technically verified and pending listening. Do not substitute a spectrum, correlation coefficient or engineer attribution for hearing. The aspiration to mix at a high professional level requires repeated listening and artist feedback; these documents alone do not certify it.

## Coverage and source use

The strongest source coverage is band rock/pop-punk, disco-funk, modern/heavy metal, pop vocal production and Latin urban pop. Acoustic Latin traditions and more specialised subgenres require additional specific references. Cross-style work should choose one primary rhythmic/production identity and borrow a small number of compatible traits.

[sources.json](sources.json) records speaker, access, bounded claims and limits. Public text, search-indexed passages, author research and course descriptions are distinguished. No paid lesson, unavailable video or exact proprietary preset is claimed as studied. The profiles' diagnostic tables and workflows are our conditional synthesis, to be tested on the actual multitrack.
