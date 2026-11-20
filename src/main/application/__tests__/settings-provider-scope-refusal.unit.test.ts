import os from 'node:os'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  ActiveProjectChangeService,
  type ActiveProjectChangeServiceShape,
} from '../../ports/active-project-change-service'
import { SettingsService, type SettingsServiceShape } from '../../services/settings-service'
import { updateSettingsOperation } from '../settings-operations'

function update(providerRestrictionsByPath: Record<string, Record<string, boolean>>) {
  const settings = fromPartial<SettingsServiceShape>({})
  return Effect.runPromise(
    updateSettingsOperation({ providerRestrictionsByPath }).pipe(
      Effect.provideService(SettingsService, settings),
      Effect.provideService(
        ActiveProjectChangeService,
        fromPartial<ActiveProjectChangeServiceShape>({}),
      ),
    ),
  )
}

describe('a settings update that names a provider scope', () => {
  it.each([
    ['the home directory itself', os.homedir()],
    ['a folder outside the home directory', path.join(path.parse(os.homedir()).root, 'opt')],
    ['a path that is not normalized', `${os.homedir()}/projects/../elsewhere`],
    ["OpenWaggle's own configuration", path.join(os.homedir(), '.openwaggle', 'agents')],
  ])('is refused for %s', async (_case, scopePath) => {
    const result = await update({ [scopePath]: { 'amazon-bedrock': false } })

    expect(result).toMatchObject({ ok: false })
  })
})
