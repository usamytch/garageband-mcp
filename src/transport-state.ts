import { runAX } from "./native-ax.js";

export const TRANSPORT_SCRIPT = `
  function transportControl(name) {
    return one(scan(group('Control Bar'), el => (scalar(el, 'AXDescription') === name || name === 'Stop' && scalar(el, 'AXDescription') === 'Go to Beginning') && ['AXButton', 'AXCheckBox'].indexOf(scalar(el, 'AXRole')) >= 0), name);
  }
  function checked(name) { return Number(scalar(transportControl(name).element, 'AXValue')) === 1; }
  function transportToggle(name, enabled) {
    return setToggle(enabled, { read: () => checked(name), click: () => click(transportControl(name)) });
  }
  function positionValue(name) {
    const hits = scan(group('Control Bar'), el => scalar(el, 'AXRole') === 'AXSlider' && scalar(el, 'AXDescription') === name);
    return hits.length === 1 ? scalar(hits[0].element, 'AXValue') : null;
  }
  function transportState() {
    return { playing: checked('Play'), recording: checked('Record'), cycle: checked('Cycle'),
      metronome: checked('Metronome Click'), countIn: checked('Count In'),
      bar: positionValue('bar'), beat: positionValue('beat'), master: positionValue('Master Volume') };
  }
  function playback(playing) {
    if (playing && checked('Record')) fail('VERIFICATION_FAILED', 'Stop recording before starting playback.');
    if (playing) transportToggle('Play', true);
    else if (checked('Play') || checked('Record')) click(transportControl('Stop'));
    if (checked('Play') !== playing || checked('Record')) fail('VERIFICATION_FAILED', 'Transport did not reach the requested state.');
    return transportState();
  }
`;

export async function readTransport(): Promise<unknown> {
  return runAX(`${TRANSPORT_SCRIPT}\nnoSheet(); return transportState();`);
}

export async function setPlayback(playing: boolean): Promise<unknown> {
  return runAX(`${TRANSPORT_SCRIPT}
    noSheet();
    return playback(${playing});
  `);
}

export async function setControlToggle(name: string, enabled?: boolean): Promise<boolean> {
  return runAX(`${TRANSPORT_SCRIPT}\nnoSheet(); return transportToggle(${JSON.stringify(name)}, ${enabled === undefined ? "undefined" : enabled});`);
}

export async function seekBar(bar: number): Promise<number> {
  return runAX(`${TRANSPORT_SCRIPT}
    noSheet();
    if (checked('Play') || checked('Record')) fail('VERIFICATION_FAILED', 'Stop transport before moving the playhead.');
    const cycle = checked('Cycle');
    try {
      transportToggle('Cycle', false);
      click(transportControl('Stop'));
      if (positionValue('bar') !== 1 || positionValue('beat') !== 1) fail('VERIFICATION_FAILED', 'Could not rewind to bar 1 beat 1.');
      const hit = one(scan(group('Control Bar'), el => scalar(el, 'AXRole') === 'AXSlider' && scalar(el, 'AXDescription') === 'bar'), 'bar position');
      let previous = positionValue('bar');
      for (let step = 0; step < 512 && previous !== ${bar}; step++) {
        if ($.AXUIElementSetAttributeValue(hit.element, $('AXValue'), $(${bar})) !== 0) fail('VERIFICATION_FAILED', 'Bar position write failed.');
        delay(0.005);
        const next = positionValue('bar');
        if (typeof next !== 'number' || Math.abs(next - ${bar}) >= Math.abs(previous - ${bar})) fail('VERIFICATION_FAILED', 'Bar position stopped approaching the target.');
        previous = next;
      }
      delay(0.2);
      if (positionValue('bar') !== ${bar} || positionValue('beat') !== 1) fail('VERIFICATION_FAILED', 'Playhead did not reach the requested bar and beat 1.');
      return positionValue('bar');
    } finally { transportToggle('Cycle', cycle); }
  `);
}
