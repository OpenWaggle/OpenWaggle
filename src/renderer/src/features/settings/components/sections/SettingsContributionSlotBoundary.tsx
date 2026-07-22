import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import type { ReactNode } from 'react'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'

export function SettingsContributionSlotBoundary({
  entry,
  children,
}: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly children: ReactNode
}) {
  return (
    <PanelErrorBoundary name={`Extension settings: ${entry.title}`}>{children}</PanelErrorBoundary>
  )
}
