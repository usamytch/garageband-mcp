---
name: mix-engineer
description: Mix recorded multitrack music in GarageBand with engineer-informed punk, funk, metal, pop, rock and Latin workflows. Use for balance, dynamics, tone, vocal pitch review and tuning, vocoder effects, phrase rides and measured A/B comparison. Does not cover composition, transcription or universal mastering presets.
---

# Mix Engineer

Turn the user's musical brief into small, reviewable edits on a project copy, then evaluate rendered audio. Use the user's language. Genre is context, not permission to overwrite the artist's choices.

## Load only the relevant material

1. Read [workflow](references/workflow.md).
2. For GarageBand, read [adapter capabilities](references/garageband.md) and discover the connected server's actual tools.
3. Read the requested profile: [punk](references/genres/punk.md), [funk](references/genres/funk.md), [metal](references/genres/metal.md), [pop](references/genres/pop.md), [rock](references/genres/rock.md), or [Latin](references/genres/latin.md). For a blend, select a primary profile and one secondary influence; avoid contradictory chains.
4. Consult [source provenance](references/sources.json) when attributing techniques. Distinguish source observations from this skill's proposed experiments. Never imply endorsement, access to a paid lesson, or knowledge of an engineer's exact settings without evidence.
5. For an engineer's approach or a full multitrack, read [engineer methods](references/engineer-methods.md). For pitch, timbre, robotic vocals or vocoders, read [vocals](references/vocals.md) and its [primary sources](references/vocal-sources.json).

## Start with the session

Resolve the authorized project and working copy from context. Inspect tracks, roles, regions, existing processing, mute/solo states and media availability. Preserve every explicit exclusion, including labels the user identifies as excluded. A muted track is not permission to delete it. Do not enable all tracks as a shortcut to restore a temporary solo.

Reuse provided genre, references and preferences. Ask only for missing choices that materially affect the result, such as which of two lead vocals is intended. When the brief is sufficient, proceed; do not add another approval step to work already authorized. If editing is not authorized, provide a plan only.

Save a session plan using [the example structure](assets/mix-plan.example.json), replacing example identities with verified ones. Declare which control capabilities exist. The plan is a journal, not a directly executable batch of tool calls.

## Work in bounded iterations

Establish a baseline export and static balance. Address the most audible problem first; make a small change with a stated hypothesis, read back the actual setting and compare a render. Check important decisions in context, at matched loudness and in mono. Solo is diagnostic, not the final judge of a part's role.

Apply compression, EQ, saturation, widening or automation only when the source and goal justify them and the adapter supports the intended operation. Never invent plugin units from a normalized knob. Do not impose a fixed LUFS target, EQ frequency, ratio, pan position or genre preset on every song.

Use `gb_mix_audio` when identified exported stems need explicit EQ/dynamics/saturation or when exports need loudness/true-peak and mono checks. Keep the offline chain and project origin in the plan; it is separate processing, not a GarageBand plug-in edit. `gb_mix_recipe` can sum aligned rendered branches. Consult [the request schema](references/mix-processing.md) before creating JSON. First validate, then render into a new directory, compare at matched loudness and import only the chosen candidate on a separate named track in the copy. Do not apply the old live processing twice to a wet exported stem.

Use `gb_vocal_process` for pitch evidence, reviewed interval shifts and synthesized-carrier vocoder renders; read [the vocal request schema](references/vocal-processing.md). A pitch estimate is not a target melody; a constant shift does not flatten a drifting note. The native GarageBand Pitch Correction control is track-wide and currently requires manual operation. Do not substitute MIDI pitch bend or a whole-region transpose for note correction. State the actual backend and formant limits.

For vocal rides, identify phrases and a modest gain proposal before editing. Automatic level detection is a candidate phrase map, not lyric understanding. Follow the adapter's limits, work on a fresh copy and verify persistence through export after save/reopen. A screenshot of a curve alone is insufficient.

On a partial GUI failure, retain evidence, stop dependent edits and inspect the actual state before retrying. Do not let an unknown action compound into a whole mix.

## Finish with evidence and an honest evaluation

Use [the evaluation example](assets/evaluation.example.json) to record technical checks, listening status, accepted changes and remaining issues. Restore temporary export/solo states. Keep the original project and source recordings intact.

Deliver the accepted project copy and WAV, plus a short account of what changed, what stayed excluded, which artifacts were saved, and what still needs a listening decision. Report unperformed listening as unperformed; numerical checks do not prove artistic quality. This skill does not authorize uploading music, publishing repositories or sending messages.
