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

function image(id: string, title: string, nodeId: string | null = null): SessionResource {
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
    updatedAt: 1000,
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
    renderViewer('session-1')

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: second.png' }),
    ).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()
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

    await waitFor(() => expect(useUIStore.getState().resourceViewer).toBeNull())
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
