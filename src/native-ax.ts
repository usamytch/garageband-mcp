import { GBError, type GBErrorCode } from "./errors.js";
import { runJXA } from "./osa.js";
import { driveSlider, faderTarget, setToggle, parseDecibels, driveDecibels } from "./control-model.js";
import { operationContext } from "./operation-context.js";

/** Native AX avoids hundreds of slow System Events round trips per tree scan. */
export const AX_SCRIPT = `
  const driveSlider = ${driveSlider.toString()};
  const faderTarget = ${faderTarget.toString()};
  const setToggle = ${setToggle.toString()};
  const parseDecibels = ${parseDecibels.toString()};
  const driveDecibels = ${driveDecibels.toString()};
  ObjC.import('ApplicationServices');
  const process = Application('System Events').processes['GarageBand'];
  const app = $.AXUIElementCreateApplication(process.unixId());
  function fail(code, message) { throw { code: code, message: message }; }
  function attr(element, name) {
    const result = Ref();
    if ($.AXUIElementCopyAttributeValue(element, $(name), result) !== 0) return null;
    return ObjC.castRefToObject(result[0]);
  }
  function scalar(element, name) {
    const value = attr(element, name);
    return value === null ? null : ObjC.unwrap(value);
  }
  function children(element) {
    const value = attr(element, 'AXChildren');
    const result = [];
    if (value) for (let i = 0; i < Number(value.count); i++) result.push(value.objectAtIndex(i));
    return result;
  }
  function scan(root, predicate) {
    const queue = [root], found = [];
    let visited = 0;
    while (queue.length && visited++ < 2000) {
      const hit = queue.shift();
      if (predicate(hit.element)) found.push(hit);
      children(hit.element).forEach((child, index) => queue.push({ element: child, path: hit.path.concat(index) }));
    }
    if (queue.length) fail('ELEMENT_NOT_FOUND', 'Accessibility tree exceeds the scan limit; no action taken.');
    return found;
  }
  const windows = attr(app, 'AXWindows');
  if (!windows || !Number(windows.count)) fail('NO_PROJECT', 'GarageBand has no window.');
  let mainWindow = null;
  for (let i = 0; i < Number(windows.count); i++) {
    const candidate = windows.objectAtIndex(i);
    if (scalar(candidate, 'AXRole') === 'AXWindow') { mainWindow = candidate; break; }
  }
  if (mainWindow === null) fail('NO_PROJECT', 'GarageBand has no document window.');
  const window = { element: mainWindow, path: [] };
  function assertTarget() {
    if (typeof expectedProjectPath === 'undefined' || expectedProjectPath === null) return;
    const current = attr(app, 'AXWindows');
    for (let i = 0; current && i < Number(current.count); i++) {
      const win = current.objectAtIndex(i);
      if (scalar(win, 'AXRole') !== 'AXWindow') continue;
      const document = scalar(win, 'AXDocument');
      if (!document && ['Settings', 'Preferences', 'Export Song to Disk'].includes(scalar(win, 'AXTitle'))) continue;
      let path = document && decodeURIComponent(document.startsWith('file://') ? document.slice(7) : document);
      if (path && path.endsWith('/')) path = path.slice(0, -1);
      if (path !== expectedProjectPath) fail('WRONG_PROJECT', 'The front document changed; no further action taken.');
      return;
    }
    fail('WRONG_PROJECT', 'The target document is no longer open.');
  }
  assertTarget();
  function group(name) {
    const index = children(window.element).findIndex(el => scalar(el, 'AXDescription') === name);
    if (index < 0) fail('ELEMENT_NOT_FOUND', 'Window group not found: ' + name);
    return { element: children(window.element)[index], path: [index] };
  }
  function noSheet() {
    if (children(window.element).some(el => scalar(el, 'AXRole') === 'AXSheet')) {
      fail('DIALOG_UNEXPECTED', 'Close the open dialog before changing tracks or mixer controls.');
    }
  }
  function one(hits, label) {
    if (hits.length !== 1) fail('ELEMENT_NOT_FOUND', 'Expected one ' + label + ', found ' + hits.length + '.');
    return hits[0];
  }
  function press(hit) {
    assertTarget();
    const status = $.AXUIElementPerformAction(hit.element, $('AXPress'));
    if (status !== 0) fail('VERIFICATION_FAILED', 'AXPress failed: ' + status);
    delay(0.15);
  }
  function key(code, flags) {
    assertTarget();
    if (!process.frontmost()) fail('NOT_FRONTMOST', 'GarageBand lost focus before the shortcut; no key sent.');
    const down = $.CGEventCreateKeyboardEvent(null, code, true);
    $.CGEventSetFlags(down, flags || 0);
    $.CGEventPost($.kCGHIDEventTap, down);
    delay(0.06);
    const up = $.CGEventCreateKeyboardEvent(null, code, false);
    $.CGEventSetFlags(up, flags || 0);
    $.CGEventPost($.kCGHIDEventTap, up);
    delay(0.25);
  }
  function setText(hit, value) {
    assertTarget();
    const status = $.AXUIElementSetAttributeValue(hit.element, $('AXValue'), $(value));
    if (status !== 0 || scalar(hit.element, 'AXValue') !== value) {
      fail('VERIFICATION_FAILED', 'Text field did not accept the requested value.');
    }
  }
  function bounds(element) {
    function pair(name, pattern) {
      const value = attr(element, name);
      if (value === null) fail('ELEMENT_NOT_FOUND', 'Missing bounds: ' + name);
      const text = ObjC.unwrap(ObjC.castRefToObject($.CFCopyDescription(value)));
      const match = pattern.exec(text);
      if (!match) fail('ELEMENT_NOT_FOUND', 'Unsupported accessibility bounds: ' + name);
      return [Number(match[1]), Number(match[2])];
    }
    return { pos: pair('AXPosition', /x:([-\\d.]+) y:([-\\d.]+)/), size: pair('AXSize', /w:([-\\d.]+) h:([-\\d.]+)/) };
  }
  function geometry(hit) {
    let element = window.element;
    const clips = [element];
    hit.path.forEach(index => { element = children(element)[index]; if (scalar(element, 'AXRole') === 'AXScrollArea') clips.push(element); });
    return { ...bounds(hit.element), clips: clips };
  }
  function visible(point, clips) {
    clips.forEach(clip => {
      const box = bounds(clip);
      if (point.x < box.pos[0] || point.y < box.pos[1] || point.x >= box.pos[0] + box.size[0] || point.y >= box.pos[1] + box.size[1]) {
        fail('ELEMENT_NOT_FOUND', 'Control is outside the visible track area. Scroll or zoom before retrying.');
      }
    });
  }
  function click(hit) {
    assertTarget();
    if (!process.frontmost()) fail('NOT_FRONTMOST', 'GarageBand lost focus before the click; no click sent.');
    if (process.windows[0].name() !== scalar(window.element, 'AXTitle')) fail('VERIFICATION_FAILED', 'The front window changed before the click.');
    const box = geometry(hit);
    const point = { x: box.pos[0] + box.size[0] / 2, y: box.pos[1] + box.size[1] / 2 };
    if (box.size[0] <= 0 || box.size[1] <= 0) fail('ELEMENT_NOT_FOUND', 'Control has no visible bounds.');
    visible(point, box.clips);
    const down = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, point, $.kCGMouseButtonLeft);
    $.CGEventSetFlags(down, 0);
    $.CGEventSetIntegerValueField(down, $.kCGMouseEventClickState, 1);
    $.CGEventPost($.kCGHIDEventTap, down);
    delay(0.06);
    const up = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, point, $.kCGMouseButtonLeft);
    $.CGEventSetFlags(up, 0);
    $.CGEventSetIntegerValueField(up, $.kCGMouseEventClickState, 1);
    $.CGEventPost($.kCGHIDEventTap, up);
    delay(0.2);
  }
  function sliderInfo(hit) {
    const value = scalar(hit.element, 'AXValue');
    const min = scalar(hit.element, 'AXMinValue');
    const max = scalar(hit.element, 'AXMaxValue');
    if (![value, min, max].every(v => typeof v === 'number' && Number.isFinite(v)) || max <= min) {
      fail('VERIFICATION_FAILED', 'Slider does not expose a usable numeric range.');
    }
    return { value: value, min: min, max: max };
  }
  function setSlider(hit, target, tolerance, settledTolerance) {
    return driveSlider(sliderInfo(hit), target, tolerance, settledTolerance === undefined ? tolerance : settledTolerance, {
      read: () => scalar(hit.element, 'AXValue'),
      write: value => {
        assertTarget();
        const status = $.AXUIElementSetAttributeValue(hit.element, $('AXValue'), $(value));
        if (status !== 0) fail('VERIFICATION_FAILED', 'AXValue write failed: ' + status);
      },
      wait: delay,
      now: () => Date.now()
    });
  }
`;

export async function runAX<T>(body: string): Promise<T> {
  const out = await runJXA(`
    let result;
    try {
      result = (() => { const expectedProjectPath = ${JSON.stringify(operationContext.getStore()?.projectPath ?? null)}; ${AX_SCRIPT}\n${body} })();
    } catch (error) {
      result = { error: { code: error.code || 'OSASCRIPT_ERROR', message: String(error.message || error) } };
    }
    JSON.stringify(result);
  `, 20_000);
  const result = JSON.parse(out);
  if (result?.error) {
    throw new GBError(result.error.code as GBErrorCode, result.error.message);
  }
  return result as T;
}
