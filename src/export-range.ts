export interface ExportRangeState {
  enabled: unknown;
  value: unknown;
}

/** Also embedded in JXA. A disabled checkbox can retain a stale checked value. */
export function selectWholeSongExport(io: {
  read(): ExportRangeState; click(): void; wait(seconds: number): void;
}): ExportRangeState {
  const usable = (state: ExportRangeState) => {
    if (typeof state.enabled !== "boolean" || (state.value !== 0 && state.value !== 1)) {
      throw { code: "VERIFICATION_FAILED", message: "Export range state is unavailable." };
    }
    return state.enabled === false || state.value === 0;
  };
  let state = io.read();
  if (usable(state)) return state;
  io.click();
  for (let attempt = 0; attempt < 10; attempt++) {
    io.wait(0.1);
    state = io.read();
    if (usable(state)) return state;
  }
  throw { code: "VERIFICATION_FAILED", message: "Whole-song export was not selected after settling." };
}
