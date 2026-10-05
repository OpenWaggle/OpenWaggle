export type SettingsPatchWrite = { readonly key: string; readonly value: unknown }

export function appendChangedSetting(
  writes: SettingsPatchWrite[],
  changed: boolean,
  key: string,
  value: unknown,
) {
  if (changed) writes.push({ key, value })
}
