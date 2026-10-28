import { GBError } from "./errors.js";
import { runAX } from "./native-ax.js";
import { TRACK_SCRIPT } from "./track-state.js";
import * as ui from "./ui.js";

export const AUTOMATION_VIEW_SCRIPT = `${TRACK_SCRIPT}
  function automationVisible() {
    noSheet();
    if (!headers().length) fail('ELEMENT_NOT_FOUND', 'Automation visibility requires at least one track.');
    return scan(group('Tracks'), el => scalar(el, 'AXDescription') === 'Automation Parameter').length > 0;
  }
`;

export async function setAutomationView(visible: boolean, io = {
  read: () => runAX<boolean>(`${AUTOMATION_VIEW_SCRIPT}\nreturn automationVisible();`),
  toggle: () => ui.clickMenu(["Mix", "Show Automation"]),
}): Promise<{ visible: boolean; changed: boolean }> {
  const before = await io.read();
  if (typeof before !== "boolean") throw new GBError("VERIFICATION_FAILED", "Automation visibility is unavailable; no action taken.");
  if (before === visible) return { visible: before, changed: false };
  await io.toggle();
  const actual = await io.read();
  if (actual !== visible) throw new GBError("VERIFICATION_FAILED", "Automation view did not match the request. Inspect the view before retrying.");
  return { visible: actual, changed: true };
}
