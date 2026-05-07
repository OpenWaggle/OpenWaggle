/**
 * WagglePresetsRepository port — domain-owned interface for Waggle preset persistence.
 */
import type { WagglePresetId } from '@shared/types/brand'
import type { WagglePreset } from '@shared/types/waggle'
import { Context, type Effect } from 'effect'

export interface WagglePresetsRepositoryShape {
  readonly list: (projectPath?: string | null) => Effect.Effect<readonly WagglePreset[]>
  readonly save: (preset: WagglePreset, projectPath?: string | null) => Effect.Effect<WagglePreset>
  readonly delete: (id: WagglePresetId, projectPath?: string | null) => Effect.Effect<void>
}

export class WagglePresetsRepository extends Context.Tag('@openwaggle/WagglePresetsRepository')<
  WagglePresetsRepository,
  WagglePresetsRepositoryShape
>() {}
