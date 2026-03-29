/**
 * TeamsRepository port — domain-owned interface for team preset persistence.
 */
import type { TeamConfigId } from '@shared/types/brand'
import type { WaggleTeamPreset } from '@shared/types/waggle'
import { Context, type Effect } from 'effect'

export interface TeamsRepositoryShape {
  readonly list: () => Effect.Effect<readonly WaggleTeamPreset[]>
  readonly save: (preset: WaggleTeamPreset) => Effect.Effect<void>
  readonly delete: (id: TeamConfigId) => Effect.Effect<void>
}

export class TeamsRepository extends Context.Tag('@openwaggle/TeamsRepository')<
  TeamsRepository,
  TeamsRepositoryShape
>() {}
