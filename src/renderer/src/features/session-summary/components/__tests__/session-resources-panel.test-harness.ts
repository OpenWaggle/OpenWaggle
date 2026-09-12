import { SessionId } from '@shared/types/brand'
import type { OpenWaggleApi } from '@shared/types/openwaggle-api'
import type {
  SessionResource,
  SessionResourceCatalogPageRequest,
  SessionResourceList,
} from '@shared/types/session-resource'
import { type Mock, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'

type ListSessionResources = (
  sessionId: SessionId,
) => Promise<SessionResourceList | readonly SessionResource[]>

interface SessionResourcesPanelApiMocks {
  readonly list: Mock<ListSessionResources>
  readonly listPage: Mock<OpenWaggleApi['listSessionResourcePage']>
  readonly get: Mock<OpenWaggleApi['getSessionResource']>
  readonly openExternal: Mock<OpenWaggleApi['openExternal']>
  readonly openPath: Mock<OpenWaggleApi['openPath']>
  readonly read: Mock<OpenWaggleApi['readSessionResource']>
  readonly readThumbnail: Mock<OpenWaggleApi['readSessionResourceThumbnail']>
  readonly retry: Mock<OpenWaggleApi['retrySessionResource']>
}

const panelMocks = vi.hoisted(() => ({
  list: vi.fn(),
  listPage: vi.fn(),
  get: vi.fn(),
  openExternal: vi.fn(),
  openPath: vi.fn(),
  read: vi.fn(),
  readThumbnail: vi.fn(),
  retry: vi.fn(),
}))

export const apiMocks: SessionResourcesPanelApiMocks = panelMocks

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources: panelMocks.list,
    listSessionResourcePage: panelMocks.listPage,
    getSessionResource: panelMocks.get,
    openExternal: panelMocks.openExternal,
    openPath: panelMocks.openPath,
    readSessionResource: panelMocks.read,
    readSessionResourceThumbnail: panelMocks.readThumbnail,
    retrySessionResource: panelMocks.retry,
  },
}))

export function resource(
  id: string,
  input: Pick<SessionResource, 'kind' | 'title' | 'isSource' | 'isOutput' | 'locator'> &
    Partial<Pick<SessionResource, 'available' | 'occurrences'>>,
): SessionResource {
  return {
    id,
    sessionId: SessionId('session-one'),
    canonicalKey: `resource:${id}`,
    mimeType: input.kind === 'image' ? 'image/png' : null,
    managed: input.locator?.startsWith('session-resource://') === true,
    available: input.available ?? true,
    occurrences: [],
    createdAt: 1,
    updatedAt: 1,
    ...input,
  }
}

export const IMAGE = resource('image', {
  kind: 'image',
  title: 'reference.png',
  isSource: true,
  isOutput: false,
  locator: 'session-resource://image',
})
export const LINK = resource('link', {
  kind: 'link',
  title: 'Documentation',
  isSource: true,
  isOutput: false,
  locator: 'https://example.com/docs',
})
export const OUTPUT = resource('output', {
  kind: 'change-request',
  title: 'Created PR',
  isSource: false,
  isOutput: true,
  locator: 'https://github.com/openwaggle/openwaggle/pull/1',
})

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
export const scrollIntoView: Mock<() => void> = vi.fn()

export function restoreSessionResourcesPanelEnvironment() {
  vi.useRealTimers()
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView,
    })
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
}

export function resetSessionResourcesPanelEnvironment() {
  scrollIntoView.mockReset()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  })
  useUIStore.setState({ resourceViewer: null })
  apiMocks.list.mockReset().mockResolvedValue([IMAGE, LINK, OUTPUT])
  apiMocks.listPage
    .mockReset()
    .mockImplementation(async (sessionId: SessionId, input: SessionResourceCatalogPageRequest) => {
      const all = await apiMocks.list(sessionId)
      const resources = 'resources' in all ? all.resources : all
      const matching = resources.filter((item) =>
        input.view === 'sources' ? item.isSource : input.view === 'outputs' ? item.isOutput : true,
      )
      const offset = input.cursor ? Number(input.cursor) : 0
      const page = matching.slice(offset, offset + input.limit)
      const nextOffset = offset + page.length
      return {
        resources: page,
        total: matching.length,
        nextCursor: nextOffset < matching.length ? String(nextOffset) : null,
        orderRevision: 'legacy',
      }
    })
  apiMocks.get.mockReset().mockImplementation(async (sessionId: SessionId, resourceId: string) => {
    const all = await apiMocks.list(sessionId)
    const resources = 'resources' in all ? all.resources : all
    return resources.find((item) => item.id === resourceId) ?? null
  })
  apiMocks.openExternal.mockReset().mockResolvedValue(undefined)
  apiMocks.openPath.mockReset().mockResolvedValue(undefined)
  apiMocks.read.mockReset().mockResolvedValue(null)
  apiMocks.retry.mockReset().mockResolvedValue(undefined)
  apiMocks.readThumbnail.mockReset().mockResolvedValue({
    resourceId: 'image',
    fileName: 'image-thumbnail.webp',
    mimeType: 'image/webp',
    dataBase64: 'dGh1bWJuYWls',
  })
}
