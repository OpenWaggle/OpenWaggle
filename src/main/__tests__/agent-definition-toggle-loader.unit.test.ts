import type { Settings } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { SettingsService, type SettingsServiceShape } from '../services/settings-service'

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
  togglesByProject: { '/repo': { reviewer: false, helper: true } },
}))

vi.mock('../runtime-pi-integration', () => ({ installPiRuntimeIntegration: mocks.install }))
vi.mock('../runtime', () => ({
  runAppEffect: <A, E>(effect: Effect.Effect<A, E, SettingsService>) =>
    Effect.runPromise(
      Effect.provideService(
        effect,
        SettingsService,
        fromPartial<SettingsServiceShape>({
          get: () =>
            Effect.succeed(
              fromPartial<Settings>({ agentDefinitionTogglesByProject: mocks.togglesByProject }),
            ),
        }),
      ),
    ),
}))

import { loadAgentDefinitionTogglesForProject } from '../agent-definition-toggle-loader'

describe('loadAgentDefinitionTogglesForProject', () => {
  it("reads the project's Agent-definition toggles from Settings", async () => {
    await expect(loadAgentDefinitionTogglesForProject('/repo')).resolves.toEqual({
      reviewer: false,
      helper: true,
    })
    await expect(loadAgentDefinitionTogglesForProject('/elsewhere')).resolves.toEqual({})
    expect(mocks.install).toHaveBeenCalled()
  })
})
