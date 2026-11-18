import { fireEvent, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { expect, vi } from 'vitest'

const TEST_CAPABILITY = 'test-capability-1234567890'

export async function visualizationFrame(title: string) {
  const element = await screen.findByTitle(title)
  if (!(element instanceof HTMLIFrameElement)) {
    throw new Error(`Expected ${title} to be an iframe.`)
  }
  return element
}

export function visualizationFrameWindow(frame: HTMLIFrameElement) {
  const frameWindow = frame.contentWindow
  if (!frameWindow) throw new Error('Expected visualization iframe window.')
  return frameWindow
}

export function frameOrigin(frame: HTMLIFrameElement) {
  const url = new URL(frame.src)
  return `${url.protocol}//${url.host}`
}

export function dispatchFrameMessage(
  frame: HTMLIFrameElement,
  data: Record<string, unknown>,
  capability = TEST_CAPABILITY,
) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: visualizationFrameWindow(frame),
      origin: frameOrigin(frame),
      data: { capability, ...data },
    }),
  )
}

export async function activateFrame(frame: HTMLIFrameElement, capability = TEST_CAPABILITY) {
  await act(async () => undefined)
  const postMessage = vi.spyOn(visualizationFrameWindow(frame), 'postMessage')
  fireEvent.load(frame)
  act(() => {
    dispatchFrameMessage(frame, { type: 'openwaggle:inline-visualization:bootstrap' }, capability)
    dispatchFrameMessage(frame, { type: 'openwaggle:inline-visualization:ready' }, capability)
  })
  await waitFor(() => {
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:theme' }),
      frameOrigin(frame),
    )
  })
  const calls = postMessage.mock.calls.map((call) => [...call])
  postMessage.mockRestore()
  return calls
}
