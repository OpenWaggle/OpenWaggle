import { EventEmitter } from 'node:events'
import type { BrowserPreviewOpenRequest } from '@shared/types/browser-preview-owner'
import { fromPartial } from '@total-typescript/shoehorn'
import type { BrowserWindow, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const windowFromWebContents = vi.hoisted(() => vi.fn())

vi.mock('../desktop-ui', () => ({ browserWindowFromWebContents: windowFromWebContents }))

import { BrowserPreviewOwnerRegistry } from '../browser-preview-owner-registry'

function owner() {
  const senderEvents = new EventEmitter()
  const windowEvents = new EventEmitter()
  const send = vi.fn()
  const sender = fromPartial<WebContents>({
    id: Math.floor(Math.random() * 1_000_000),
    isDestroyed: () => false,
    on: senderEvents.on.bind(senderEvents),
    once: senderEvents.once.bind(senderEvents),
    removeListener: senderEvents.removeListener.bind(senderEvents),
    send,
  })
  const window = fromPartial<BrowserWindow>({
    isDestroyed: () => false,
    once: windowEvents.once.bind(windowEvents),
    removeListener: windowEvents.removeListener.bind(windowEvents),
  })
  return { send, sender, senderEvents, window, windowEvents }
}

function sentOpenRequest(send: ReturnType<typeof vi.fn>, index = 0): BrowserPreviewOpenRequest {
  const payload = send.mock.calls.filter(([channel]) => channel === 'browser-preview:open-request')[
    index
  ]?.[1]
  if (!payload) throw new Error('Expected a browser-preview open request.')
  return fromPartial<BrowserPreviewOpenRequest>(payload)
}

function acknowledgeSuccess(
  registry: BrowserPreviewOwnerRegistry,
  sender: WebContents,
  sent: BrowserPreviewOpenRequest,
) {
  registry.acknowledge(sender, {
    requestId: sent.requestId,
    generation: sent.generation,
    ownerKey: sent.ownerKey,
    previewId: sent.previewId,
    success: true,
  })
}

const request = {
  ownerKey: 'session-1',
  previewId: 'preview-1',
  profileId: 'default',
  url: 'https://example.com/',
  visible: true,
  activate: true,
} as const

describe('BrowserPreviewOwnerRegistry', () => {
  beforeEach(() => {
    windowFromWebContents.mockReset()
    vi.useRealTimers()
  })

  it('resolves only after trusted native materialization and renderer acknowledgment', async () => {
    const registered = owner()
    windowFromWebContents.mockReturnValue(registered.window)
    const registry = new BrowserPreviewOwnerRegistry()
    registry.register(request.ownerKey, registered.sender)

    let completed = false
    const opening = registry.requestOpen(request).then(() => {
      completed = true
    })
    await Promise.resolve()
    const sent = sentOpenRequest(registered.send)
    expect(completed).toBe(false)
    expect(sent).toMatchObject(request)
    expect(sent.requestId).toMatch(/^[A-Za-z0-9._:-]+$/)
    expect(sent.generation).toBe(1)

    registry.notifyMaterialized(request.ownerKey, request.previewId, registered.sender)
    await Promise.resolve()
    expect(completed).toBe(false)

    acknowledgeSuccess(registry, registered.sender, sent)
    await opening
    expect(completed).toBe(true)
  })

  it('also handles a renderer acknowledgment that arrives before native materialization', async () => {
    const registered = owner()
    windowFromWebContents.mockReturnValue(registered.window)
    const registry = new BrowserPreviewOwnerRegistry()
    registry.register(request.ownerKey, registered.sender)
    const opening = registry.requestOpen(request)
    const sent = sentOpenRequest(registered.send)

    acknowledgeSuccess(registry, registered.sender, sent)
    registry.notifyMaterialized(request.ownerKey, request.previewId, registered.sender)

    await expect(opening).resolves.toBeUndefined()
  })

  it('rejects owner-key takeover by another renderer', () => {
    const first = owner()
    const second = owner()
    windowFromWebContents.mockImplementation((sender: WebContents) =>
      sender === first.sender ? first.window : second.window,
    )
    const registry = new BrowserPreviewOwnerRegistry()
    registry.register(request.ownerKey, first.sender)

    expect(() => registry.register(request.ownerKey, second.sender)).toThrow('already registered')
  })

  it('retains every Session owner across a trusted renderer reload and revokes on escape', () => {
    const first = owner()
    const second = owner()
    windowFromWebContents.mockImplementation((sender: WebContents) =>
      sender === first.sender ? first.window : second.window,
    )
    const registry = new BrowserPreviewOwnerRegistry()
    registry.register('session-1', first.sender)
    registry.register('session-2', first.sender)

    first.senderEvents.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'openwaggle://app/sessions/session-1',
    })

    expect(() => registry.assertRegistered('session-1', first.sender)).not.toThrow()
    expect(() => registry.assertRegistered('session-2', first.sender)).not.toThrow()

    first.senderEvents.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://attacker.invalid/',
    })

    expect(() => registry.assertRegistered('session-1', first.sender)).toThrow('not registered')
    expect(() => registry.assertRegistered('session-2', first.sender)).toThrow('not registered')
  })

  it('rejects a pending open when the owner unregisters', async () => {
    const registered = owner()
    windowFromWebContents.mockReturnValue(registered.window)
    const registry = new BrowserPreviewOwnerRegistry()
    registry.register(request.ownerKey, registered.sender)
    const opening = registry.requestOpen(request)
    const sent = sentOpenRequest(registered.send)

    registry.unregister(request.ownerKey, registered.sender)

    await expect(opening).rejects.toThrow('unregistered')
    expect(registered.send).toHaveBeenCalledWith('browser-preview:cancel-open-request', {
      requestId: sent.requestId,
      generation: sent.generation,
      ownerKey: request.ownerKey,
      previewId: request.previewId,
    })
  })

  it('still rejects pending opens when owner listener cleanup throws', async () => {
    const registered = owner()
    windowFromWebContents.mockReturnValue(registered.window)
    const registry = new BrowserPreviewOwnerRegistry()
    registry.register(request.ownerKey, registered.sender)
    const opening = registry.requestOpen(request)
    const sent = sentOpenRequest(registered.send)
    vi.spyOn(registered.sender, 'removeListener').mockImplementationOnce(() => {
      throw new Error('listener teardown race')
    })

    expect(() => registry.unregister(request.ownerKey, registered.sender)).not.toThrow()

    await expect(opening).rejects.toThrow('unregistered')
    expect(registered.send).toHaveBeenCalledWith(
      'browser-preview:cancel-open-request',
      expect.objectContaining({ requestId: sent.requestId }),
    )
  })

  it('rejects forged acknowledgments without settling the trusted request', async () => {
    const registered = owner()
    const attacker = owner()
    windowFromWebContents.mockImplementation((sender: WebContents) =>
      sender === registered.sender ? registered.window : attacker.window,
    )
    const registry = new BrowserPreviewOwnerRegistry()
    registry.register(request.ownerKey, registered.sender)
    const opening = registry.requestOpen(request)
    const sent = sentOpenRequest(registered.send)

    expect(() => acknowledgeSuccess(registry, attacker.sender, sent)).toThrow('trusted request')
    registry.notifyMaterialized(request.ownerKey, request.previewId, registered.sender)
    acknowledgeSuccess(registry, registered.sender, sent)

    await expect(opening).resolves.toBeUndefined()
  })

  it('propagates renderer failure and cancels a possibly stale native materialization', async () => {
    const registered = owner()
    windowFromWebContents.mockReturnValue(registered.window)
    const registry = new BrowserPreviewOwnerRegistry()
    registry.register(request.ownerKey, registered.sender)
    const opening = registry.requestOpen(request)
    const rejection = expect(opening).rejects.toThrow('could not open this URL')
    const sent = sentOpenRequest(registered.send)

    registry.acknowledge(registered.sender, {
      requestId: sent.requestId,
      generation: sent.generation,
      ownerKey: sent.ownerKey,
      previewId: sent.previewId,
      success: false,
      error: 'Renderer could not open this URL.',
    })

    await rejection
    expect(registered.send).toHaveBeenLastCalledWith(
      'browser-preview:cancel-open-request',
      expect.objectContaining({ requestId: sent.requestId, generation: sent.generation }),
    )
  })

  it('supports abort and a bounded materialization timeout', async () => {
    vi.useFakeTimers()
    const registered = owner()
    windowFromWebContents.mockReturnValue(registered.window)
    const registry = new BrowserPreviewOwnerRegistry()
    registry.register(request.ownerKey, registered.sender)
    const controller = new AbortController()
    const aborted = registry.requestOpen(request, { signal: controller.signal })
    const abortedRequest = sentOpenRequest(registered.send)
    controller.abort()
    await expect(aborted).rejects.toThrow('aborted')
    expect(registered.send).toHaveBeenCalledWith(
      'browser-preview:cancel-open-request',
      expect.objectContaining({ requestId: abortedRequest.requestId }),
    )

    const timedOut = registry.requestOpen({ ...request, previewId: 'preview-2' }, { timeoutMs: 1 })
    const timeoutExpectation = expect(timedOut).rejects.toThrow('timeout')
    const timedOutRequest = sentOpenRequest(registered.send, 1)
    await vi.advanceTimersByTimeAsync(1)
    await timeoutExpectation
    expect(registered.send).toHaveBeenCalledWith(
      'browser-preview:cancel-open-request',
      expect.objectContaining({
        requestId: timedOutRequest.requestId,
        generation: timedOutRequest.generation,
      }),
    )
  })
})
