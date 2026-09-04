import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { SessionResourceViewer } from '../SessionResourceViewer'

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  openExternal: vi.fn(),
  openPath: vi.fn(),
  revealPath: vi.fn(),
  read: vi.fn(),
  retry: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources: apiMocks.list,
    openExternal: apiMocks.openExternal,
    openPath: apiMocks.openPath,
    revealPath: apiMocks.revealPath,
    readSessionResource: apiMocks.read,
    retrySessionResource: apiMocks.retry,
  },
}))

function image(
  id = 'image-1',
  title = 'first.png',
  locator = `session-resource://${id}`,
): SessionResource {
  return {
    id,
    sessionId: SessionId('session-1'),
    canonicalKey: `resource:${id}`,
    kind: 'image',
    title,
    mimeType: 'image/png',
    locator,
    available: true,
    isSource: true,
    isOutput: false,
    occurrences: [],
    createdAt: 1000,
    updatedAt: 1000,
  }
}

function renderViewer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionResourceViewer activeSessionId="session-1" />
    </QueryClientProvider>,
  )
}

describe('SessionResourceViewer recovery and source actions', () => {
  beforeEach(() => {
    useUIStore.setState({ resourceViewer: null })
    apiMocks.list.mockReset().mockResolvedValue([image()])
    apiMocks.read.mockReset().mockResolvedValue({
      resourceId: 'image-1',
      fileName: 'image-1.png',
      mimeType: 'image/png',
      dataBase64: 'aW1hZ2UtMQ==',
    })
    apiMocks.openExternal.mockReset().mockResolvedValue(undefined)
    apiMocks.openPath.mockReset().mockResolvedValue(undefined)
    apiMocks.revealPath.mockReset().mockResolvedValue(undefined)
    apiMocks.retry.mockReset().mockResolvedValue(image())
  })

  it('does not steal arrow keys from controls inside the viewer', async () => {
    apiMocks.list.mockResolvedValue([image(), image('image-2', 'second.png')])
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer()

    await screen.findByRole('dialog', { name: 'Image viewer: first.png' })
    const zoom = screen.getByRole('combobox', { name: 'Image zoom' })
    zoom.focus()
    fireEvent.keyDown(zoom, { key: 'ArrowRight' })

    expect(useUIStore.getState().resourceViewer?.resourceId).toBe('image-1')
  })

  it('shows a recoverable error when full image content cannot be loaded', async () => {
    apiMocks.read
      .mockReset()
      .mockRejectedValueOnce(new Error('managed image missing'))
      .mockResolvedValue({
        resourceId: 'image-1',
        fileName: 'image-1.png',
        mimeType: 'image/png',
        dataBase64: 'aW1hZ2UtMQ==',
      })
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer()

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load this image.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry image' }))

    expect(await screen.findByRole('img', { name: 'first.png' })).toBeInTheDocument()
    expect(apiMocks.retry).toHaveBeenCalledWith(SessionId('session-1'), 'image-1')
    expect(apiMocks.read).toHaveBeenCalledTimes(2)
  })

  it('retries a failed catalog with the viewer session id', async () => {
    apiMocks.list
      .mockReset()
      .mockRejectedValueOnce(new Error('catalog unavailable'))
      .mockResolvedValue([image()])
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t load this session’s images.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading session images' }))

    expect(await screen.findByRole('img', { name: 'first.png' })).toBeInTheDocument()
    expect(apiMocks.list).toHaveBeenNthCalledWith(1, SessionId('session-1'))
    expect(apiMocks.list).toHaveBeenNthCalledWith(2, SessionId('session-1'))
  })

  it('keeps the remote source action after managed content loads', async () => {
    apiMocks.list.mockResolvedValue([
      image('remote-image', 'Remote image', 'https://images.example/remote-image.png'),
    ])
    useUIStore.getState().openResourceViewer('session-1', 'remote-image')
    renderViewer()

    expect(await screen.findByRole('img', { name: 'Remote image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download image' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open image source' }))

    expect(apiMocks.openExternal).toHaveBeenCalledWith('https://images.example/remote-image.png')
  })

  it('opens or reveals the original local image without intercepting its path', async () => {
    apiMocks.list.mockResolvedValue([image('local-image', 'Local image', '/tmp/local-image.png')])
    useUIStore.getState().openResourceViewer('session-1', 'local-image')
    renderViewer()

    expect(await screen.findByRole('img', { name: 'Local image' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open original Local image' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal original Local image' }))

    expect(apiMocks.openPath).toHaveBeenCalledWith('/tmp/local-image.png')
    expect(apiMocks.revealPath).toHaveBeenCalledWith('/tmp/local-image.png')
  })
})
