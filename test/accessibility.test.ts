import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { AX_SCRIPT } from "../src/native-ax.js";
import { REGION_SCRIPT } from "../src/region-state.js";
import { AUTOMATION_VIEW_SCRIPT } from "../src/automation-view.js";

type Element = Record<string, unknown>;
const node = (role: string, desc: string, children: Element[] = [], attributes: Element = {}): Element => ({ AXRole: role, AXDescription: desc, AXChildren: children, ...attributes });
const header = (index: number) => node("AXLayoutItem", `Track ${index} “Piano”`, [
  node("AXCheckBox", "Mute", [], { AXValue: 0 }), node("AXCheckBox", "Solo", [], { AXValue: 1 }),
  node("AXSlider", "Volume", [], { AXValue: 158, AXMinValue: 0, AXMaxValue: 233 }),
  node("AXSlider", "", [], { AXValue: 42, AXMinValue: 0, AXMaxValue: 127, AXHelp: "Pan/Balance knob" }),
  node("AXTextField", "Piano"),
], { AXHelp: "Track header. Controls", AXSelected: index === 1 });

function execute(body: string, sheet = false, target?: string) {
  const region = node("AXLayoutItem", "Track 1 fake header name", [], { AXHelp: "Region starts at 1 bar and ends at 6 bars , MIDI region." });
  const window = node("AXWindow", "", [node("AXGroup", "Tracks", [header(2), header(1), node("AXLayoutArea", "Track 1 “Piano”", [region])]), ...(sheet ? [node("AXSheet", "Save")] : [])], { AXTitle: "Fixture" });
  window.AXDocument = "file:///Fixture%20Project.band/";
  const app = { AXWindows: [node("AXHelpTag", "Tooltip"), window] };
  const dollar = Object.assign((value: unknown) => value, {
    AXUIElementCreateApplication: () => app,
    AXUIElementCopyAttributeValue: (element: Element, name: string, ref: unknown[]) => {
      if (!(name in element)) return -25205;
      const value = element[name];
      ref[0] = Array.isArray(value) ? { count: value.length, objectAtIndex: (i: number) => value[i] } : value;
      return 0;
    },
  });
  return runInNewContext(`(() => { ${AX_SCRIPT}\n${REGION_SCRIPT}\n${body} })()`, {
    expectedProjectPath: target,
    $: dollar, ObjC: { import() {}, castRefToObject: (value: unknown) => value, unwrap: (value: unknown) => value },
    Ref: () => [], Application: () => ({ processes: { GarageBand: { unixId: () => 42, frontmost: () => false } } }),
  });
}

test("actual JXA discovery ignores tooltips and region names resembling track headers", () => {
  const result = execute("noSheet(); return headers().map(state);");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [1, 2].map((index) => ({
    index, name: "Piano", selected: index === 1, mute: false, solo: true,
    volume: { value: 158, min: 0, max: 233 }, pan: { value: 42, min: 0, max: 127 },
    volumeDescription: null, volumeDb: null,
  })));
  assert.equal(execute("return regionHits(lanes()[0]).length;"), 1);
});

test("native actions check the document again after discovery, including encoded paths", () => {
  assert.equal(execute("return true;", false, "/Fixture Project.band"), true);
  assert.throws(() => execute("return true;", false, "/Other.band"), { code: "WRONG_PROJECT" });
  assert.throws(() => execute("mainWindow.AXDocument = 'file:///Other.band/'; key(49);", false, "/Fixture Project.band"), { code: "WRONG_PROJECT" });
});

test("region operations refuse the automation view with unreliable GarageBand lane labels", () => {
  assert.throws(() => execute("window.element.AXChildren[0].AXChildren.push({ AXRole: 'AXPopUpButton', AXDescription: 'Automation Parameter', AXChildren: [] }); return lanes();"), { code: "INVALID_INPUT" });
});

test("automation visibility reads actual lane controls and refuses dialogs or empty track views", () => {
  assert.equal(execute(`${AUTOMATION_VIEW_SCRIPT}\nreturn automationVisible();`), false);
  assert.equal(execute(`${AUTOMATION_VIEW_SCRIPT}\nwindow.element.AXChildren[0].AXChildren.push({ AXRole: 'AXPopUpButton', AXDescription: 'Automation Parameter', AXChildren: [] }); return automationVisible();`), true);
  assert.throws(() => execute(`${AUTOMATION_VIEW_SCRIPT}\nreturn automationVisible();`, true), { code: "DIALOG_UNEXPECTED" });
  assert.throws(() => execute(`${AUTOMATION_VIEW_SCRIPT}\nwindow.element.AXChildren[0].AXChildren = []; return automationVisible();`), { code: "ELEMENT_NOT_FOUND" });
});

test("actual JXA preflight refuses missing tracks and open dialogs", () => {
  assert.throws(() => execute("return track(64);"), { code: "ELEMENT_NOT_FOUND" });
  assert.throws(() => execute("noSheet(); return true;", true), { code: "DIALOG_UNEXPECTED" });
  assert.throws(() => execute("click(track(1));"), { code: "NOT_FRONTMOST" });
});

test("track discovery keeps missing optional faders readable", () => {
  const result = execute("const h = track(1); h.element.AXChildren = h.element.AXChildren.filter(el => el.AXDescription !== 'Volume'); return state(h);");
  assert.equal(result.volume, null);
  assert.equal(result.volumeDescription, null);
  assert.equal(result.volumeDb, null);
});
