import type { ChangeRequestOpenDestination } from '@shared/types/git'
import { rendererQueryClient } from '@/queries/query-client'
import { changeRequestOpenDestinationQueryOptions } from '@/queries/source-control'
import { createRendererLogger } from '@/shared/lib/logger'
import { openWorkspaceWebLink } from '@/shell/open-workspace-web-link'

const logger = createRendererLogger('change-request')
const WEBSITE_FALLBACK: ChangeRequestOpenDestination = 'website'

interface OpenChangeRequestInput {
  readonly url: string
  readonly projectPath: string | null
  /** Session web-link owner, so the website opens wherever the user's links open. */
  readonly ownerKey: string
  /** Opens the Change request inspector; without one the website is the only destination. */
  readonly openInInspector: ((url: string) => void) | null
}

/**
 * Opens a change request at the effective Change request open destination, for surfaces that
 * open one request on demand rather than rendering rows (the Diff panel's quick action). It asks
 * the Session Host first. A Host that cannot answer cannot serve the inspector either (ADR 0048),
 * so it gets the provider website, as does a surface with no inspector.
 */
export async function openChangeRequestAtDestination(input: OpenChangeRequestInput) {
  const destination = await rendererQueryClient
    .query(changeRequestOpenDestinationQueryOptions(input.projectPath))
    .then(
      (resolution) => resolution.destination,
      (error: unknown) => {
        logger.warn('Could not read the change request open destination', {
          error: String(error),
        })
        return WEBSITE_FALLBACK
      },
    )
  if (destination === 'inspector' && input.openInInspector) {
    input.openInInspector(input.url)
    return
  }
  await openWorkspaceWebLink(input.ownerKey, input.url)
}
