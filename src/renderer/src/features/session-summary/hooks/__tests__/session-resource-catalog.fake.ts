import type { SessionId } from '@shared/types/brand'
import type {
  SessionResource,
  SessionResourceCatalogPageRequest,
  SessionResourceCatalogView,
  SessionResourceList,
  SessionResourceNodePageRequest,
} from '@shared/types/session-resource'

type ListedResources = SessionResourceList | readonly SessionResource[]
type ListSessionResources = (sessionId: SessionId) => Promise<ListedResources>

const ORDER_REVISION = 'fake'

function listed(result: ListedResources) {
  return 'resources' in result ? result.resources : result
}

function inView(resource: SessionResource, view: SessionResourceCatalogView) {
  if (view === 'sources') return resource.isSource
  if (view === 'outputs') return resource.isOutput
  if (view === 'change-requests') return resource.kind === 'change-request' && resource.isOutput
  if (view === 'images') {
    if (resource.kind !== 'image' || resource.locator?.startsWith('http://')) return false
    return resource.available || resource.locator?.startsWith('https://') === true
  }
  return true
}

function page(
  matching: readonly SessionResource[],
  cursor: string | null | undefined,
  limit: number,
) {
  const offset = cursor ? Number(cursor) : 0
  const resources = matching.slice(offset, offset + limit)
  const nextOffset = offset + resources.length
  return {
    resources,
    total: matching.length,
    nextCursor: nextOffset < matching.length ? String(nextOffset) : null,
    orderRevision: ORDER_REVISION,
  }
}

/**
 * The Host's Session resource catalog reads, answered from the whole list `list` returns: views
 * filter as the Host does, pages cut by offset, and route selections are ignored. Tests keep one
 * data source, `listSessionResources`, and the renderer reads through the contract's paged calls.
 */
export function sessionResourceCatalogOver(list: ListSessionResources) {
  async function resourcesIn(sessionId: SessionId, view: SessionResourceCatalogView) {
    return listed(await list(sessionId)).filter((resource) => inView(resource, view))
  }
  return {
    listSessionResourcePage: async (
      sessionId: SessionId,
      input: SessionResourceCatalogPageRequest,
    ) => page(await resourcesIn(sessionId, input.view), input.cursor, input.limit),
    getSessionResource: async (
      sessionId: SessionId,
      resourceId: string,
      view: SessionResourceCatalogView,
    ) => (await resourcesIn(sessionId, view)).find(({ id }) => id === resourceId) ?? null,
    locateSessionResourceImage: async (sessionId: SessionId, resourceId: string) => {
      const images = await resourcesIn(sessionId, 'images')
      const index = images.findIndex(({ id }) => id === resourceId)
      const resource = images[index]
      if (!resource) return null
      return {
        resource,
        previous: images[index - 1] ?? null,
        next: images[index + 1] ?? null,
        index,
        total: images.length,
        orderRevision: ORDER_REVISION,
      }
    },
    listSessionResourceNodePage: async (
      sessionId: SessionId,
      input: SessionResourceNodePageRequest,
    ) => {
      const nodeIds = new Set(input.nodeIds)
      const matching = (await resourcesIn(sessionId, 'images')).filter((resource) =>
        resource.occurrences.some(({ nodeId }) => nodeId !== null && nodeIds.has(nodeId)),
      )
      return page(matching, input.cursor, input.limit)
    },
  }
}
