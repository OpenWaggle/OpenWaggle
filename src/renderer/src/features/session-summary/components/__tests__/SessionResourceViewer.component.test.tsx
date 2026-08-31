import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { SessionResourceViewer } from '../SessionResourceViewer'

const listSessionResources = vi.hoisted(() => vi.fn())
const readSessionResource = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources,
    readSessionResource,
    openExternal: vi.fn(),
  },
}))

function image(
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
            createdAt: 1000,
          },
        ]
      : [],
    createdAt: 1000,
    updatedAt,
  }
}

function remoteImage(id: string, title: string): SessionResource {
  return {
    ...image(id, title),
    canonicalKey: `url:https://images.example/${id}.png`,
    mimeType: null,
    locator: `https://images.example/${id}.png`,
  }
}

function httpImage(id: string, title: string): SessionResource {
  return {
    ...image(id, title),
    canonicalKey: `url:http://images.example/${id}.png`,
    mimeType: null,
    locator: `http://images.example/${id}.png`,
  }
}

function renderViewer(
  activeSessionId: string | null,
  activeMessageIds: ReadonlySet<string> = new Set(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionResourceViewer
        activeSessionId={activeSessionId}
        activeMessageIds={activeMessageIds}
      />
    </QueryClientProvider>,
  )
  return {
    ...view,
    queryClient,
    rerenderSession: (sessionId: string | null) =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <SessionResourceViewer activeSessionId={sessionId} activeMessageIds={activeMessageIds} />
        </QueryClientProvider>,
      ),
  }
}

describe('SessionResourceViewer', () => {
  beforeEach(() => {
    useUIStore.setState({ resourceViewer: null })
    listSessionResources
      .mockReset()
      .mockResolvedValue([image('image-1', 'first.png'), image('image-2', 'second.png')])
    readSessionResource.mockReset().mockImplementation(async (_sessionId, resourceId: string) => ({
      resourceId,
      fileName: `${resourceId}.png`,
      mimeType: 'image/png',
      dataBase64: resourceId === 'image-1' ? 'aW1hZ2UtMQ==' : 'aW1hZ2UtMg==',
    }))
  })

  it('enlarges a session image and navigates the session gallery', async () => {
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    const view = renderViewer('session-1')

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: second.png' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(
        view.queryClient.getQueryData(['session-resource-content', 'session-1', 'image-1', 1000]),
      ).toBeUndefined()
    })

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()
  })

  it('navigates chronologically within the same transcript-path group', async () => {
    listSessionResources.mockResolvedValue([
      image('image-new', 'new.png', null, 2000),
      image('image-old', 'old.png', null, 1000),
    ])
    useUIStore.getState().openResourceViewer('session-1', 'image-old')
    renderViewer('session-1')

    expect(await screen.findByRole('dialog', { name: 'Image viewer: old.png' })).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(await screen.findByRole('dialog', { name: 'Image viewer: new.png' })).toBeInTheDocument()
  })

  it('skips unavailable managed images during gallery navigation', async () => {
    listSessionResources.mockResolvedValue([
      image('image-1', 'first.png'),
      { ...image('missing-image', 'missing.png'), available: false },
      image('image-2', 'second.png'),
    ])
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: second.png' }),
    ).toBeInTheDocument()
  })

  it('skips HTTP-only images during gallery navigation', async () => {
    listSessionResources.mockResolvedValue([
      image('image-1', 'first.png'),
      httpImage('http-image', 'http.png'),
      image('image-2', 'second.png'),
    ])
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: second.png' }),
    ).toBeInTheDocument()
  })

  it('requests remote image content only after the user opens the viewer', async () => {
    listSessionResources
      .mockResolvedValueOnce([remoteImage('remote-image', 'Remote image')])
      .mockResolvedValue([image('remote-image', 'Remote image')])
    useUIStore.getState().openResourceViewer('session-1', 'remote-image')
    renderViewer('session-1')

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: Remote image' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(readSessionResource).toHaveBeenCalledWith(SessionId('session-1'), 'remote-image'),
    )
    await waitFor(() => expect(listSessionResources).toHaveBeenCalledTimes(2))
  })

  it('retries a null content read when the resource revision changes', async () => {
    readSessionResource.mockReset().mockResolvedValueOnce(null).mockResolvedValue({
      resourceId: 'image-1',
      fileName: 'image-1.png',
      mimeType: 'image/png',
      dataBase64: 'aW1hZ2UtMQ==',
    })
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    const view = renderViewer('session-1')
    await screen.findByRole('dialog', { name: 'Image viewer: first.png' })
    await waitFor(() => expect(readSessionResource).toHaveBeenCalledOnce())

    view.queryClient.setQueryData(['session-resources', 'session-1'], {
      resources: [{ ...image('image-1', 'first.png'), updatedAt: 2000 }],
      backfillComplete: true,
    })

    await waitFor(() => expect(readSessionResource).toHaveBeenCalledTimes(2))
  })

  it('supports Codex-style zoom choices and downloading managed images', async () => {
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')

    const renderedImage = await screen.findByRole('img', { name: 'first.png' })
    Object.defineProperty(renderedImage, 'naturalWidth', { configurable: true, value: 800 })
    Object.defineProperty(renderedImage, 'naturalHeight', { configurable: true, value: 600 })
    fireEvent.load(renderedImage)
    fireEvent.change(screen.getByRole('combobox', { name: 'Image zoom' }), {
      target: { value: '150' },
    })
    expect(renderedImage).toHaveStyle({ width: '1200px', height: '900px' })
    expect(screen.getByRole('button', { name: 'Download image' })).toBeInTheDocument()
  })

  it('supports drag-to-pan for a zoomed image without changing the selected resource', async () => {
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')

    const renderedImage = await screen.findByRole('img', { name: 'first.png' })
    Object.defineProperty(renderedImage, 'naturalWidth', { configurable: true, value: 1200 })
    Object.defineProperty(renderedImage, 'naturalHeight', { configurable: true, value: 900 })
    fireEvent.load(renderedImage)
    fireEvent.change(screen.getByRole('combobox', { name: 'Image zoom' }), {
      target: { value: '200' },
    })
    const canvas = screen.getByLabelText('Image canvas')
    canvas.scrollLeft = 100
    canvas.scrollTop = 80
    fireEvent.pointerDown(renderedImage, { pointerId: 7, clientX: 200, clientY: 150 })
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 140, clientY: 110 })
    fireEvent.pointerUp(canvas, { pointerId: 7, clientX: 140, clientY: 110 })

    expect(canvas.scrollLeft).toBe(160)
    expect(canvas.scrollTop).toBe(120)
    expect(useUIStore.getState().resourceViewer).toEqual({
      sessionId: 'session-1',
      resourceId: 'image-1',
    })
  })

  it('places images from the active transcript path before images from other branches', async () => {
    listSessionResources.mockResolvedValue([
      image('image-2', 'other-branch.png', 'hidden-message'),
      image('image-1', 'active-branch.png', 'active-message'),
    ])
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1', new Set(['active-message']))

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: active-branch.png' }),
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
  })

  it('closes immediately when the user opens a different session', async () => {
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    const view = renderViewer('session-1')
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()

    view.rerenderSession('session-2')

    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(useUIStore.getState().resourceViewer).toBeNull())
  })
})
