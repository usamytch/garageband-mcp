import { runAX } from "./native-ax.js";
import { TRACK_SCRIPT, selectTrack } from "./track-state.js";
import { TRANSPORT_SCRIPT } from "./transport-state.js";
import { resolveControlName } from "./control-model.js";

export const SMART_SCRIPT = `${TRACK_SCRIPT}\n${TRANSPORT_SCRIPT}
  const resolveControlName = ${resolveControlName.toString()};
  function smartHits(role) {
    return scan(group('Smart Controls'), el => {
      const desc = scalar(el, 'AXDescription');
      return (role ? scalar(el, 'AXRole') === role : ['AXSlider', 'AXCheckBox'].indexOf(scalar(el, 'AXRole')) >= 0)
        && desc && ['Open Tuner', 'feedback protection', 'input monitoring', 'Automatic Level Control', 'record level'].indexOf(desc) < 0;
    });
  }
  function refreshSmart(hit) {
    // GarageBand caches slider values across tracks sharing a Smart Controls
    // layout. AXFocused refreshes the real value without moving the knob.
    if (scalar(hit.element, 'AXRole') === 'AXSlider' && scalar(hit.element, 'AXEnabled') === true) {
      if ($.AXUIElementSetAttributeValue(hit.element, $('AXFocused'), $(true)) !== 0) fail('VERIFICATION_FAILED', 'Cannot refresh the Smart Controls value.');
      delay(0.02);
    }
    return hit;
  }
  function smartState() {
    return { track: state(one(headers().filter(hit => scalar(hit.element, 'AXSelected') === true), 'selected track')),
      controls: smartHits().map(refreshSmart).map(hit => ({ name: scalar(hit.element, 'AXDescription'), role: scalar(hit.element, 'AXRole'),
        value: scalar(hit.element, 'AXValue'), min: scalar(hit.element, 'AXMinValue'), max: scalar(hit.element, 'AXMaxValue'),
        displayValue: scalar(hit.element, 'AXValueDescription'), enabled: scalar(hit.element, 'AXEnabled') })) };
  }
`;

async function prepareSmart(index?: number): Promise<void> {
  if (index !== undefined) await selectTrack(index);
  await runAX(`${SMART_SCRIPT}
    noSheet();
    transportToggle('Smart Controls', true);
    ['Track', 'Controls'].forEach(name => {
      const hit = one(scan(group('Smart Controls'), el => scalar(el, 'AXRole') === 'AXRadioButton' && scalar(el, 'AXDescription') === name), name + ' tab');
      if (Number(scalar(hit.element, 'AXValue')) !== 1) press(hit);
      if (Number(scalar(hit.element, 'AXValue')) !== 1) fail('VERIFICATION_FAILED', 'Could not select ' + name + ' tab.');
    });
    return true;
  `);
}

export async function readSmartControls(index?: number): Promise<unknown> {
  await prepareSmart(index);
  return runAX(`${SMART_SCRIPT}\nnoSheet(); return smartState();`);
}

export async function setSmartControl(name: string, value: number | boolean, index?: number): Promise<unknown> {
  await prepareSmart(index);
  return runAX(`${SMART_SCRIPT}
    noSheet();
    const selected = one(headers().filter(hit => scalar(hit.element, 'AXSelected') === true), 'selected track');
    ${index === undefined ? "" : `if (selected.index !== ${index}) fail('VERIFICATION_FAILED', 'Selected track changed.');`}
    const hits = smartHits(${typeof value === "boolean" ? "'AXCheckBox'" : "'AXSlider'"});
    const hit = hits[resolveControlName(hits.map(item => scalar(item.element, 'AXDescription')), ${JSON.stringify(name)})];
    if (scalar(hit.element, 'AXEnabled') !== true) fail('VERIFICATION_FAILED', 'Control is disabled.');
    refreshSmart(hit);
    ${typeof value === "boolean" ? `setToggle(${value}, { read: () => Number(scalar(hit.element, 'AXValue')) === 1, click: () => click(hit) });` : `const info = sliderInfo(hit); setSlider(hit, info.min + (info.max - info.min) * ${value}, 0.001, 0.005);`}
    return smartState();
  `);
}
