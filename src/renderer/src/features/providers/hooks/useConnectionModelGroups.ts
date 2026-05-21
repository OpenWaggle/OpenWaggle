import type { ModelGroup } from '@/features/providers/model'
import { useProviders } from '@/features/settings/hooks'

/**
 * Fetches Pi's full provider/model catalog and assembles it into display-ready groups.
 */
export function useConnectionModelGroups(): readonly ModelGroup[] {
  const { providerModels } = useProviders()
  return providerModels.map((providerGroup) => ({
    key: providerGroup.provider,
    label: providerGroup.displayName,
    provider: providerGroup.provider,
    models: providerGroup.models,
  }))
}
