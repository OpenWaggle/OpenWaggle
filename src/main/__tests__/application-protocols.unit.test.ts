import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  readHostSessionResourceContent: vi.fn(),
  openSessionResourceContentStream: vi.fn(),
  runAppEffect: vi.fn(),
}))

vi.mock('electron', () => ({ protocol: { handle: mocks.handle } }))
vi.mock('../renderer-protocol', () => ({ registerRendererProtocolOnce: vi.fn() }))
vi.mock('../extension-frame-protocol', () => ({ registerExtensionFrameProtocolOnce: vi.fn() }))
vi.mock('../extension-runtime-protocol', () => ({
  registerExtensionRuntimeProtocolOnce: vi.fn(),
}))
vi.mock('../inline-visualization-protocol', () => ({
  registerInlineVisualizationProtocolOnce: vi.fn(),
}))
vi.mock('../application/host-ui-session-resource-content-client', () => ({
  readHostSessionResourceContent: mocks.readHostSessionResourceContent,
}))
vi.mock('../application/session-resource-content', () => ({
  openSessionResourceContentStream: mocks.openSessionResourceContentStream,
}))
vi.mock('../runtime', () => ({ runAppEffect: mocks.runAppEffect }))

function sessionResourceHandler() {
  const call = mocks.handle.mock.calls.find(([scheme]) => scheme === 'openwaggle-session-resource')
  const handler = call?.[1]
  if (typeof handler !== 'function') throw new Error('Expected the Session resource handler.')
  return handler
}

describe('registerApplicationProtocols', () => {
  beforeEach(() => {
    // Fresh protocol modules reset their registered-once flags and capability maps.
    vi.resetModules()
    for (const mock of Object.values(mocks)) mock.mockReset()
  })

  it('serves Session resource images from the attached Session Host, not the GUI database', async () => {
    mocks.readHostSessionResourceContent.mockResolvedValue({
      handled: true,
      content: {
        resourceId: 'image-one',
        fileName: 'screenshot.png',
        mimeType: 'image/png',
        bytes: new Uint8Array([7, 8, 9]),
      },
    })
    const { registerApplicationProtocols } = await import('../application-protocols')
    const { registerSessionResourceContentReference } = await import('../session-resource-protocol')
    registerApplicationProtocols({ readInlineVisualizationSource: vi.fn() })
    const reference = registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-one'),
        resourceId: 'image-one',
        fileName: 'screenshot.png',
        mimeType: 'image/png',
      },
      7,
    )

    const response = await sessionResourceHandler()({
      method: 'GET',
      referrer: '',
      url: reference.url,
    })

    expect(response.status).toBe(200)
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([7, 8, 9])
    expect(mocks.readHostSessionResourceContent).toHaveBeenCalledWith(
      SessionId('session-one'),
      'image-one',
    )
    expect(mocks.runAppEffect).not.toHaveBeenCalled()
  })

  async function registeredReference() {
    const { registerApplicationProtocols } = await import('../application-protocols')
    const { registerSessionResourceContentReference } = await import('../session-resource-protocol')
    registerApplicationProtocols({ readInlineVisualizationSource: vi.fn() })
    return registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-one'),
        resourceId: 'image-one',
        fileName: 'screenshot.png',
        mimeType: 'image/png',
      },
      7,
    )
  }

  it('serves nothing when no Session Host is attached: the window has no resource store (A-F5)', async () => {
    mocks.readHostSessionResourceContent.mockResolvedValue({ handled: false })
    const reference = await registeredReference()

    const response = await sessionResourceHandler()({
      method: 'GET',
      referrer: '',
      url: reference.url,
    })

    expect(response.status).toBe(404)
    expect(mocks.openSessionResourceContentStream).not.toHaveBeenCalled()
    expect(mocks.runAppEffect).not.toHaveBeenCalled()
  })

  it('answers 404 when the Session Host has no such image', async () => {
    mocks.readHostSessionResourceContent.mockResolvedValue({ handled: true, content: null })
    const reference = await registeredReference()

    const response = await sessionResourceHandler()({
      method: 'GET',
      referrer: '',
      url: reference.url,
    })

    expect(response.status).toBe(404)
    expect(mocks.runAppEffect).not.toHaveBeenCalled()
  })
})
