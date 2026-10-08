import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { SourceControlSettingsPatch } from '@shared/types/source-control'
import * as Effect from 'effect/Effect'
import type { SettingsServiceShape } from '../services/settings-service'
import type { SourceControlSettingsAccess } from '../services/source-control/source-control-settings-access'
import { createSerialSourceControlSettingsAccess } from '../services/source-control/source-control-settings-patch'
import { invokeConfiguredHostUi } from './gui-session-command-router'

const settingsUpdateResultSchema = Schema.Union(
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
)

/** Settings snapshots the Host returns are full Settings; only the fields read here are checked. */
const hostSettingsSchema = Schema.Struct({
  changeRequestOpenDestination: Schema.NullOr(Schema.Literal('inspector', 'website')),
  changeRequestOpenDestinationByProject: Schema.Record({
    key: Schema.String,
    value: Schema.Literal('inspector', 'website'),
  }),
  sourceControlHostProviders: Schema.Record({
    key: Schema.String,
    value: Schema.Literal('github', 'gitlab', 'unsupported'),
  }),
  sourceControlDetectedHostProviders: Schema.Record({
    key: Schema.String,
    value: Schema.Literal('github', 'gitlab'),
  }),
  sourceControlRepositoryAccounts: Schema.Record({ key: Schema.String, value: Schema.String }),
  sourceControlChangeRequestRepositories: Schema.Record({
    key: Schema.String,
    value: Schema.String,
  }),
  sourceControlProjectDeclarations: Schema.Record({
    key: Schema.String,
    value: Schema.Struct({
      approved: Schema.Record({ key: Schema.String, value: Schema.Literal('github', 'gitlab') }),
      declined: Schema.Record({ key: Schema.String, value: Schema.Literal('github', 'gitlab') }),
    }),
  }),
})

/**
 * Source-control Settings live in the Session Host database. An attached desktop window has an
 * isolated empty database (ADR 0048), so it reads and writes them through the Host's settings
 * channels; the owning process uses its local Settings service.
 */
export function makeSourceControlSettingsAccess(
  settings: SettingsServiceShape,
): SourceControlSettingsAccess {
  // Patches in the owning process run one at a time against the latest stored value.
  const local = createSerialSourceControlSettingsAccess({
    read: () => Effect.runPromise(settings.get()),
    update: async (partial) => {
      await Effect.runPromise(settings.update(partial))
    },
  })

  async function read(): ReturnType<SourceControlSettingsAccess['read']> {
    const remote = await invokeConfiguredHostUi('settings:get', [])
    if (!remote.handled) return local.read()
    return decodeUnknownOrThrow(hostSettingsSchema, remote.result)
  }

  async function patch(change: SourceControlSettingsPatch): Promise<void> {
    // The Host applies the patch itself, so window and Host writers never drop each other's
    // entries the way a read-modify-write across processes would.
    const remote = await invokeConfiguredHostUi('source-control:patch-settings', [change])
    if (!remote.handled) return local.patch(change)
    const result = decodeUnknownOrThrow(settingsUpdateResultSchema, remote.result)
    if (!result.ok) throw new Error(result.error)
  }

  return { read, patch }
}
