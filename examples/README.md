# MIDI examples

The small JSON compositions come from the upstream project. They demonstrate MIDI playback and layering, not production-ready mix presets. The original rendered previews are available in the [upstream gallery](https://github.com/visualfart/garageband-mcp/tree/main/examples).

Build the server, open a saved disposable GarageBand project, and select a software instrument track:

```sh
node examples/play.mjs examples/lofi-chords.json --project /absolute/path/Demo.band
node examples/play.mjs examples/edm-anthem.json --project /absolute/path/Demo.band --layer bass
node examples/play.mjs examples/drum-groove.json --project /absolute/path/Demo.band --record
```

The JSON file is the first argument. Use `--record --layer <name>` for one layer at a time and create/select the intended instrument track between recordings. Layered live playback does not create an independently mixed multitrack arrangement.

For recorded guitars, drums, bass and vocals, follow the [mix workflow](../docs/mixing-workflow.md) and [mix-engineer skill](../skills/mix-engineer/SKILL.md).
