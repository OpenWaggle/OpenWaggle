import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { browserProfilesSchema } from '@shared/schemas/browser-profile'
import type { BrowserProfile } from '@shared/types/browser-profile'
import * as Effect from 'effect/Effect'
import type { SettingsServiceShape } from '../services/settings-service'
import { invokeConfiguredHostUi } from './gui-session-command-router'

const profileSettingsSchema = Schema.Struct({ browserProfiles: browserProfilesSchema })
const settingsUpdateResultSchema = Schema.Union(
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
)

/** Native cookie resources stay in the GUI; the Host owns their durable profile identities. */
export async function getGuiBrowserProfiles(settings: SettingsServiceShape) {
  const remote = await invokeConfiguredHostUi('settings:get', [])
  if (!remote.handled) return (await Effect.runPromise(settings.get())).browserProfiles
  return decodeUnknownOrThrow(profileSettingsSchema, remote.result).browserProfiles
}

export async function updateGuiBrowserProfiles(
  settings: SettingsServiceShape,
  profiles: readonly BrowserProfile[],
): Promise<void> {
  const remote = await invokeConfiguredHostUi('settings:update', [
    { browserProfiles: [...profiles] },
  ])
  if (!remote.handled) {
    await Effect.runPromise(settings.update({ browserProfiles: [...profiles] }))
    return
  }
  const result = decodeUnknownOrThrow(settingsUpdateResultSchema, remote.result)
  if (!result.ok) throw new Error(result.error)
}
