import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { ExtensionFederatedModuleHost } from '@/features/extensions/components'

export function SettingsContributionRuntimeBody({
  entry,
}: {
  readonly entry: ExtensionContributionRegistryEntry
}) {
  return <ExtensionFederatedModuleHost className="min-h-105" entry={entry} />
}
