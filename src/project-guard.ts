import { realpath } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { GBError } from "./errors.js";
import { runJXA } from "./osa.js";
import { operationContext } from "./operation-context.js";

export async function canonicalProjectPath(path: string): Promise<string> {
  if (!isAbsolute(path) || !/\.band\/?$/i.test(path)) {
    throw new GBError("INVALID_INPUT", "projectPath must be an absolute path to an existing .band project.");
  }
  try {
    return await realpath(path);
  } catch {
    throw new GBError("INVALID_INPUT", `Project does not exist: ${path}`);
  }
}

/** AXDocument remains readable during export, unlike GarageBand's Apple Events. */
export async function readProjectPath(): Promise<string | null> {
  const text = await operationContext.exit(() => runJXA(`
    ObjC.import('ApplicationServices');
    const p = Application('System Events').processes['GarageBand'];
    if (!p.exists()) throw new Error('GarageBand is not running.');
    const app = $.AXUIElementCreateApplication(p.unixId());
    function attr(el, name) {
      const ref = Ref();
      return $.AXUIElementCopyAttributeValue(el, $(name), ref) === 0 ? ObjC.castRefToObject(ref[0]) : null;
    }
    const wins = attr(app, 'AXWindows');
    let path = null;
    if (wins) for (let i = 0; i < Number(wins.count); i++) {
      const win = wins.objectAtIndex(i);
      if (ObjC.unwrap(attr(win, 'AXRole')) !== 'AXWindow') continue;
      const doc = attr(win, 'AXDocument');
      if (doc) { path = ObjC.unwrap(doc); break; }
      const title = attr(win, 'AXTitle');
      if (title && ['Settings', 'Preferences', 'Export Song to Disk'].includes(ObjC.unwrap(title))) continue;
      break;
    }
    JSON.stringify(path);
  `));
  const url: unknown = JSON.parse(text);
  if (typeof url !== "string") return null;
  return canonicalProjectPath(normalize(fileURLToPath(url)));
}

export async function verifyProject(expected: string, read = readProjectPath): Promise<void> {
  const actual = await read();
  if (actual !== expected) {
    throw new GBError("WRONG_PROJECT", `Expected ${expected}; front document is ${actual ?? "unsaved or absent"}. No further action taken.`);
  }
}
