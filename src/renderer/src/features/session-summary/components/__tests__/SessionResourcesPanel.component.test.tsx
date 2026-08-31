import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { SessionResourcesPanel } from '../SessionResourcesPanel'

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  openExternal: vi.fn(),
  openPath: vi.fn(),
  read: vi.fn(),
  readThumbnail: vi.fn(),
  retry: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources: apiMocks.list,
    openExternal: apiMocks.openExternal,
    openPath: apiMocks.openPath,
    readSessionResource: apiMocks.read,
    readSessionResourceThumbnail: apiMocks.readThumbnail,
    retrySessionResource: apiMocks.retry,
  },
}))

function resource(
  id: string,
  input: Pick<SessionResource, 'kind' | 'title' | 'isSource' | 'isOutput' | 'locator'> &
    Partial<Pick<SessionResource, 'available'>>,
): SessionResource {
  return {
    id,
    sessionId: SessionId('session-one'),
    canonicalKey: `resource:${id}`,
    mimeType: input.kind === 'image' ? 'image/png' : null,
    available: input.available ?? true,
    occurrences: [],
    createdAt: 1,
    updatedAt: 1,
    ...input,
  }
}

const IMAGE = resource('image', {
  kind: 'image',
  title: 'reference.png',
  isSource: true,
  isOutput: false,
  locator: 'session-resource://image',
})
const LINK = resource('link', {
  kind: 'link',
  title: 'Documentation',
  isSource: true,
  isOutput: false,
  locator: 'https://example.com/docs',
})
const OUTPUT = resource('output', {
  kind: 'change-request',
  title: 'Created PR',
  isSource: false,
  isOutput: true,
  locator: 'https://github.com/openwaggle/openwaggle/pull/1',
})

describe('SessionResourcesPanel', () => {
  beforeEach(() => {
    useUIStore.setState({ resourceViewer: null })
    apiMocks.list.mockReset().mockResolvedValue([IMAGE, LINK, OUTPUT])
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
  })

  it('filters session sources, outputs, and images', async () => {
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)
    expect(await screen.findByText('reference.png')).toBeInTheDocument()
    expect(screen.getByText('Created PR')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Outputs' }))
    expect(screen.getByText('Created PR')).toBeInTheDocument()
    expect(screen.queryByText('reference.png')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Images' }))
    expect(screen.getByText('reference.png')).toBeInTheDocument()
    expect(screen.queryByText('Documentation')).toBeNull()
    await waitFor(() => {
      expect(apiMocks.readThumbnail).toHaveBeenCalledWith(SessionId('session-one'), 'image')
    })
    expect(apiMocks.read).not.toHaveBeenCalled()
  })

  it('retries a transient null thumbnail while the preview remains mounted', async () => {
    apiMocks.readThumbnail.mockResolvedValueOnce(null).mockResolvedValueOnce({
      resourceId: 'image',
      fileName: 'image-thumbnail.webp',
      mimeType: 'image/webp',
      dataBase64: 'cmVwYWlyZWQ=',
    })

    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    expect(await screen.findByText('reference.png')).toBeInTheDocument()
    await waitFor(() => expect(apiMocks.readThumbnail).toHaveBeenCalledTimes(2), {
      timeout: 2_500,
    })
    expect(screen.getByRole('img', { name: 'reference.png' })).toHaveAttribute(
      'src',
      'data:image/webp;base64,cmVwYWlyZWQ=',
    )
  })

  it('opens managed images in the current session viewer and links externally', async () => {
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)
    fireEvent.click(await screen.findByText('reference.png'))
    expect(useUIStore.getState().resourceViewer).toEqual({
      sessionId: 'session-one',
      resourceId: 'image',
    })

    fireEvent.click(screen.getByText('Documentation'))
    await waitFor(() => {
      expect(apiMocks.openExternal).toHaveBeenCalledWith('https://example.com/docs')
    })
  })

  it('opens the original path for an unavailable attachment', async () => {
    apiMocks.list.mockResolvedValue([
      resource('missing-image', {
        kind: 'image',
        title: 'missing.png',
        isSource: true,
        isOutput: false,
        locator: '/input/missing.png',
        available: false,
      }),
    ])
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    fireEvent.click(await screen.findByText('missing.png'))

    await waitFor(() => expect(apiMocks.openPath).toHaveBeenCalledWith('/input/missing.png'))
    expect(useUIStore.getState().resourceViewer).toBeNull()
    expect(screen.getByText('Unavailable · Open original')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry missing.png' }))
    await waitFor(() =>
      expect(apiMocks.retry).toHaveBeenCalledWith(SessionId('session-one'), 'missing-image'),
    )
    await waitFor(() => expect(apiMocks.list).toHaveBeenCalledTimes(2))
  })
})
