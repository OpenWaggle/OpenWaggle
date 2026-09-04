import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { image, renderViewer } from './session-resource-viewer.test-harness'

const listSessionResources = vi.hoisted(() => vi.fn())
const readSessionResource = vi.hoisted(() => vi.fn())
let notifyResize: (() => void) | undefined

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    notifyResize = () => callback([], this)
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources,
    readSessionResource,
    openExternal: vi.fn(),
    openPath: vi.fn(),
    revealPath: vi.fn(),
    retrySessionResource: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('SessionResourceViewer parity', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    notifyResize = undefined
    useUIStore.setState({ resourceViewer: null })
    listSessionResources
      .mockReset()
      .mockResolvedValue([image('image-1', 'first.png'), image('image-2', 'second.png')])
    readSessionResource.mockReset().mockImplementation(async (_sessionId, resourceId: string) => ({
      resourceId,
      fileName: `${resourceId}.png`,
      mimeType: 'image/png',
      dataBase64: 'aW1hZ2U=',
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps gallery navigation visible and usable while image content is loading', async () => {
    readSessionResource.mockReturnValue(new Promise(() => {}))
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')

    expect(await screen.findByText('Loading image…')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Image zoom' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous image' })).toBeDisabled()
    const next = screen.getByRole('button', { name: 'Next image' })
    expect(next).toBeVisible()
    expect(next).toBeEnabled()

    fireEvent.click(next)

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: second.png' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Loading image…')).toBeVisible()
    const previous = screen.getByRole('button', { name: 'Previous image' })
    expect(previous).toBeVisible()
    expect(previous).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next image' })).toBeDisabled()

    fireEvent.click(previous)
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()
  })

  it('keeps gallery navigation visible and usable when image content is unavailable', async () => {
    readSessionResource.mockRejectedValue(new Error('Managed copy unavailable'))
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')

    expect(await screen.findByRole('button', { name: 'Retry image' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Image zoom' })).toBeDisabled()
    const next = screen.getByRole('button', { name: 'Next image' })
    expect(next).toBeVisible()
    expect(next).toBeEnabled()

    fireEvent.click(next)

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: second.png' }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Retry image' })).toBeVisible()
    const previous = screen.getByRole('button', { name: 'Previous image' })
    expect(previous).toBeVisible()
    expect(previous).toBeEnabled()

    fireEvent.click(previous)
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()
  })

  it('keeps the same image point at the viewport center when zooming', async () => {
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')

    const renderedImage = await screen.findByRole('img', { name: 'first.png' })
    Object.defineProperty(renderedImage, 'naturalWidth', { configurable: true, value: 800 })
    Object.defineProperty(renderedImage, 'naturalHeight', { configurable: true, value: 600 })
    fireEvent.load(renderedImage)
    const zoom = screen.getByRole('combobox', { name: 'Image zoom' })
    const canvas = screen.getByLabelText('Image canvas')
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(canvas, 'scrollWidth', {
      configurable: true,
      get: () => (renderedImage.style.width === '1600px' ? 1600 : 800),
    })
    Object.defineProperty(canvas, 'scrollHeight', {
      configurable: true,
      get: () => (renderedImage.style.height === '1200px' ? 1200 : 600),
    })
    fireEvent.change(zoom, { target: { value: '100' } })

    expect(canvas.scrollLeft).toBe(200)
    expect(canvas.scrollTop).toBe(150)
    canvas.scrollLeft = 200
    canvas.scrollTop = 150

    fireEvent.change(zoom, { target: { value: '200' } })

    expect(renderedImage).toHaveStyle({ width: '1600px', height: '1200px' })
    expect(canvas.scrollLeft).toBe(600)
    expect(canvas.scrollTop).toBe(450)
    expect(canvas.scrollWidth - canvas.clientWidth - canvas.scrollLeft).toBe(600)
    expect(canvas.scrollHeight - canvas.clientHeight - canvas.scrollTop).toBe(450)
  })

  it('recenters after delayed intrinsic image dimensions change the zoomed layout', async () => {
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')

    const renderedImage = await screen.findByRole('img', { name: 'first.png' })
    const zoom = screen.getByRole('combobox', { name: 'Image zoom' })
    const canvas = screen.getByLabelText('Image canvas')
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(canvas, 'scrollWidth', {
      configurable: true,
      get: () => (renderedImage.style.width === '1200px' ? 1200 : 800),
    })
    Object.defineProperty(canvas, 'scrollHeight', {
      configurable: true,
      get: () => (renderedImage.style.height === '900px' ? 900 : 600),
    })

    fireEvent.change(zoom, { target: { value: '150' } })
    Object.defineProperty(renderedImage, 'naturalWidth', { configurable: true, value: 800 })
    Object.defineProperty(renderedImage, 'naturalHeight', { configurable: true, value: 600 })
    fireEvent.load(renderedImage)
    await waitFor(() => expect(renderedImage).toHaveStyle({ width: '1200px', height: '900px' }))
    notifyResize?.()

    expect(canvas.scrollLeft).toBe(400)
    expect(canvas.scrollTop).toBe(300)
  })
})
