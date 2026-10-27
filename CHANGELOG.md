# Fork changes

## Mixing edition

- Serialize GUI handlers and coordinate cooperating server processes with a shared lock.
- Require explicit saved project paths for 48 project-bound tools; verify identity before native work.
- Add mixer readback, dB control, idempotent mute/solo/transport, and Smart Control discovery and setters.
- Add verified whole-bar region moves with stale-ID, overlap and compatibility checks.
- Add experimental volume automation on fresh project copies, retaining evidence for render verification.
- Make evidence and opt-in fixture paths independent of the original development workspace.
- Add behavior tests, stdio/schema smoke checks and macOS CI.
- Package a mixing skill with six genre profiles, source provenance, a mix plan and export evaluation workflow.
- Keep the current checkout text-only; retain upstream history and license.
