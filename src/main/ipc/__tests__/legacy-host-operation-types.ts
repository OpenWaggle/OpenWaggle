import type { DocsDiscoveryView, DocsListInput } from '@shared/types/docs'
import type {
  ExtensionContributionRegistryView,
  ExtensionListContributionsInput,
} from '@shared/types/extensions'
import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import type { IpcInvokeArgs } from '@shared/types/ipc'
import type * as Effect from 'effect/Effect'
import type { IpcInvocation } from '../../ports/desktop-shell/ipc-transport'
import type { AppServices } from '../../runtime'

export interface LegacyHostOperationDependencies {
  readonly listDocs?: (
    input: DocsListInput,
  ) => Effect.Effect<DocsDiscoveryView, unknown, AppServices>
  readonly listExtensionContributionsView?: (
    input: ExtensionListContributionsInput,
  ) => Effect.Effect<ExtensionContributionRegistryView, unknown, AppServices>
}

export type LegacyHostOperation<C extends HostBackedGuiChannel> = (
  event: IpcInvocation,
  ...args: IpcInvokeArgs<C>
) => Effect.Effect<unknown, unknown, AppServices>

export type LegacyHostOperationTable = {
  readonly [C in HostBackedGuiChannel]?: LegacyHostOperation<C>
}
