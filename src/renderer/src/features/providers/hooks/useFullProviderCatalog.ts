import { useEffect } from 'react'
import { useProviderStore } from '../state/provider-store'

/**
 * Loads every provider's full model list while the caller is mounted. Startup loads only the
 * models that can run now (renderer-load B14); Settings lists the rest to enable or connect.
 */
export function useFullProviderCatalog() {
  const ensureFullProviderCatalog = useProviderStore((state) => state.ensureFullProviderCatalog)
  useEffect(() => {
    void ensureFullProviderCatalog()
  }, [ensureFullProviderCatalog])
}
