import type { PreparedAttachment } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import type { OpenWaggleApi } from '@shared/types/openwaggle-api'
import type {
  SessionResource,
  SessionResourceCatalogPage,
  SessionResourceCatalogPageRequest,
  SessionResourceList,
} from '@shared/types/session-resource'
import { type InfiniteData, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type RenderResult, render } from '@testing-library/react'
import { type Mock, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { useUIStore } from '@/shell/ui-store'
import { sessionResourceCatalogQueryKey } from '../../hooks/useSessionResources'
import { SessionResourceViewer } from '../SessionResourceViewer'

type ListSessionResourcesMock = (
  sessionId: SessionId,
) => Promise<SessionResourceList | readonly SessionResource[]>

const viewerMocks = vi.hoisted(() => ({
  listSessionResources: vi.fn<ListSessionResourcesMock>(),
  listSessionResourcePage: vi.fn<OpenWaggleApi['listSessionResourcePage']>(),
  getSessionResource: vi.fn<OpenWaggleApi['getSessionResource']>(),
  locateSessionResourceImage: vi.fn<OpenWaggleApi['locateSessionResourceImage']>(),
  readSessionResource: vi.fn<OpenWaggleApi['readSessionResource']>(),
  retrySessionResource: vi.fn<OpenWaggleApi['retrySessionResource']>(),
  copySessionResourceImage: vi.fn<OpenWaggleApi['copySessionResourceImage']>(),
  discardPreparedAttachment: vi.fn<OpenWaggleApi['discardPreparedAttachment']>(),
  prepareSessionResourceAttachment: vi.fn<OpenWaggleApi['prepareSessionResourceAttachment']>(),
  openPath: vi.fn<OpenWaggleApi['openPath']>(),
  revealPath: vi.fn<OpenWaggleApi['revealPath']>(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    ...viewerMocks,
    openExternal: vi.fn(),
  },
}))

export const copySessionResourceImage: Mock<OpenWaggleApi['copySessionResourceImage']> =
  viewerMocks.copySessionResourceImage
export const discardPreparedAttachment: Mock<OpenWaggleApi['discardPreparedAttachment']> =
  viewerMocks.discardPreparedAttachment
export const getSessionResource: Mock<OpenWaggleApi['getSessionResource']> =
  viewerMocks.getSessionResource
export const listSessionResourcePage: Mock<OpenWaggleApi['listSessionResourcePage']> =
  viewerMocks.listSessionResourcePage
export const listSessionResources: Mock<ListSessionResourcesMock> = viewerMocks.listSessionResources
export const locateSessionResourceImage: Mock<OpenWaggleApi['locateSessionResourceImage']> =
  viewerMocks.locateSessionResourceImage
export const openPath: Mock<OpenWaggleApi['openPath']> = viewerMocks.openPath
export const prepareSessionResourceAttachment: Mock<
  OpenWaggleApi['prepareSessionResourceAttachment']
> = viewerMocks.prepareSessionResourceAttachment
export const readSessionResource: Mock<OpenWaggleApi['readSessionResource']> =
  viewerMocks.readSessionResource
export const retrySessionResource: Mock<OpenWaggleApi['retrySessionResource']> =
  viewerMocks.retrySessionResource
export const revealPath: Mock<OpenWaggleApi['revealPath']> = viewerMocks.revealPath

export const PREPARED_IMAGE: PreparedAttachment = {
  id: 'prepared-image',
  kind: 'image',
  name: 'first.png',
  path: '/registered/first.png',
  mimeType: 'image/png',
  sizeBytes: 10,
  extractedText: '',
}

export function image(
  id: string,
  title: string,
  nodeId: string | null = null,
  updatedAt = 1000,
): SessionResource {
  return {
    id,
    sessionId: SessionId('session-1'),
    canonicalKey: `sha256:${id}`,
    kind: 'image',
    title,
    mimeType: 'image/png',
    locator: `session-resource://${id}`,
    managed: true,
    available: true,
    isSource: true,
    isOutput: false,
    occurrences: nodeId
      ? [
          {
            id: `occurrence-${id}`,
            nodeId,
            branchId: null,
            actor: 'agent',
            activity: 'created',
            label: null,
            locator: `session-resource://${id}`,
            createdAt: 1000,
          },
        ]
      : [],
    createdAt: 1000,
    updatedAt,
  }
}

export function remoteImage(id: string, title: string): SessionResource {
  return {
    ...image(id, title),
    canonicalKey: `url:https://images.example/${id}.png`,
    mimeType: null,
    locator: `https://images.example/${id}.png`,
  }
}

export function httpImage(id: string, title: string): SessionResource {
  return {
    ...image(id, title),
    canonicalKey: `url:http://images.example/${id}.png`,
    mimeType: null,
    locator: `http://images.example/${id}.png`,
  }
}

function matchingImages(resources: readonly SessionResource[]) {
  return resources.filter(
    (resource) =>
      resource.kind === 'image' &&
      !resource.locator?.startsWith('http://') &&
      (resource.available || resource.locator?.startsWith('https://') === true),
  )
}

function listedResources(result: SessionResourceList | readonly SessionResource[]) {
  return 'resources' in result ? result.resources : result
}

export function resetViewerEnvironment() {
  useUIStore.setState({ resourceViewer: null })
  useComposerStore.getState().reset()
  listSessionResources
    .mockReset()
    .mockResolvedValue([image('image-1', 'first.png'), image('image-2', 'second.png')])
  listSessionResourcePage
    .mockReset()
    .mockImplementation(async (sessionId: SessionId, input: SessionResourceCatalogPageRequest) => {
      const all = listedResources(await listSessionResources(sessionId))
      const matching = matchingImages(all)
      const offset = input.cursor ? Number(input.cursor) : 0
      const resources = matching.slice(offset, offset + input.limit)
      const nextOffset = offset + resources.length
      return {
        resources,
        total: matching.length,
        nextCursor: nextOffset < matching.length ? String(nextOffset) : null,
        orderRevision: 'legacy',
      }
    })
  getSessionResource
    .mockReset()
    .mockImplementation(async (sessionId: SessionId, resourceId: string) => {
      const all = listedResources(await listSessionResources(sessionId))
      return matchingImages(all).find((resource) => resource.id === resourceId) ?? null
    })
  locateSessionResourceImage.mockReset().mockResolvedValue(null)
  readSessionResource
    .mockReset()
    .mockImplementation(async (_sessionId: SessionId, resourceId: string) => ({
      resourceId,
      fileName: `${resourceId}.png`,
      mimeType: 'image/png',
      url: `openwaggle-session-resource://content/${resourceId}/view`,
      downloadUrl: `openwaggle-session-resource://content/${resourceId}/download`,
    }))
  retrySessionResource.mockReset().mockResolvedValue(undefined)
  copySessionResourceImage.mockReset().mockResolvedValue(undefined)
  discardPreparedAttachment.mockReset().mockResolvedValue(undefined)
  prepareSessionResourceAttachment.mockReset().mockResolvedValue(PREPARED_IMAGE)
  openPath.mockReset().mockResolvedValue(undefined)
  revealPath.mockReset().mockResolvedValue(undefined)
}

export function replaceViewerCatalogResources(
  queryClient: QueryClient,
  resources: readonly SessionResource[],
) {
  const current = getViewerCatalog(queryClient)
  if (!current) throw new Error('Expected the Session image catalog to be loaded.')
  queryClient.setQueryData<InfiniteData<SessionResourceCatalogPage>>(
    sessionResourceCatalogQueryKey('session-1', 'images', null),
    {
      ...current,
      pages: current.pages.map((page, index) =>
        index === 0 ? { ...page, resources, total: resources.length } : page,
      ),
    },
  )
}

export function getViewerCatalog(queryClient: QueryClient) {
  return queryClient.getQueryData<InfiniteData<SessionResourceCatalogPage>>(
    sessionResourceCatalogQueryKey('session-1', 'images', null),
  )
}

interface ViewerRenderResult extends RenderResult {
  readonly queryClient: QueryClient
  readonly rerenderSession: (sessionId: string | null) => void
  readonly rerenderBranch: (branchId: string | null) => void
  readonly rerenderPath: (pathNodeIds: readonly string[]) => void
}

export function renderViewer(
  activeSessionId: string | null,
  activeMessageIds: ReadonlySet<string> = new Set(),
  activeBranchId: string | null = null,
  activePathNodeIds: readonly string[] = [],
): ViewerRenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionResourceViewer
        activeSessionId={activeSessionId}
        activeBranchId={activeBranchId}
        activeMessageIds={activeMessageIds}
        activePathNodeIds={activePathNodeIds}
      />
    </QueryClientProvider>,
  )
  return {
    ...view,
    queryClient,
    rerenderSession: (sessionId: string | null) =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <SessionResourceViewer
            activeSessionId={sessionId}
            activeBranchId={activeBranchId}
            activeMessageIds={activeMessageIds}
            activePathNodeIds={activePathNodeIds}
          />
        </QueryClientProvider>,
      ),
    rerenderBranch: (branchId: string | null) =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <SessionResourceViewer
            activeSessionId={activeSessionId}
            activeBranchId={branchId}
            activeMessageIds={activeMessageIds}
            activePathNodeIds={activePathNodeIds}
          />
        </QueryClientProvider>,
      ),
    rerenderPath: (pathNodeIds: readonly string[]) =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <SessionResourceViewer
            activeSessionId={activeSessionId}
            activeBranchId={activeBranchId}
            activeMessageIds={new Set(pathNodeIds)}
            activePathNodeIds={pathNodeIds}
          />
        </QueryClientProvider>,
      ),
  }
}
