import { EventEmitter } from 'node:events'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }))

vi.mock('electron', () => ({ protocol: { handle: handleMock } }))

const loadSubject = () => import('../session-resource-protocol')
type Subject = Awaited<ReturnType<typeof loadSubject>>

let subject: Subject

function registeredProtocolHandler() {
  const handler = handleMock.mock.calls[0]?.[1]
  if (typeof handler !== 'function') throw new Error('Expected the Session resource handler.')
  return handler
}

describe('Session resource protocol capability lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules()
    handleMock.mockReset()
    subject = await loadSubject()
  })

  it('keeps same-session resources usable and revokes every old-session grant on switch', async () => {
    const readContent = vi.fn(async ({ resourceId }: { readonly resourceId: string }) => ({
      fileName: `${resourceId}.png`,
      mimeType: 'image/png',
      body: new Blob([resourceId]).stream(),
    }))
    subject.registerSessionResourceProtocolOnce({ readContent })
    const first = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-one'),
        resourceId: 'resource-one',
        fileName: 'one.png',
        mimeType: 'image/png',
      },
      41,
    )
    const second = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-one'),
        resourceId: 'resource-two',
        fileName: 'two.png',
        mimeType: 'image/png',
      },
      41,
    )
    const otherOwner = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-one'),
        resourceId: 'resource-three',
        fileName: 'three.png',
        mimeType: 'image/png',
      },
      42,
    )
    const handler = registeredProtocolHandler()
    const request = (url: string) => handler({ method: 'GET', referrer: 'openwaggle://app/', url })

    await expect(request(first.url)).resolves.toHaveProperty('status', 200)
    await expect(request(second.url)).resolves.toHaveProperty('status', 200)

    const switched = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-two'),
        resourceId: 'resource-four',
        fileName: 'four.png',
        mimeType: 'image/png',
      },
      41,
    )

    await expect(request(first.url)).resolves.toHaveProperty('status', 404)
    await expect(request(second.url)).resolves.toHaveProperty('status', 404)
    await expect(request(switched.url)).resolves.toHaveProperty('status', 200)
    await expect(request(otherOwner.url)).resolves.toHaveProperty('status', 200)
  })

  it('revokes an old resource URL when the renderer route switches without reading in the destination Session', async () => {
    subject.registerSessionResourceProtocolOnce({
      readContent: async () => ({
        fileName: 'session-a.png',
        mimeType: 'image/png',
        body: new Blob(['session-a']).stream(),
      }),
    })
    const sender = fromPartial<WebContents>(Object.assign(new EventEmitter(), { id: 57 }))
    const ownerLifecycle = await import('../session-resource-owner-lifecycle')
    ownerLifecycle.activateSessionResourceContentOwner(sender, SessionId('session-a'))
    const reference = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-a'),
        resourceId: 'resource-a',
        fileName: 'session-a.png',
        mimeType: 'image/png',
      },
      sender.id,
    )
    const handler = registeredProtocolHandler()
    const request = () =>
      handler({ method: 'GET', referrer: 'openwaggle://app/', url: reference.url })

    await expect(request()).resolves.toHaveProperty('status', 200)
    ownerLifecycle.activateSessionResourceContentOwner(sender, SessionId('session-b'))
    await expect(request()).resolves.toHaveProperty('status', 404)
  })

  it('retains an authorized download capability when Chromium announces its navigation', async () => {
    subject.registerSessionResourceProtocolOnce()
    const sender = fromPartial<WebContents>(
      Object.assign(new EventEmitter(), {
        id: 59,
        getURL: () => 'openwaggle://app/',
      }),
    )
    const lifecycle = await import('../session-resource-owner-lifecycle')
    lifecycle.activateSessionResourceContentOwner(sender, SessionId('session-a'))
    const reference = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-a'),
        resourceId: 'image-a',
        fileName: 'image.png',
        mimeType: 'image/png',
      },
      sender.id,
    )
    sender.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: reference.downloadUrl,
    })
    expect(
      subject.isSessionResourceDownloadNavigation(
        reference.downloadUrl,
        sender.id,
        sender.getURL(),
      ),
    ).toBe(true)
    expect(
      lifecycle.beginSessionResourceContentRequest(sender, SessionId('session-a')).isCurrent(),
    ).toBe(true)
    sender.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://example.com/',
    })
    expect(
      subject.isSessionResourceDownloadNavigation(
        reference.downloadUrl,
        sender.id,
        sender.getURL(),
      ),
    ).toBe(false)
  })

  it('rejects and cancels content that finishes opening after its Session capability is revoked', async () => {
    const pendingContent = Promise.withResolvers<{
      readonly fileName: string
      readonly mimeType: string
      readonly body: ReadableStream<Uint8Array>
    }>()
    subject.registerSessionResourceProtocolOnce({ readContent: () => pendingContent.promise })
    const sender = fromPartial<WebContents>(Object.assign(new EventEmitter(), { id: 58 }))
    const ownerLifecycle = await import('../session-resource-owner-lifecycle')
    ownerLifecycle.activateSessionResourceContentOwner(sender, SessionId('session-a'))
    const reference = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-a'),
        resourceId: 'resource-a',
        fileName: 'session-a.png',
        mimeType: 'image/png',
      },
      sender.id,
    )
    const pendingResponse = registeredProtocolHandler()({
      method: 'GET',
      referrer: 'openwaggle://app/',
      url: reference.url,
    })

    ownerLifecycle.activateSessionResourceContentOwner(sender, SessionId('session-b'))
    const cancel = vi.fn()
    pendingContent.resolve({
      fileName: 'session-a.png',
      mimeType: 'image/png',
      body: new ReadableStream({ cancel }),
    })

    await expect(pendingResponse).resolves.toHaveProperty('status', 404)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('cancels an active response stream when the renderer switches Sessions between pulls', async () => {
    let firstPull = true
    const cancel = vi.fn()
    subject.registerSessionResourceProtocolOnce({
      readContent: async () => ({
        fileName: 'session-a.png',
        mimeType: 'image/png',
        body: new ReadableStream<Uint8Array>({
          pull: (controller) => {
            if (!firstPull) return
            firstPull = false
            controller.enqueue(new Uint8Array([1]))
          },
          cancel,
        }),
      }),
    })
    const sender = fromPartial<WebContents>(Object.assign(new EventEmitter(), { id: 59 }))
    const ownerLifecycle = await import('../session-resource-owner-lifecycle')
    ownerLifecycle.activateSessionResourceContentOwner(sender, SessionId('session-a'))
    const reference = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-a'),
        resourceId: 'resource-a',
        fileName: 'session-a.png',
        mimeType: 'image/png',
      },
      sender.id,
    )
    const response = await registeredProtocolHandler()({
      method: 'GET',
      referrer: 'openwaggle://app/',
      url: reference.url,
    })
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Expected the Session resource response body.')

    await expect(reader.read()).resolves.toEqual({ done: false, value: new Uint8Array([1]) })
    ownerLifecycle.activateSessionResourceContentOwner(sender, SessionId('session-b'))

    await expect(reader.read()).rejects.toBeDefined()
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })
})
