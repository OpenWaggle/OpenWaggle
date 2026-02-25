import type { TeamConfigId } from '@shared/types/brand'
import type { TeamPreset } from '@shared/types/multi-agent'
import { deleteTeamPreset, listTeamPresets, saveTeamPreset } from '../store/teams'
import { typedHandle } from './typed-ipc'

export function registerTeamsHandlers(): void {
  typedHandle('teams:list', () => {
    return listTeamPresets()
  })

  typedHandle('teams:save', (_event, preset: TeamPreset) => {
    return saveTeamPreset(preset)
  })

  typedHandle('teams:delete', (_event, id: TeamConfigId) => {
    deleteTeamPreset(id)
  })
}
