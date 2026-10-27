import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { driveDecibels, parseDecibels, resolveControlName, setToggle } from "../src/control-model.js";
import { TRANSPORT_SCRIPT } from "../src/transport-state.js";
import { withNormalization } from "../src/export-settings.js";
import { SMART_SCRIPT } from "../src/smart-state.js";

test("dB parsing accepts GarageBand decimal commas and distinguishes unavailable values", () => {
  assert.equal(parseDecibels("−11,4 dB"), -11.4);
  assert.equal(parseDecibels("+0.0 dB"), 0);
  assert.equal(parseDecibels("-∞ dB"), -Infinity);
  assert.equal(parseDecibels("70 %"), null);
});

test("dB setter searches actual readback and rejects ignored writes or missing dB", () => {
  let raw = 110;
  let writes = 0;
  const read = () => ({ raw, db: raw === 0 ? -Infinity : Math.round((raw - 173) * 0.1 * 10) / 10 });
  const io = { read, write(value: number) { raw = value; writes++; } };
  assert.equal(driveDecibels(-4.5, 0, 233, io).db, -4.5);
  const previousWrites = writes;
  driveDecibels(-4.5, 0, 233, io);
  assert.equal(writes, previousWrites, "Repeated target should not touch the fader");
  assert.throws(() => driveDecibels(-8, 0, 233, { read, write() {} }), { code: "VERIFICATION_FAILED" });
  assert.throws(() => driveDecibels(-4, 0, 233, { read: () => ({ raw, db: null }), write() {} }), { code: "VERIFICATION_FAILED" });
  assert.throws(() => driveDecibels(NaN, 0, 233, io), { code: "INVALID_INPUT" });
});

test("control names prefer exact matches and reject ambiguous or regex-like input", () => {
  const names = ["Mid Freq", "Mid", "Low Cut", "Low"];
  assert.equal(resolveControlName(names, "mid"), 1);
  assert.equal(resolveControlName(names, "freq"), 0);
  assert.throws(() => resolveControlName(names, "m"), { code: "ELEMENT_NOT_FOUND" });
  assert.throws(() => resolveControlName(names, ".*"), { code: "ELEMENT_NOT_FOUND" });
});

test("actual transport script stops once, never starts on repeated stop, and rejects failed clicks", () => {
  const values: Record<string, number> = { Play: 1, Record: 0, Cycle: 0, "Metronome Click": 0, "Count In": 0 };
  const clicks: string[] = [];
  let ignore = false;
  const execute = (body: string) => runInNewContext(`(() => { ${TRANSPORT_SCRIPT}
    transportControl = name => ({ element: name }); positionValue = () => 1;
    ${body}
  })()`, {
    setToggle, scalar: (name: string) => values[name],
    click: (hit: { element: string }) => {
      clicks.push(hit.element);
      if (!ignore) { if (hit.element === "Stop") { values.Play = 0; values.Record = 0; } else values[hit.element] = 1 - values[hit.element]; }
    },
    fail: (code: string, message: string) => { throw { code, message }; },
  });
  execute("playback(false); playback(false);");
  assert.deepEqual(clicks, ["Stop"]);
  execute("playback(true); playback(true);");
  assert.deepEqual(clicks, ["Stop", "Play"]);
  ignore = true;
  assert.throws(() => execute("playback(false);"), { code: "VERIFICATION_FAILED" });
  values.Record = 1;
  assert.throws(() => execute("playback(true);"), { code: "VERIFICATION_FAILED" });
});

test("transport discovery accepts Go to Beginning after playback stops", () => {
  const elements = [{ AXRole: "AXButton", AXDescription: "Go to Beginning" }];
  const result = runInNewContext(`(() => { ${TRANSPORT_SCRIPT} return transportControl('Stop'); })()`, {
    group: () => elements, scan: (root: typeof elements, predicate: (el: object) => boolean) => root.filter(predicate),
    scalar: (el: Record<string, unknown>, key: string) => el[key],
    one: (hits: object[]) => { assert.equal(hits.length, 1); return hits[0]; },
  });
  assert.equal(result.AXDescription, "Go to Beginning");
});

test("per-export normalization is restored on success and failure; omission preserves it", async () => {
  let current = true;
  const writes: boolean[] = [];
  const setting = async (enabled?: boolean) => {
    const previous = current;
    if (enabled !== undefined) { writes.push(enabled); current = enabled; }
    return previous;
  };
  assert.equal(await withNormalization(false, setting, async enabled => { assert.equal(current, false); return enabled; }), false);
  assert.equal(current, true);
  await assert.rejects(withNormalization(false, setting, async () => { throw new Error("Export failed"); }), /Export failed/);
  assert.equal(current, true);
  assert.deepEqual(writes, [false, true, false, true]);
  await withNormalization(undefined, setting, async enabled => assert.equal(enabled, true));
  assert.equal(writes.length, 4);
});

test("actual Smart Controls script refreshes stale values from the previous track without editing audio", () => {
  const hits = ["Low Cut", "Amount"].map((name, i) => ({ element: {
    AXRole: "AXSlider", AXDescription: name, AXEnabled: true, AXValue: .5, actual: [.14, .35][i],
  } }));
  const writes: string[] = [];
  const dollar = Object.assign((value: unknown) => value, {
    AXUIElementSetAttributeValue: (element: typeof hits[number]["element"], key: string) => {
      writes.push(key);
      if (key === "AXFocused") element.AXValue = element.actual;
      return 0;
    },
  });
  const result = runInNewContext(`(() => { ${SMART_SCRIPT}
    headers = () => [{ element: {} }]; state = () => ({ index: 11 }); smartHits = () => hits;
    return smartState();
  })()`, {
    hits, $: dollar, delay() {}, one: (items: unknown[]) => items[0],
    scalar: (el: Record<string, unknown>, key: string) => key === "AXSelected" ? true : el[key] ?? null,
    fail: (code: string) => { throw { code }; },
  });
  assert.deepEqual(Array.from(result.controls, (c: { value: number }) => c.value), [.14, .35]);
  assert.deepEqual(writes, ["AXFocused", "AXFocused"]);
});
