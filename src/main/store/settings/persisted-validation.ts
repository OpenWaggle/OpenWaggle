import { safeDecodeUnknown } from '@shared/schema'
import { settingsUpdateSchema } from '@shared/schemas/settings'
import { DEFAULT_APPEARANCE_TERMINAL_PALETTE } from '@shared/types/appearance-preferences'
import {
  type BrowserProfile,
  isBuiltInBrowserProfileId,
  resolveBrowserProfiles,
} from '@shared/types/browser-profile'
import {
  DEFAULT_SHORTCUT_BINDINGS,
  isMandatoryShortcutCommand,
  SHORTCUT_COMMANDS,
  type ShortcutBinding,
  type ShortcutCommand,
  shortcutBindingKey,
  shortcutScopesOverlap,
} from '@shared/types/shortcuts'
import { SettingsStoreReadError } from '../../errors'
import {
  CURRENT_SETTINGS_KEYS,
  SETTINGS_KEY_APPEARANCE_PREFERENCES,
  SETTINGS_KEY_DIFF_WRAP_LINES,
  SETTINGS_KEY_SHORTCUT_BINDINGS,
} from './keys'

type ShortcutBindingsPatch = Readonly<Partial<Record<ShortcutCommand, ShortcutBinding | null>>>

function isObjectRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function selectKnownSettings(storedSettings: Readonly<Record<string, unknown>>) {
  const selected: Record<string, unknown> = {}
  for (const key of CURRENT_SETTINGS_KEYS) {
    if (Object.hasOwn(storedSettings, key)) selected[key] = storedSettings[key]
  }
  return selected
}

/** Explicit compatibility transforms for formats written by earlier OpenWaggle releases. */
function migratePersistedSettingsForValidation(storedSettings: Readonly<Record<string, unknown>>) {
  const migrated = selectKnownSettings(storedSettings)
  const diffWrapLines = migrated[SETTINGS_KEY_DIFF_WRAP_LINES]
  if (diffWrapLines === 'true' || diffWrapLines === 'false') {
    migrated[SETTINGS_KEY_DIFF_WRAP_LINES] = diffWrapLines === 'true'
  }

  const bindings = migrated[SETTINGS_KEY_SHORTCUT_BINDINGS]
  if (isObjectRecord(bindings)) {
    // Earlier releases persisted only the commands available at the time. Fill
    // missing commands, but leave every present value intact for strict decoding.
    migrated[SETTINGS_KEY_SHORTCUT_BINDINGS] = { ...DEFAULT_SHORTCUT_BINDINGS, ...bindings }
  }

  const appearance = migrated[SETTINGS_KEY_APPEARANCE_PREFERENCES]
  if (isObjectRecord(appearance) && !Object.hasOwn(appearance, 'terminalPalette')) {
    migrated[SETTINGS_KEY_APPEARANCE_PREFERENCES] = {
      ...appearance,
      terminalPalette: DEFAULT_APPEARANCE_TERMINAL_PALETTE,
    }
  }
  return migrated
}

function validateLegacyShortcutBindings(patch: ShortcutBindingsPatch) {
  const candidate: Record<ShortcutCommand, ShortcutBinding | null> = {
    ...DEFAULT_SHORTCUT_BINDINGS,
  }
  for (const command of SHORTCUT_COMMANDS) {
    if (Object.hasOwn(patch, command)) candidate[command] = patch[command] ?? null
  }

  const owners = new Map<string, ShortcutCommand[]>()
  for (const command of SHORTCUT_COMMANDS) {
    const binding = candidate[command]
    if (binding === null) {
      if (isMandatoryShortcutCommand(command)) {
        return `Shortcut ${command} must stay assigned.`
      }
      continue
    }

    const key = shortcutBindingKey(binding)
    const owner = owners.get(key)?.find((existing) => shortcutScopesOverlap(command, existing))
    if (owner !== undefined) return `Shortcut ${key} is already assigned to ${owner}.`
    owners.set(key, [...(owners.get(key) ?? []), command])
  }
  return null
}

function validateConfiguredBrowserProfiles(profiles: readonly BrowserProfile[]) {
  const seen = new Set<string>()
  for (const profile of profiles) {
    if (profile.kind !== 'persistent') {
      return `Configured browser profile ${profile.id} must be persistent.`
    }
    if (isBuiltInBrowserProfileId(profile.id)) {
      return `Configured browser profile ${profile.id} conflicts with a built-in profile.`
    }
    if (seen.has(profile.id)) return `Configured browser profile ${profile.id} is duplicated.`
    seen.add(profile.id)
  }
  return null
}

/**
 * A successful query with no rows may use defaults. Present current settings must decode completely;
 * silently replacing a corrupt value would allow later writes to overwrite the user's saved intent.
 */
export function validatePersistedSettings(storedSettings: Readonly<Record<string, unknown>>) {
  const decoded = safeDecodeUnknown(
    settingsUpdateSchema,
    migratePersistedSettingsForValidation(storedSettings),
  )
  if (!decoded.success) {
    throw new SettingsStoreReadError({
      operation: 'decode',
      message: `Saved settings are invalid: ${decoded.issues.join('; ')}`,
    })
  }

  if (decoded.data.shortcutBindings !== undefined) {
    const issue = validateLegacyShortcutBindings(decoded.data.shortcutBindings)
    if (issue !== null) {
      throw new SettingsStoreReadError({ operation: 'decode', message: issue })
    }
  }

  if (decoded.data.browserProfiles !== undefined) {
    const issue = validateConfiguredBrowserProfiles(decoded.data.browserProfiles)
    if (issue !== null) {
      throw new SettingsStoreReadError({ operation: 'decode', message: issue })
    }
  }

  if (
    decoded.data.browserDefaultProfileId !== undefined &&
    !resolveBrowserProfiles(decoded.data.browserProfiles ?? []).some(
      (profile) => profile.id === decoded.data.browserDefaultProfileId,
    )
  ) {
    throw new SettingsStoreReadError({
      operation: 'decode',
      message: `Default browser profile ${decoded.data.browserDefaultProfileId} is not configured.`,
    })
  }
}
