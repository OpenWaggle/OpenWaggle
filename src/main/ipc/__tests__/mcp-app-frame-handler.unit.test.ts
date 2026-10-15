import { EventEmitter } from 'node:events'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { typedHandleMock } = vi.hoisted(() => ({ typedHandleMock: vi.fn() }))

vi.mock('electron', () => ({ protocol: { handle: vi.fn() } }))
vi.mock('../typed-ipc', () => ({ typedHandle: typedHandleMock }))

import { mcpAppFrameResponse } from '../../mcp-app-frame-protocol'
import { registerMcpAppFrameHandlers } from '../mcp-app-frame-handler'

type Handler = (event: unknown, input: unknown) => Effect.Effect<unknown, unknown>

const CSP = { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] }
let nextOwnerId = 100

/** A renderer that registers App frames: its events and the storage cleared for its frames. */
function renderer() {
  const emitter = new EventEmitter()
  const clearStorageData = vi.fn(async () => undefined)
  nextOwnerId += 1
  const sender = Object.assign(emitter, { id: nextOwnerId, session: { clearStorageData } })
  return { sender, clearStorageData }
}

function handler(channel: string): Handler {
  const call = typedHandleMock.mock.calls.find(([name]) => name === channel)
  const registered: unknown = call?.[1]
  if (typeof registered !== 'function') throw new Error(`No handler for ${channel}`)
  return (event, input) => registered(event, input)
}

async function register(sender: unknown) {
  const frameId = globalThis.crypto.randomUUID()
  const result = await Effect.runPromise(
    handler('mcp:register-app-frame')({ sender }, { frameId, html: '<main></main>', csp: CSP }),
  )
  if (typeof result !== 'object' || result === null || !('frameUrl' in result)) {
    throw new Error('Expected a registration')
  }
  return {
    frameId,
    frameUrl: String(result.frameUrl),
    origin: `openwaggle-mcp-app://frame-${frameId}`,
  }
}

beforeEach(() => {
  typedHandleMock.mockReset()
  registerMcpAppFrameHandlers()
})

describe("a renderer's MCP App frames", () => {
  it('are dropped, and their storage cleared, when the renderer navigates to another page', async () => {
    const { sender, clearStorageData } = renderer()
    const frame = await register(sender)

    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })

    expect(mcpAppFrameResponse(frame.frameUrl).status).toBe(404)
    expect(clearStorageData).toHaveBeenCalledWith({ origin: frame.origin })
  })

  it('stay through a same-document navigation of the renderer', async () => {
    const { sender, clearStorageData } = renderer()
    const frame = await register(sender)

    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })

    expect(mcpAppFrameResponse(frame.frameUrl).status).toBe(200)
    expect(clearStorageData).not.toHaveBeenCalled()
  })

  it('are dropped once when the renderer crashes and is destroyed, and are watched again after', async () => {
    const { sender, clearStorageData } = renderer()
    const frame = await register(sender)

    sender.emit('render-process-gone')
    sender.emit('destroyed')

    expect(mcpAppFrameResponse(frame.frameUrl).status).toBe(404)
    expect(clearStorageData).toHaveBeenCalledTimes(1)
    expect(sender.listenerCount('did-start-navigation')).toBe(0)
    expect(sender.listenerCount('destroyed')).toBe(0)

    const later = await register(sender)
    sender.emit('destroyed')
    expect(mcpAppFrameResponse(later.frameUrl).status).toBe(404)
  })

  it('clear the storage of a frame the renderer unregisters', async () => {
    const { sender, clearStorageData } = renderer()
    const frameId = globalThis.crypto.randomUUID()
    const result = await Effect.runPromise(
      handler('mcp:register-app-frame')({ sender }, { frameId, html: '<main></main>', csp: CSP }),
    )
    if (typeof result !== 'object' || result === null || !('registrationId' in result)) {
      throw new Error('Expected a registration')
    }

    await Effect.runPromise(
      handler('mcp:unregister-app-frame')(
        { sender },
        { frameId, registrationId: String(result.registrationId) },
      ),
    )

    expect(clearStorageData).toHaveBeenCalledWith({
      origin: `openwaggle-mcp-app://frame-${frameId}`,
    })
  })

  it('refuses a malformed registration', async () => {
    const { sender } = renderer()

    await expect(
      Effect.runPromise(handler('mcp:register-app-frame')({ sender }, { frameId: 'x' })),
    ).rejects.toThrow()
  })
})
