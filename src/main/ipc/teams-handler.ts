import type { TeamConfigId } from '@shared/types/brand'
import type { WaggleTeamPreset } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { deleteTeamPreset, listTeamPresets, saveTeamPreset } from '../store/teams'
import { typedHandleEffect } from './typed-ipc'

export function registerTeamsHandlers(): void {
  typedHandleEffect('teams:list', () => Effect.sync(() => listTeamPresets()))

  typedHandleEffect('teams:save', (_event, preset: WaggleTeamPreset) =>
    Effect.sync(() => saveTeamPreset(preset)),
  )

  typedHandleEffect('teams:delete', (_event, id: TeamConfigId) =>
    Effect.sync(() => deleteTeamPreset(id)),
  )
}
