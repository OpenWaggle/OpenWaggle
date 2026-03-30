import type { TeamConfigId } from '@shared/types/brand'
import type { WaggleTeamPreset } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { TeamsRepository } from '../ports/teams-repository'
import { typedHandle } from './typed-ipc'

export function registerTeamsHandlers(): void {
  typedHandle('teams:list', () =>
    Effect.gen(function* () {
      const repo = yield* TeamsRepository
      const results = yield* repo.list()
      return [...results]
    }),
  )

  typedHandle('teams:save', (_event, preset: WaggleTeamPreset) =>
    Effect.gen(function* () {
      const repo = yield* TeamsRepository
      yield* repo.save(preset)
      return preset
    }),
  )

  typedHandle('teams:delete', (_event, id: TeamConfigId) =>
    Effect.gen(function* () {
      const repo = yield* TeamsRepository
      yield* repo.delete(id)
    }),
  )
}
