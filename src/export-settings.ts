import { runAX } from "./native-ax.js";
import * as ui from "./ui.js";
import { withTemporarySettings, type SettingEvent } from "./settings-transaction.js";

// A per-export override is restored after the export finishes. The UI is the
// source of truth; reading the preferences file can return cached settings.
export async function exportNormalization(enabled?: boolean): Promise<boolean> {
  await runAX(`noSheet(); group('Tracks'); return true;`);
  await ui.clickMenu(["GarageBand", "Settings…"]);
  const previous = await runAX<boolean>(`
    if (scalar(window.element, 'AXTitle') !== 'Settings') fail('DIALOG_UNEXPECTED', 'Settings window did not open.');
    try {
      press(one(scan(window, el => scalar(el, 'AXRole') === 'AXButton' && scalar(el, 'AXTitle') === 'Advanced'), 'Advanced settings'));
      const hit = one(scan(window, el => scalar(el, 'AXRole') === 'AXCheckBox' && scalar(el, 'AXTitle') === 'Export projects at full volume'), 'Auto Normalize');
      const before = Number(scalar(hit.element, 'AXValue')) === 1;
      ${enabled === undefined ? "" : `setToggle(${enabled}, { read: () => Number(scalar(hit.element, 'AXValue')) === 1, click: () => press(hit) });`}
      return before;
    } finally {
      const close = attr(window.element, 'AXCloseButton');
      if (close === null || $.AXUIElementPerformAction(close, $('AXPress')) !== 0) fail('VERIFICATION_FAILED', 'Could not close Settings.');
      delay(0.2);
    }
  `);
  // Dismiss any menu tracking left by the Settings transition before the next
  // Apple Event. Only send Escape after confirming the document is back.
  await runAX(`noSheet(); group('Tracks'); key(53, 0); return true;`);
  return previous;
}

export async function withNormalization<T>(requested: boolean | undefined,
  setting: (enabled?: boolean) => Promise<boolean>, action: (enabled: boolean) => Promise<T>,
  record?: (event: SettingEvent) => Promise<void>,
): Promise<T> {
  if (requested === undefined) return action(await setting());
  return withTemporarySettings([{ key: "Auto Normalize", value: requested,
    read: () => setting(), write: value => setting(value),
  }], () => action(requested), record);
}
