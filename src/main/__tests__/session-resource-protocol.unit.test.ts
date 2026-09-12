import { SessionId } from '@shared/types/brand'
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

describe('Session resource protocol', () => {
  beforeEach(async () => {
    vi.resetModules()
    handleMock.mockReset()
    subject = await loadSubject()
  })

  it('serves a registered resource without putting its bytes in the IPC reference', async () => {
    const readContent = vi.fn(async () => ({
      fileName: 'architecture.png',
      mimeType: 'image/png',
      body: new Blob([new Uint8Array([1, 2, 3])]).stream(),
    }))
    subject.registerSessionResourceProtocolOnce({ readContent })
    const reference = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-one'),
        resourceId: 'resource-one',
        fileName: 'architecture.png',
        mimeType: 'image/png',
      },
      41,
    )

    expect(reference).not.toHaveProperty('dataBase64')
    expect(reference.url).toMatch(/^openwaggle-session-resource:\/\/content\/[0-9a-f-]{36}\/view$/u)
    expect(reference.downloadUrl).toMatch(
      /^openwaggle-session-resource:\/\/content\/[0-9a-f-]{36}\/download$/u,
    )

    const response = await registeredProtocolHandler()({
      method: 'GET',
      referrer: 'openwaggle://app/',
      url: reference.url,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('content-disposition')).toBe('inline')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3])
    expect(readContent).toHaveBeenCalledWith({
      sessionId: SessionId('session-one'),
      resourceId: 'resource-one',
    })
  })

  it('allows referrerless images only through the owning trusted main-frame request guard', async () => {
    subject.registerSessionResourceProtocolOnce({
      readContent: async () => ({
        fileName: 'image.png',
        mimeType: 'image/png',
        body: new Blob([new Uint8Array([1])]).stream(),
      }),
    })
    const reference = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-one'),
        resourceId: 'image-one',
        fileName: 'image.png',
        mimeType: 'image/png',
      },
      41,
    )
    const request = {
      url: reference.url,
      ownerId: 41,
      frameUrl: 'openwaggle://app/',
      isMainFrame: true,
    }
    expect(subject.shouldBlockSessionResourceRequest(request)).toBe(false)
    expect(
      subject.isSessionResourceDownloadNavigation(reference.downloadUrl, 41, request.frameUrl),
    ).toBe(true)
    expect(subject.isSessionResourceDownloadNavigation(reference.url, 41, request.frameUrl)).toBe(
      false,
    )
    expect(
      subject.isSessionResourceDownloadNavigation(reference.downloadUrl, 42, request.frameUrl),
    ).toBe(false)
    expect(
      subject.isSessionResourceDownloadNavigation(
        reference.downloadUrl,
        41,
        'https://attacker.example/',
      ),
    ).toBe(false)
    for (const rejected of [
      { ...request, ownerId: 42 },
      { ...request, ownerId: undefined },
      { ...request, frameUrl: undefined },
      { ...request, frameUrl: 'https://attacker.example/' },
      { ...request, isMainFrame: false },
    ])
      expect(subject.shouldBlockSessionResourceRequest(rejected)).toBe(true)
    const response = await registeredProtocolHandler()({
      method: 'GET',
      referrer: '',
      url: reference.url,
    })
    expect(response.status).toBe(200)
    subject.unregisterSessionResourceContentReferencesForOwner(41)
    expect(subject.shouldBlockSessionResourceRequest(request)).toBe(true)
  })

  it('bounds both Content-Disposition filenames and percent-encodes unsafe characters', async () => {
    const fileName = `unsafe'\r\n()*!${'💣'.repeat(500)}.png`
    const readContent = vi.fn(async () => ({
      fileName,
      mimeType: 'image/png',
      body: new Blob([new Uint8Array([1])]).stream(),
    }))
    subject.registerSessionResourceProtocolOnce({ readContent })
    const reference = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-one'),
        resourceId: 'resource-one',
        fileName,
        mimeType: 'image/png',
      },
      41,
    )

    const response = await registeredProtocolHandler()({
      method: 'GET',
      referrer: 'openwaggle://app/',
      url: reference.downloadUrl,
    })
    const disposition = response.headers.get('content-disposition') ?? ''
    const ascii = /filename="([^"]*)"/u.exec(disposition)?.[1] ?? ''
    const encoded = /filename\*=UTF-8''(.+)$/u.exec(disposition)?.[1] ?? ''

    expect(response.status).toBe(200)
    expect(Buffer.byteLength(ascii)).toBeLessThanOrEqual(180)
    expect(encoded.length).toBeLessThanOrEqual(540)
    expect(disposition).not.toContain('\r')
    expect(disposition).not.toContain('\n')
    expect(encoded).toContain('%27%0D%0A%28%29%2A%21')
    expect(disposition).not.toContain('💣'.repeat(100))
  })

  it('rejects forged, expired, purged, malformed, and excess registrations', async () => {
    let now = 1_000
    let sequence = 0
    const token = () => {
      sequence += 1
      return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
    }
    const readContent = vi.fn(async () => ({
      fileName: "unsafe'\r\nname.png",
      mimeType: 'invalid content type',
      body: new Blob([new Uint8Array([4, 5, 6])]).stream(),
    }))
    subject.registerSessionResourceProtocolOnce({
      createToken: token,
      now: () => now,
      readContent,
      registrationTtlMs: 100,
      maxRegistrationsPerOwner: 2,
    })
    const first = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-one'),
        resourceId: 'resource-one',
        fileName: 'first.png',
        mimeType: 'image/png',
      },
      41,
    )
    const second = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-one'),
        resourceId: 'resource-two',
        fileName: 'second.png',
        mimeType: 'image/png',
      },
      41,
    )
    const third = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-one'),
        resourceId: 'resource-three',
        fileName: 'third.png',
        mimeType: 'image/png',
      },
      41,
    )
    const handler = registeredProtocolHandler()

    for (const request of [
      { method: 'GET', url: first.url },
      { method: 'POST', url: third.url },
      { method: 'GET', url: `${third.url}?resource=forged` },
      { method: 'GET', url: third.url.replace('/view', '/other') },
      { method: 'GET', url: third.url.replace(/\/[0-9a-f-]{36}\//u, '/forged/') },
      { method: 'GET', referrer: 'https://attacker.example/', url: third.url },
    ]) {
      await expect(handler({ referrer: 'openwaggle://app/', ...request })).resolves.toHaveProperty(
        'status',
        404,
      )
    }
    expect(readContent).not.toHaveBeenCalled()

    await expect(
      handler({ method: 'GET', referrer: 'openwaggle://app/', url: second.url }),
    ).resolves.toHaveProperty('status', 200)

    const download = await handler({
      method: 'GET',
      referrer: 'openwaggle://app/',
      url: third.downloadUrl,
    })
    expect(download.headers.get('content-type')).toBe('application/octet-stream')
    expect(download.headers.get('content-disposition')).toContain('attachment;')
    expect(download.headers.get('content-disposition')).not.toContain('\r')
    expect(download.headers.get('content-disposition')).not.toContain('\n')
    expect(download.headers.get('content-disposition')).toContain('%27%0D%0A')

    subject.unregisterSessionResourceContentReferencesForOwner(42)
    await expect(
      handler({ method: 'GET', referrer: 'openwaggle://app/', url: third.url }),
    ).resolves.toHaveProperty('status', 200)
    subject.unregisterSessionResourceContentReferencesForOwner(41)
    await expect(
      handler({ method: 'GET', referrer: 'openwaggle://app/', url: third.url }),
    ).resolves.toHaveProperty('status', 404)

    const expiring = subject.registerSessionResourceContentReference(
      {
        sessionId: SessionId('session-three'),
        resourceId: 'resource-four',
        fileName: 'four.png',
        mimeType: 'image/png',
      },
      52,
    )
    now += 101
    await expect(
      handler({ method: 'GET', referrer: 'openwaggle://app/', url: expiring.url }),
    ).resolves.toHaveProperty('status', 404)
  })
})
