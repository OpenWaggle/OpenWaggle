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
  revealPath: vi.fn(),
  read: vi.fn(),
  readThumbnail: vi.fn(),
  retry: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources: apiMocks.list,
    openExternal: apiMocks.openExternal,
    openPath: apiMocks.openPath,
    revealPath: apiMocks.revealPath,
    readSessionResource: apiMocks.read,
    readSessionResourceThumbnail: apiMocks.readThumbnail,
    retrySessionResource: apiMocks.retry,
  },
}))

function resource(
  id: string,
  input: Pick<SessionResource, 'kind' | 'title' | 'isSource' | 'isOutput' | 'locator'> &
    Partial<Pick<SessionResource, 'available' | 'managed' | 'canonicalKey'>>,
): SessionResource {
  return {
    id,
    sessionId: SessionId('session-one'),
    canonicalKey: `resource:${id}`,
    mimeType: input.kind === 'image' ? 'image/png' : null,
    managed: input.managed ?? input.locator?.startsWith('session-resource://') === true,
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
    apiMocks.revealPath.mockReset().mockResolvedValue(undefined)
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

  it('opens directly on the requested summary filter', async () => {
    renderWithQueryClient(
      <SessionResourcesPanel sessionId="session-one" initialFilter="sources" onClose={vi.fn()} />,
    )

    expect(await screen.findByText('reference.png')).toBeInTheDocument()
    expect(screen.getByText('Documentation')).toBeInTheDocument()
    expect(screen.queryByText('Created PR')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sources' })).toHaveAttribute('aria-pressed', 'true')
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

  it('renders the managed thumbnail while retaining an HTTPS original locator', async () => {
    apiMocks.list.mockResolvedValue([
      resource('remote-managed', {
        kind: 'image',
        title: 'remote-managed.png',
        isSource: true,
        isOutput: false,
        locator: 'https://example.com/remote-managed.png',
        managed: true,
      }),
    ])
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    expect(await screen.findByRole('img', { name: 'remote-managed.png' })).toBeInTheDocument()
    expect(apiMocks.readThumbnail).toHaveBeenCalledWith(SessionId('session-one'), 'remote-managed')
  })

  it('bounds automatic retries for a permanently unavailable thumbnail', async () => {
    apiMocks.readThumbnail.mockResolvedValue(null)

    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    expect(await screen.findByText('reference.png')).toBeInTheDocument()
    await waitFor(() => expect(apiMocks.readThumbnail).toHaveBeenCalledTimes(3), {
      timeout: 3_500,
    })
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    expect(apiMocks.readThumbnail).toHaveBeenCalledTimes(3)
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

  it('opens non-materializable HTTP images externally', async () => {
    apiMocks.list.mockResolvedValue([
      resource('http-image', {
        kind: 'image',
        title: 'insecure-image.png',
        isSource: true,
        isOutput: false,
        locator: 'http://example.com/insecure-image.png',
      }),
    ])
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    fireEvent.click(await screen.findByText('insecure-image.png'))

    await waitFor(() =>
      expect(apiMocks.openExternal).toHaveBeenCalledWith('http://example.com/insecure-image.png'),
    )
    expect(useUIStore.getState().resourceViewer).toBeNull()
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
    expect(screen.getByText('Unavailable')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry missing.png' }))
    await waitFor(() =>
      expect(apiMocks.retry).toHaveBeenCalledWith(SessionId('session-one'), 'missing-image'),
    )
    await waitFor(() => expect(apiMocks.list).toHaveBeenCalledTimes(2))
  })

  it('disables an unavailable managed image with no usable original while retaining Retry', async () => {
    apiMocks.list.mockResolvedValue([
      resource('missing-managed-image', {
        kind: 'image',
        title: 'missing-managed.png',
        isSource: true,
        isOutput: false,
        locator: 'session-resource://missing-managed-image',
        available: false,
        managed: true,
      }),
    ])
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    const title = await screen.findByText('missing-managed.png')
    expect(title.closest('button')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry missing-managed.png' }))
    await waitFor(() =>
      expect(apiMocks.retry).toHaveBeenCalledWith(
        SessionId('session-one'),
        'missing-managed-image',
      ),
    )
    expect(useUIStore.getState().resourceViewer).toBeNull()
  })

  it('does not offer Retry for an unrecoverable generated image', async () => {
    apiMocks.list.mockResolvedValue([
      resource('invalid-generated-image', {
        kind: 'image',
        title: 'invalid-generated.png',
        isSource: false,
        isOutput: true,
        locator: null,
        available: false,
        canonicalKey: 'unavailable-image:session-one:node-one:0',
      }),
    ])
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    const title = await screen.findByText('invalid-generated.png')
    expect(title.closest('button')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Retry invalid-generated.png' })).toBeNull()
  })

  it('keeps open and reveal actions for the original path beside a managed copy', async () => {
    apiMocks.list.mockResolvedValue([
      resource('managed-local', {
        kind: 'image',
        title: 'managed-local.png',
        isSource: true,
        isOutput: false,
        locator: '/input/managed-local.png',
        managed: true,
      }),
    ])
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open original managed-local.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal original managed-local.png' }))

    expect(apiMocks.openPath).toHaveBeenCalledWith('/input/managed-local.png')
    expect(apiMocks.revealPath).toHaveBeenCalledWith('/input/managed-local.png')
    expect(screen.getByText('Managed copy · Original available')).toBeInTheDocument()
  })

  it('announces retry failure and suppresses concurrent resource retries', async () => {
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
    let rejectRetry: (cause: Error) => void = () => {}
    apiMocks.retry.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRetry = reject
      }),
    )
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)
    const retry = await screen.findByRole('button', { name: 'Retry missing.png' })

    fireEvent.click(retry)
    fireEvent.click(retry)
    await waitFor(() => expect(apiMocks.retry).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Retry missing.png' })).toBeDisabled()
    rejectRetry(new Error('Original is still missing'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Original is still missing')
  })

  it('distinguishes catalog failures from an empty session and retries', async () => {
    apiMocks.list.mockRejectedValueOnce(new Error('database unavailable'))
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load session resources')
    expect(screen.queryByText('No resources in this view.')).toBeNull()
    apiMocks.list.mockResolvedValueOnce([IMAGE])
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('reference.png')).toBeInTheDocument()
  })
})
