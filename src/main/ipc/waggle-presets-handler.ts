import type { WagglePresetId } from '@shared/types/brand'
import type { WagglePreset } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { WagglePresetsRepository } from '../ports/waggle-presets-repository'
import { typedHandle } from './typed-ipc'

export function registerWagglePresetsHandlers(): void {
  typedHandle('waggle-presets:list', (_event, projectPath?: string | null) =>
    Effect.gen(function* () {
      const repo = yield* WagglePresetsRepository
      const results = yield* repo.list(projectPath)
      return [...results]
    }),
  )

  typedHandle('waggle-presets:save', (_event, preset: WagglePreset, projectPath?: string | null) =>
    Effect.gen(function* () {
      const repo = yield* WagglePresetsRepository
      return yield* repo.save(preset, projectPath)
    }),
  )

  typedHandle('waggle-presets:delete', (_event, id: WagglePresetId, projectPath?: string | null) =>
    Effect.gen(function* () {
      const repo = yield* WagglePresetsRepository
      yield* repo.delete(id, projectPath)
    }),
  )
}
