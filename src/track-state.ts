import { GBError } from "./errors.js";
import { runAX } from "./native-ax.js";
import { sleep } from "./osa.js";
import * as ui from "./ui.js";
import type { SliderState } from "./control-model.js";

export interface TrackState {
  index: number;
  name: string;
  selected: boolean;
  mute: boolean;
  solo: boolean;
  volume: SliderState | null;
  pan: SliderState | null;
  volumeDescription: string | null;
  volumeDb: number | null;
}

export const TRACK_SCRIPT = `
  function headers() {
    return scan(group('Tracks'), el => scalar(el, 'AXRole') === 'AXLayoutItem' && /^Track \\d+ /.test(scalar(el, 'AXDescription') || '') && /^Track header\\./.test(scalar(el, 'AXHelp') || ''))
      .map(hit => ({ ...hit, index: Number(/^Track (\\d+) /.exec(scalar(hit.element, 'AXDescription'))[1]) }))
      .sort((a, b) => a.index - b.index);
  }
  function track(index) {
    return one(headers().filter(hit => hit.index === index), 'track ' + index);
  }
  function showTrack(index) {
    let header = track(index);
    const box = geometry(header);
    const point = { x: box.pos[0] + box.size[0] / 2, y: box.pos[1] + box.size[1] / 2 };
    try { visible(point, box.clips); return header; } catch (error) {
      if (error.code !== 'ELEMENT_NOT_FOUND') throw error;
    }
    const scrollbar = one(scan(group('Tracks'), el => scalar(el, 'AXRole') === 'AXScrollBar' && scalar(el, 'AXOrientation') === 'AXVerticalOrientation' && scalar(el, 'AXEnabled') === true), 'vertical track scrollbar');
    const all = headers();
    const fraction = all.length <= 1 ? 0 : all.findIndex(hit => hit.index === index) / (all.length - 1);
    if ($.AXUIElementSetAttributeValue(scrollbar.element, $('AXValue'), $(fraction)) !== 0) fail('VERIFICATION_FAILED', 'Track scrolling failed.');
    delay(0.25);
    header = track(index);
    const after = geometry(header);
    visible({ x: after.pos[0] + after.size[0] / 2, y: after.pos[1] + after.size[1] / 2 }, after.clips);
    return header;
  }
  function control(header, name) {
    return one(scan(header, el => {
      const role = scalar(el, 'AXRole');
      const desc = scalar(el, 'AXDescription') || '';
      if (name === 'pan') return role === 'AXSlider' && /^Pan\\/Balance knob/.test(scalar(el, 'AXHelp') || '');
      if (name === 'volume') return role === 'AXSlider' && desc === 'Volume';
      if (name === 'name') return role === 'AXTextField';
      return role === 'AXCheckBox' && desc === name;
    }), name + ' control on track ' + header.index);
  }
  function state(header) {
    const optionalSlider = name => {
      try { return sliderInfo(control(header, name)); } catch (e) { return null; }
    };
    let volumeDescription = null;
    try { volumeDescription = scalar(control(header, 'volume').element, 'AXValueDescription'); } catch (e) {}
    return {
      index: header.index,
      name: scalar(control(header, 'name').element, 'AXDescription'),
      selected: scalar(header.element, 'AXSelected') === true,
      mute: Number(scalar(control(header, 'Mute').element, 'AXValue')) === 1,
      solo: Number(scalar(control(header, 'Solo').element, 'AXValue')) === 1,
      volume: optionalSlider('volume'), pan: optionalSlider('pan'),
      volumeDescription: volumeDescription,
      volumeDb: parseDecibels(volumeDescription)
    };
  }
`;

export async function readTracks(): Promise<TrackState[]> {
  return runAX(`${TRACK_SCRIPT}\nnoSheet(); return headers().map(state);`);
}

export async function selectTrack(index: number): Promise<TrackState> {
  return runAX(`${TRACK_SCRIPT}
    noSheet();
    const header = showTrack(${index});
    if (scalar(header.element, 'AXSelected') !== true) click(control(header, 'name'));
    const result = state(header);
    if (!result.selected) fail('VERIFICATION_FAILED', 'Track ${index} was not selected.');
    return result;
  `);
}

export async function setTrackToggle(index: number | undefined, name: "Mute" | "Solo", enabled?: boolean): Promise<TrackState> {
  return runAX(`${TRACK_SCRIPT}
    noSheet();
    const header = ${index === undefined ? "one(headers().filter(hit => scalar(hit.element, 'AXSelected') === true), 'selected track')" : `track(${index})`};
    const checkbox = control(header, ${JSON.stringify(name)});
    setToggle(${enabled === undefined ? "undefined" : enabled}, {
      read: () => Number(scalar(checkbox.element, 'AXValue')) === 1,
      click: () => { showTrack(header.index); click(control(track(header.index), ${JSON.stringify(name)})); }
    });
    const result = state(header);
    return result;
  `);
}

export async function setTrackSlider(index: number, name: "volume" | "pan", value: number): Promise<TrackState> {
  return runAX(`${TRACK_SCRIPT}
    noSheet();
    const header = track(${index});
    const slider = control(header, ${JSON.stringify(name)});
    const info = sliderInfo(slider);
    const target = faderTarget(info, ${JSON.stringify(name)}, ${value});
    const discrete = info.max - info.min > 2 && Number.isInteger(info.min) && Number.isInteger(info.max);
    setSlider(slider, target, discrete ? 0 : 0.0001);
    return state(header);
  `);
}

export async function setMasterVolume(level: number): Promise<SliderState> {
  return runAX(`
    noSheet();
    const slider = one(scan(group('Control Bar'), el => scalar(el, 'AXRole') === 'AXSlider' && scalar(el, 'AXDescription') === 'Master Volume'), 'master volume');
    const info = sliderInfo(slider);
    return setSlider(slider, info.min + (info.max - info.min) * ${level} / 100, 0.0001, (info.max - info.min) / 127);
  `);
}

export async function setTrackDecibels(index: number, db: number): Promise<TrackState> {
  return runAX(`${TRACK_SCRIPT}
    noSheet();
    const header = track(${index});
    const slider = control(header, 'volume');
    const info = sliderInfo(slider);
    driveDecibels(${db}, info.min, info.max, {
      read: () => ({ raw: scalar(slider.element, 'AXValue'), db: parseDecibels(scalar(slider.element, 'AXValueDescription')) }),
      write: raw => setSlider(slider, raw, 0)
    });
    return state(header);
  `);
}

export async function addTrack(type: "software" | "audio" | "drummer"): Promise<TrackState> {
  const before = await readTracks();
  await ui.clickMenu(["Track", "New Track…"]);
  await sleep(300);
  const pattern = { software: "^MIDI, Software Instrument$", audio: "^Mic or Line, Audio$", drummer: "^Drummer," }[type];
  await runAX(`
    const sheet = one(scan(window, el => scalar(el, 'AXRole') === 'AXSheet'), 'New Track sheet');
    if (scalar(sheet.element, 'AXDescription') !== 'New Track') fail('DIALOG_UNEXPECTED', 'Expected the New Track dialog.');
    const radio = one(scan(sheet, el => scalar(el, 'AXRole') === 'AXRadioButton' && new RegExp(${JSON.stringify(pattern)}).test(scalar(el, 'AXDescription') || '')), '${type} track type');
    if (Number(scalar(radio.element, 'AXValue')) !== 1) press(radio);
    if (Number(scalar(radio.element, 'AXValue')) !== 1) fail('VERIFICATION_FAILED', 'The requested track type was not selected.');
    const create = one(scan(sheet, el => scalar(el, 'AXRole') === 'AXButton' && scalar(el, 'AXTitle') === 'Create'), 'Create button');
    press(create);
    return true;
  `);
  await sleep(800);
  const after = await readTracks();
  const selected = after.filter(track => track.selected);
  if (after.length !== before.length + 1 || selected.length !== 1) {
    throw new GBError("VERIFICATION_FAILED", "The new track count or selection did not match the requested creation.");
  }
  return selected[0];
}
