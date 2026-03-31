/**
 * SQLite adapter for the TeamsRepository port.
 */
import { Effect, Layer } from 'effect'
import { TeamsRepository } from '../ports/teams-repository'

export const SqliteTeamsRepositoryLive = Effect.promise(async () => {
  const store = await import('../store/teams')
  return Layer.succeed(
    TeamsRepository,
    TeamsRepository.of({
      list: () => Effect.sync(() => store.listTeamPresets()),
      save: (preset) => Effect.sync(() => store.saveTeamPreset(preset)),
      delete: (id) => Effect.sync(() => store.deleteTeamPreset(id)),
    }),
  )
}).pipe(Layer.unwrapEffect)
