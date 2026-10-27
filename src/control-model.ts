export interface SliderState {
  value: number;
  min: number;
  max: number;
}

// These functions also run inside JXA. Keep them self-contained and synchronous.
export function faderTarget(info: SliderState, kind: "volume" | "pan", value: number): number {
  if (!Number.isFinite(value) || value < (kind === "pan" ? -100 : 0) || value > 100) {
    throw { code: "INVALID_INPUT", message: "Fader value is outside its supported range." };
  }
  const center = info.min === 0 && info.max === 127 ? 64 : (info.min + info.max) / 2;
  let target = kind === "volume"
    ? info.min + (info.max - info.min) * value / 100
    : center + (value < 0 ? center - info.min : info.max - center) * value / 100;
  if (info.max - info.min > 2 && Number.isInteger(info.min) && Number.isInteger(info.max)) target = Math.round(target);
  return target;
}

export function driveSlider(
  initial: SliderState,
  target: number,
  tolerance: number,
  settledTolerance: number,
  io: { read(): number; write(value: number): void; wait(seconds: number): void; now(): number },
): SliderState {
  if (![initial.value, initial.min, initial.max, target].every(Number.isFinite) || initial.max <= initial.min || target < initial.min || target > initial.max) {
    throw { code: "INVALID_INPUT", message: "Slider target or numeric range is invalid." };
  }
  let current = initial.value;
  const deadline = io.now() + 6000;
  for (let step = 0; step <= 512 && io.now() < deadline; step++) {
    if (Math.abs(current - target) <= Math.max(tolerance, settledTolerance)) {
      io.wait(0.25);
      const settled = io.read();
      if (!Number.isFinite(settled) || Math.abs(settled - target) > settledTolerance) {
        throw { code: "VERIFICATION_FAILED", message: "Slider did not retain the requested value after settling." };
      }
      return { ...initial, value: settled };
    }
    if (step === 512) break;
    io.write(target);
    io.wait(0.005);
    const next = io.read();
    if (!Number.isFinite(next) || Math.abs(next - target) >= Math.abs(current - target)) {
      throw { code: "VERIFICATION_FAILED", message: "Slider stopped approaching the requested value." };
    }
    current = next;
  }
  throw { code: "VERIFICATION_FAILED", message: "Slider did not reach the requested value within the operation limit." };
}

export function setToggle(enabled: boolean | undefined, io: { read(): boolean; click(): void }): boolean {
  const before = io.read();
  const target = enabled === undefined ? !before : enabled;
  if (before !== target) io.click();
  if (io.read() !== target) throw { code: "VERIFICATION_FAILED", message: "Toggle did not reach the requested state." };
  return target;
}

export function parseDecibels(description: string | null): number | null {
  if (description === null) return null;
  if (/^[−-]?∞\s*dB$/.test(description)) return -Infinity;
  const match = /^([+−-]?\d+(?:[.,]\d+)?)\s*dB$/.exec(description.trim());
  return match ? Number(match[1].replace("−", "-").replace(",", ".")) : null;
}

export function resolveControlName(names: string[], requested: string): number {
  const query = requested.toLowerCase();
  let matches = names.map((name, index) => ({ name: name.toLowerCase(), index })).filter(item => item.name === query);
  if (matches.length === 0) matches = names.map((name, index) => ({ name: name.toLowerCase(), index })).filter(item => item.name.includes(query));
  if (matches.length !== 1) throw { code: "ELEMENT_NOT_FOUND", message: "Expected one control matching " + requested + "; found " + matches.length + ". Available: " + names.join(", ") };
  return matches[0].index;
}

// Search the application's actual dB readback, without assuming a fader curve.
export function driveDecibels(target: number, min: number, max: number,
  io: { read(): { raw: number; db: number | null }; write(raw: number): void },
): { raw: number; db: number | null } {
  if (!Number.isFinite(target) || target < -60 || target > 6 || !Number.isInteger(min) || !Number.isInteger(max) || max <= min) {
    throw { code: "INVALID_INPUT", message: "Expected dB from -60 to +6 and an integer fader range." };
  }
  let low = min, high = max;
  let best = io.read();
  if (best.db === null || Number.isNaN(best.db)) throw { code: "VERIFICATION_FAILED", message: "No dB readback." };
  for (let step = 0; step < 16 && low <= high; step++) {
    if (Math.abs(best.db! - target) <= 0.11) break;
    const raw = Math.floor((low + high) / 2);
    io.write(raw);
    const current = io.read();
    if (current.raw !== raw || current.db === null || Number.isNaN(current.db)) {
      throw { code: "VERIFICATION_FAILED", message: "Fader did not accept the raw position or expose dB." };
    }
    if (Math.abs(current.db - target) < Math.abs(best.db! - target)) best = current;
    if (current.db < target) low = raw + 1;
    else high = raw - 1;
  }
  if (Math.abs(best.db! - target) > 0.31) throw { code: "VERIFICATION_FAILED", message: "No fader position within 0.3 dB of the target." };
  if (io.read().raw !== best.raw) io.write(best.raw);
  const result = io.read();
  if (result.db === null || Math.abs(result.db - target) > 0.31) throw { code: "VERIFICATION_FAILED", message: "dB setting did not persist." };
  return result;
}
