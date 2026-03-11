import type { TeamConfigId } from '@shared/types/brand'
import type { WaggleTeamPreset } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { deleteTeamPreset, listTeamPresets, saveTeamPreset } from '../store/teams'
import { typedHandle } from './typed-ipc'

export function registerTeamsHandlers(): void {
  typedHandle('teams:list', () => Effect.sync(() => listTeamPresets()))

  typedHandle('teams:save', (_event, preset: WaggleTeamPreset) =>
    Effect.sync(() => saveTeamPreset(preset)),
  )

  typedHandle('teams:delete', (_event, id: TeamConfigId) => Effect.sync(() => deleteTeamPreset(id)))
}
