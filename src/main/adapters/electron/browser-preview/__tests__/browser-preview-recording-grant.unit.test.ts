import { fromPartial } from '@total-typescript/shoehorn'
import type { Session, WebContents, WebFrameMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserPreviewRecordingGrantController } from '../browser-preview-recording-grant'

type DisplayMediaHandler = Parameters<Session['setDisplayMediaRequestHandler']>[0]

function fixture() {
  let handler: DisplayMediaHandler | null = null
  const session = fromPartial<Session>({
    setDisplayMediaRequestHandler: vi.fn((next: DisplayMediaHandler) => {
      handler = next
    }),
  })
  const ownerFrame = fromPartial<WebFrameMain>({ frameTreeNodeId: 101 })
  const targetFrame = fromPartial<WebFrameMain>({ frameTreeNodeId: 202 })
  const owner = fromPartial<WebContents>({
    isDestroyed: () => false,
    mainFrame: ownerFrame,
    session,
  })
  const target = fromPartial<WebContents>({
    isDestroyed: () => false,
    mainFrame: targetFrame,
  })
  const runHandler = (frame: WebFrameMain | null) => {
    if (handler === null) throw new Error('Display media handler was not installed.')
    const callback = vi.fn()
    handler(
      {
        audioRequested: false,
        frame,
        securityOrigin: 'app://openwaggle',
        userGesture: true,
        videoRequested: true,
      },
      callback,
    )
    return callback
  }
  return { owner, ownerFrame, runHandler, session, target, targetFrame }
}

describe('BrowserPreviewRecordingGrantController', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('grants one exact owner-frame request access to the armed preview frame', () => {
    const { owner, ownerFrame, runHandler, target, targetFrame } = fixture()
    const controller = new BrowserPreviewRecordingGrantController()

    const grant = controller.begin('preview-1', owner, target)
    const callback = runHandler(ownerFrame)

    expect(grant).toMatchObject({ maxDurationMs: 120_000, maxFrameRate: 60 })
    expect(callback).toHaveBeenCalledWith({ video: targetFrame })
    expect(() => controller.begin('preview-2', owner, target)).toThrow('already owns')
  })

  it('denies requests from any frame other than the invoking owner frame', () => {
    const { owner, runHandler, target } = fixture()
    const controller = new BrowserPreviewRecordingGrantController()
    controller.begin('preview-1', owner, target)

    const callback = runHandler(fromPartial<WebFrameMain>({ frameTreeNodeId: 999 }))

    expect(callback).toHaveBeenCalledWith({})
  })

  it('expires an unclaimed recording grant and releases the slot', () => {
    vi.useFakeTimers()
    const { owner, target } = fixture()
    const controller = new BrowserPreviewRecordingGrantController()
    controller.begin('preview-1', owner, target)

    vi.advanceTimersByTime(5_001)

    expect(() => controller.begin('preview-2', owner, target)).not.toThrow()
  })

  it('releases pending and active slots only for their owner', () => {
    const first = fixture()
    const second = fixture()
    const controller = new BrowserPreviewRecordingGrantController()
    controller.begin('preview-1', first.owner, first.target)
    controller.disposeOwner(second.owner)

    expect(() => controller.begin('preview-2', second.owner, second.target)).toThrow('already owns')

    controller.finish('preview-1', first.owner)
    expect(() => controller.begin('preview-2', second.owner, second.target)).not.toThrow()
  })
})
