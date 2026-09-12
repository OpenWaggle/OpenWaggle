import { ATTACHMENT } from '@shared/constants/resource-limits'
import type { PreparedAttachment } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { useUIStore } from '@/shell/ui-store'
import {
  copySessionResourceImage,
  discardPreparedAttachment,
  PREPARED_IMAGE,
  prepareSessionResourceAttachment,
  readSessionResource,
  renderViewer,
  resetViewerEnvironment,
  retrySessionResource,
} from './session-resource-viewer.test-harness'

describe('SessionResourceViewer', () => {
  beforeEach(resetViewerEnvironment)

  it('shows an explicit loading state while managed image content is pending', async () => {
    readSessionResource.mockReturnValue(new Promise(() => {}))
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')

    expect(await screen.findByText('Loading image…')).toBeVisible()
    expect(screen.queryByText('This image is available at its source.')).toBeNull()
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

  it('supports zoom buttons, fit reset, and modifier-wheel pinch zoom', async () => {
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')

    const renderedImage = await screen.findByRole('img', { name: 'first.png' })
    Object.defineProperty(renderedImage, 'naturalWidth', { configurable: true, value: 800 })
    Object.defineProperty(renderedImage, 'naturalHeight', { configurable: true, value: 600 })
    fireEvent.load(renderedImage)
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
    fireEvent.wheel(screen.getByLabelText('Image canvas'), { ctrlKey: true, deltaY: 1 })
    expect(screen.getByRole('combobox', { name: 'Image zoom' })).toHaveValue('fit')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByRole('combobox', { name: 'Image zoom' })).toHaveValue('100')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByRole('combobox', { name: 'Image zoom' })).toHaveValue('150')

    fireEvent.wheel(screen.getByLabelText('Image canvas'), { ctrlKey: true, deltaY: 1 })
    expect(screen.getByRole('combobox', { name: 'Image zoom' })).toHaveValue('100')
    fireEvent.click(screen.getByRole('button', { name: 'Fit image' }))
    expect(screen.getByRole('combobox', { name: 'Image zoom' })).toHaveValue('fit')
  })

  it('cancels native modifier-wheel gestures while leaving ordinary scrolling available', async () => {
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')
    await screen.findByRole('img', { name: 'first.png' })
    const canvas = screen.getByLabelText('Image canvas')
    const pinch = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -1,
    })

    fireEvent(canvas, pinch)

    expect(pinch.defaultPrevented).toBe(true)
    expect(screen.getByRole('combobox', { name: 'Image zoom' })).toHaveValue('100')
    const scroll = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 1 })
    fireEvent(canvas, scroll)
    expect(scroll.defaultPrevented).toBe(false)
    expect(screen.getByRole('combobox', { name: 'Image zoom' })).toHaveValue('100')

    const metaPinch = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      deltaY: -1,
    })
    fireEvent(canvas, metaPinch)
    expect(metaPinch.defaultPrevented).toBe(true)
    expect(screen.getByRole('combobox', { name: 'Image zoom' })).toHaveValue('150')

    fireEvent.click(screen.getByRole('button', { name: 'Close image viewer' }))
    const afterClosing = new WheelEvent('wheel', {
      cancelable: true,
      ctrlKey: true,
      deltaY: -1,
    })
    fireEvent(canvas, afterClosing)
    expect(afterClosing.defaultPrevented).toBe(false)
  })

  it('copies and adds the owning session image through secure resource actions', async () => {
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')
    await screen.findByRole('img', { name: 'first.png' })

    fireEvent.click(screen.getByRole('button', { name: 'Copy image' }))
    await waitFor(() =>
      expect(copySessionResourceImage).toHaveBeenCalledWith(SessionId('session-1'), 'image-1'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add image to chat' }))
    await waitFor(() => expect(useComposerStore.getState().attachments).toEqual([PREPARED_IMAGE]))
    expect(prepareSessionResourceAttachment).toHaveBeenCalledWith(SessionId('session-1'), 'image-1')
  })

  it('does not exceed the composer attachment cap', async () => {
    useComposerStore.getState().replaceAttachments(
      Array.from({ length: 5 }, (_, index) => ({
        ...PREPARED_IMAGE,
        id: `prepared-${String(index)}`,
      })),
    )
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')
    await screen.findByRole('img', { name: 'first.png' })

    fireEvent.click(screen.getByRole('button', { name: 'Add image to chat' }))

    expect(prepareSessionResourceAttachment).not.toHaveBeenCalled()
    expect(useComposerStore.getState().attachments).toHaveLength(5)
  })

  it('does not exceed the composer aggregate attachment-size cap', async () => {
    useComposerStore.getState().replaceAttachments([
      {
        ...PREPARED_IMAGE,
        id: 'large-existing-attachment',
        sizeBytes: ATTACHMENT.MAX_TOTAL_SIZE_BYTES - 5,
      },
    ])
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')
    await screen.findByRole('img', { name: 'first.png' })

    fireEvent.click(screen.getByRole('button', { name: 'Add image to chat' }))

    await waitFor(() => expect(prepareSessionResourceAttachment).toHaveBeenCalledOnce())
    await waitFor(() => expect(discardPreparedAttachment).toHaveBeenCalledWith(PREPARED_IMAGE))
    expect(useComposerStore.getState().attachments).toHaveLength(1)
    expect(useComposerStore.getState().attachments[0]?.id).toBe('large-existing-attachment')
  })

  it('does not navigate while arrow keys operate the zoom control', async () => {
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')
    await screen.findByRole('dialog', { name: 'Image viewer: first.png' })
    const zoom = screen.getByRole('combobox', { name: 'Image zoom' })

    zoom.focus()
    fireEvent.keyDown(zoom, { key: 'ArrowRight' })

    expect(screen.getByRole('dialog', { name: 'Image viewer: first.png' })).toBeInTheDocument()
  })

  it('announces retry failure and suppresses concurrent image retries', async () => {
    readSessionResource.mockReset().mockRejectedValue(new Error('Managed copy unavailable'))
    let rejectRetry: (cause: Error) => void = () => {}
    retrySessionResource.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRetry = reject
      }),
    )
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')
    const retry = await screen.findByRole('button', { name: 'Retry image' })

    retry.focus()
    fireEvent.click(retry)
    fireEvent.click(retry)
    await waitFor(() => expect(retrySessionResource).toHaveBeenCalledOnce())
    const retrying = screen.getByRole('button', { name: 'Retrying image…' })
    expect(retrying).toBe(retry)
    expect(retrying).toHaveFocus()
    expect(retrying).toBeEnabled()
    expect(retrying).toHaveAttribute('aria-disabled', 'true')
    rejectRetry(new Error('Still unavailable'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Still unavailable')
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

  it('does not add a prepared image after the viewer changes sessions', async () => {
    const pending = Promise.withResolvers<PreparedAttachment>()
    prepareSessionResourceAttachment.mockReturnValue(pending.promise)
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    const view = renderViewer('session-1')
    await screen.findByRole('img', { name: 'first.png' })
    fireEvent.click(screen.getByRole('button', { name: 'Add image to chat' }))

    view.rerenderSession('session-2')
    // Simulate the narrow route/store race: the new Session rendered, but stale viewer state has
    // not been cleared yet. Session ownership must not rely on that store entry alone.
    useUIStore.setState({
      resourceViewer: { sessionId: 'session-1', resourceId: 'image-1' },
    })
    await act(async () => {
      pending.resolve(PREPARED_IMAGE)
      await pending.promise
      await Promise.resolve()
    })

    expect(useComposerStore.getState().attachments).toEqual([])
    expect(discardPreparedAttachment).toHaveBeenCalledWith(PREPARED_IMAGE)
  })

  it('discards a prepared image when concurrent additions fill the composer', async () => {
    const pending = Promise.withResolvers<PreparedAttachment>()
    prepareSessionResourceAttachment.mockReturnValue(pending.promise)
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')
    await screen.findByRole('img', { name: 'first.png' })
    fireEvent.click(screen.getByRole('button', { name: 'Add image to chat' }))
    await waitFor(() => expect(prepareSessionResourceAttachment).toHaveBeenCalledOnce())
    useComposerStore.getState().replaceAttachments(
      Array.from({ length: ATTACHMENT.MAX_COUNT }, (_, index) => ({
        ...PREPARED_IMAGE,
        id: `concurrent-${String(index)}`,
      })),
    )

    await act(async () => {
      pending.resolve(PREPARED_IMAGE)
      await pending.promise
      await Promise.resolve()
    })

    expect(useComposerStore.getState().attachments).toHaveLength(ATTACHMENT.MAX_COUNT)
    expect(discardPreparedAttachment).toHaveBeenCalledWith(PREPARED_IMAGE)
  })
})
