import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { ExtensionFederatedModuleHost } from '@/features/extensions'

export function SettingsContributionRuntimeBody({
  entry,
}: {
  readonly entry: ExtensionContributionRegistryEntry
}) {
  return <ExtensionFederatedModuleHost className="min-h-[420px]" entry={entry} />
}
