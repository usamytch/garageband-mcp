# Working on this fork

- Keep existing indentation, wrapping and braces. Do not run a whole-file formatter on existing code. Inspect the ordinary diff before committing.
- Build with `npm ci`, then `npm run check`. Regenerate the tool catalog with `node scripts/smoke.mjs --write-catalog` after changing registrations. Unit/stdio checks do not prove GarageBand behavior.
- Preserve `installGuiGuard` registration for every new tool. Classify unbound tools explicitly; project-bound GUI operations must hold the shared lock for the whole handler and verify the target after waiting and before native actions.
- Do not turn cancellation into early lock release while native work continues. A crashed server can leave an `osascript` child alive; inspect it before starting another GUI operation.
- Use explicit, idempotent setters where possible. Read back actual application state. A percentage is not dB; a normalized Smart Control is not Hz or milliseconds.
- GUI work needs an authorized disposable saved project copy. Record project/track identity, mute/solo state and region layout before editing. Never include private projects, audio, screenshots, logs or machine paths in commits.
- Drag sequences must release the button in `finally`. Do not query Accessibility while holding a drag: GarageBand's mouse tracking loop can block those queries.
- Automation is experimental. Require an empty visible lane on a copy, retain partial-write evidence, and verify with WAV exports and save/reopen. Do not retry a partially completed edit blindly.
- Keep genre knowledge in `skills/mix-engineer`, not hard-coded DSP recipes or genre-specific MCP tools. Describe source coverage honestly; do not reproduce paid lessons or infer unavailable parameter units.
- Before publication, review tracked files, staged diff and local-path/credential/media exclusions. Do not publish npm packages or upstream PRs as a side effect of building.
