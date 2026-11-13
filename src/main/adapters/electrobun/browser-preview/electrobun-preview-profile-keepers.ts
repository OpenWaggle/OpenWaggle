import type { ElectrobunPreviewHost } from './electrobun-preview-record-factory'
import type { ElectrobunPreviewView } from './electrobun-preview-guest'

const KEEPER_URL = 'about:blank'

/**
 * `host`, keeping every partition a view opens loaded until the previews close at quit. A
 * partition's session, like Electron's, lives as long as the app: session cookies, the Incognito
 * profile's data and cookies a site set survive closing every preview of a profile. CEF keeps each
 * request context for the life of the process. WebView2 (Windows, vendor/electrobun patch 0013)
 * unloads a profile when its last view closes, so the first view of each partition gets a blank
 * view in the hidden maintenance window that holds the profile open.
 */
export function keepingPartitionsLoaded(host: ElectrobunPreviewHost) {
  const keepers = new Map<string, ElectrobunPreviewView>()
  const keep = (partition: string) => {
    if (!host.unloadsPartitionWithLastView || keepers.has(partition)) return
    keepers.set(
      partition,
      host.createView({ windowId: host.maintenanceWindowId(), url: KEEPER_URL, partition }),
    )
  }
  const keeping: ElectrobunPreviewHost = {
    ...host,
    createView: (options) => {
      keep(options.partition)
      return host.createView(options)
    },
  }
  return {
    host: keeping,
    release: () => {
      for (const view of keepers.values()) view.remove()
      keepers.clear()
    },
  }
}
