import type { DesktopOwnerRecord } from '@shared/types/desktop-owner'
import { Context, type Effect } from 'effect'

export interface DesktopOwnerRepositoryShape {
  readonly get: () => Effect.Effect<DesktopOwnerRecord | null, Error>
  readonly activate: (owner: Omit<DesktopOwnerRecord, 'state'>) => Effect.Effect<void, Error>
  readonly markClosed: (guiInstanceId: string, hostInstanceId: string) => Effect.Effect<void, Error>
}

export class DesktopOwnerRepository extends Context.Tag('@openwaggle/DesktopOwnerRepository')<
  DesktopOwnerRepository,
  DesktopOwnerRepositoryShape
>() {}
