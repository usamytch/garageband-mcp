export interface TemporarySetting {
  key: string;
  value: boolean;
  read(): Promise<boolean>;
  write(value: boolean): Promise<unknown>;
}

export interface SettingEvent {
  key: string;
  phase: "snapshot" | "apply" | "restore" | "error";
  value?: boolean;
  error?: string;
}

/** Snapshot before any write; retain both primary and restoration failures. */
export async function withTemporarySettings<T>(settings: TemporarySetting[], action: () => Promise<T>,
  record: (event: SettingEvent) => Promise<void> = async () => {},
): Promise<T> {
  if (new Set(settings.map(s => s.key)).size !== settings.length) throw new Error("Duplicate temporary setting");
  const snapshots: Array<{ setting: TemporarySetting; before: boolean; attempted: boolean }> = [];
  for (const setting of settings) {
    const before = await setting.read();
    if (typeof before !== "boolean" || typeof setting.value !== "boolean") throw new Error(`Invalid state for ${setting.key}`);
    snapshots.push({ setting, before, attempted: false });
    await record({ key: setting.key, phase: "snapshot", value: before });
  }
  let result: T | undefined;
  const errors: unknown[] = [];
  try {
    // Journal restoration ownership before a write can indirectly change a peer.
    for (const snapshot of snapshots) {
      await record({ key: snapshot.setting.key, phase: "apply", value: snapshot.setting.value });
      snapshot.attempted = true;
    }
    for (const snapshot of snapshots) {
      const { setting } = snapshot;
      if (await setting.read() !== setting.value) await setting.write(setting.value);
      if (await setting.read() !== setting.value) throw new Error(`Setting did not settle: ${setting.key}`);
    }
    for (const { setting } of snapshots) if (await setting.read() !== setting.value) throw new Error(`Final setting did not settle: ${setting.key}`);
    result = await action();
  } catch (error) { errors.push(error); }
  const restorationErrors = new Set<string>();
  for (const { setting, before, attempted } of snapshots.reverse()) {
    if (!attempted) continue;
    try {
      if (await setting.read() !== before) await setting.write(before);
      if (await setting.read() !== before) throw new Error(`Restoration did not settle: ${setting.key}`);
      await record({ key: setting.key, phase: "restore", value: before });
    } catch (error) {
      restorationErrors.add(setting.key);
      errors.push(error);
      try { await record({ key: setting.key, phase: "error", error: String(error) }); }
      catch (journalError) { errors.push(journalError); }
    }
  }
  for (const { setting, before, attempted } of snapshots) {
    if (!attempted || restorationErrors.has(setting.key)) continue;
    try {
      if (await setting.read() !== before) throw new Error(`Final restoration did not settle: ${setting.key}`);
    } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, errors.map(String).join("; ") + ". Inspect the journal and settings before retrying.");
  return result as T;
}
