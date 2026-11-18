import type { DesktopFenceRecord } from '@shared/types/desktop-service'
import { Context, type Effect } from 'effect'

export interface DesktopFenceRepositoryShape {
  readonly getAll: () => Effect.Effect<readonly DesktopFenceRecord[], Error>
  readonly insert: (
    record: DesktopFenceRecord & { readonly state: 'active' },
  ) => Effect.Effect<void, Error>
  readonly markReleased: (token: string, hostInstanceId: string) => Effect.Effect<void, Error>
  readonly removeReleased: (token: string, hostInstanceId: string) => Effect.Effect<void, Error>
}

export class DesktopFenceRepository extends Context.Tag('@openwaggle/DesktopFenceRepository')<
  DesktopFenceRepository,
  DesktopFenceRepositoryShape
>() {}
