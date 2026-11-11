import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrustedOriginDomain } from '../../../ports/desktop-shell/trusted-origins'
import {
  createLoopbackTrustedOrigins,
  type ElectrobunTrustedOrigins,
} from '../electrobun-trusted-origins'
import { memoryRememberedPorts } from './loopback-test-support'

vi.mock('../../../desktop-shell/app-paths', () => ({
  appPaths: { userData: () => '/nonexistent-user-data' },
}))

const opened: { subject: ElectrobunTrustedOrigins; hosts: [TrustedOriginDomain, string][] }[] = []

function origins(options: Parameters<typeof createLoopbackTrustedOrigins>[0] = {}) {
  const subject = createLoopbackTrustedOrigins({
    rememberedPorts: memoryRememberedPorts(),
    ...options,
  })
  const hosts: [TrustedOriginDomain, string][] = []
  const record = { subject, hosts }
  opened.push(record)
  subject.declare([
    { domain: 'renderer', corsEnabled: true, codeCache: true },
    { domain: 'inline-visualization', corsEnabled: false, codeCache: false },
    { domain: 'session-resource', corsEnabled: false, codeCache: false },
  ])
  const originOf = (domain: TrustedOriginDomain, host: string) => {
    record.hosts.push([domain, host])
    return subject.originOf(domain, host)
  }
  return { subject, originOf }
}

afterEach(() => {
  for (const { subject, hosts } of opened.splice(0)) {
    for (const [domain, host] of hosts) subject.release(domain, host)
  }
})

const html = (body: string) =>
  new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })

describe('Electrobun loopback trusted origins', () => {
  it('answers only requests under the host capability, with an empty 404 otherwise', async () => {
    const { subject, originOf } = origins()
    const handler = vi.fn(() => new Response('secret'))
    subject.serve('session-resource', handler)
    const base = originOf('session-resource', 'content')
    const origin = new URL(base).origin
    const otherHost = originOf('session-resource', 'other')
    const otherCapability = new URL(otherHost).pathname

    for (const url of [
      `${origin}/image.png`,
      `${origin}${otherCapability}/image.png`,
      `${base}x/image.png`,
      `${origin}/`,
    ]) {
      const response = await fetch(url)
      expect(response.status).toBe(404)
      expect(await response.text()).toBe('')
    }
    expect(handler).not.toHaveBeenCalled()
    expect(await (await fetch(`${base}/image.png`)).text()).toBe('secret')
  })

  it('draws new capabilities at every launch', () => {
    const first = origins().originOf('renderer', 'app')
    const second = origins().originOf('renderer', 'app')
    expect(new URL(first).pathname).not.toBe(new URL(second).pathname)
  })

  it('keeps the port of a code-cache domain across launches and gives other hosts fresh ones', () => {
    const rememberedPorts = memoryRememberedPorts()
    const firstLaunch = origins({ rememberedPorts })
    const renderer = new URL(firstLaunch.originOf('renderer', 'app')).origin
    firstLaunch.originOf('inline-visualization', 'frame-a')
    firstLaunch.subject.release('renderer', 'app')
    firstLaunch.subject.release('inline-visualization', 'frame-a')

    const nextLaunch = origins({ rememberedPorts })
    expect(new URL(nextLaunch.originOf('renderer', 'app')).origin).toBe(renderer)
    expect(Object.keys(rememberedPorts.read())).toEqual(['renderer/app'])
  })

  it('moves a code-cache host to a new port when another process holds the remembered one', async () => {
    const holder = origins()
    const taken = Number(new URL(holder.originOf('inline-visualization', 'x')).port)
    const rememberedPorts = memoryRememberedPorts({ 'renderer/app': taken })
    const { subject, originOf } = origins({ rememberedPorts })
    subject.serve('renderer', () => new Response('renderer'))
    const base = originOf('renderer', 'app')
    expect(Number(new URL(base).port)).not.toBe(taken)
    expect(rememberedPorts.read()['renderer/app']).toBe(Number(new URL(base).port))
    expect(await (await fetch(`${base}/index.html`)).text()).toBe('renderer')
  })

  it('adds the shell headers, the domain document policy and a Location pages can follow', async () => {
    const { subject, originOf } = origins()
    subject.setDocumentPolicy('renderer', () => ({
      contentSecurityPolicy: "default-src 'self'; img-src 'self'",
      headers: { 'cross-origin-opener-policy': 'same-origin' },
    }))
    subject.serve('renderer', (request) =>
      new URL(request.url).pathname === '/moved'
        ? new Response(null, { status: 302, headers: { location: 'openwaggle://app/index.html' } })
        : html('<p>app</p>'),
    )
    const base = originOf('renderer', 'app')
    const document = await fetch(`${base}/index.html`)
    expect(Object.fromEntries(document.headers)).toMatchObject({
      // No <head>: the whole policy stays in the header.
      'content-security-policy': "default-src 'self'; img-src 'self'",
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-site',
      'x-content-type-options': 'nosniff',
    })
    expect(document.headers.has('clear-site-data')).toBe(false)
    const moved = await fetch(`${base}/moved`, { redirect: 'manual' })
    expect(moved.headers.get('location')).toBe(`${base}/index.html`)
  })

  it("serves a document with a head its policy in a <meta>, behind CEF's preload", async () => {
    const { subject, originOf } = origins()
    subject.setDocumentPolicy('renderer', () => ({
      contentSecurityPolicy: "script-src 'self'; img-src 'self'",
    }))
    subject.serve('renderer', () => html('<html><head><title>é</title></head></html>'))
    const document = await fetch(`${originOf('renderer', 'app')}/index.html`)
    expect(document.headers.get('content-security-policy')).toBe("img-src 'self'")
    expect(document.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await document.text()).toBe(
      `<html><head><meta http-equiv="content-security-policy" content="script-src 'self'; img-src 'self'"><title>é</title></head></html>`,
    )
  })

  it('clears the storage of a fresh host, and again after a storage clear, on its next document', async () => {
    const { subject, originOf } = origins()
    subject.serve('inline-visualization', () => html('<p>frame</p>'))
    const base = originOf('inline-visualization', 'frame-a')
    const clearSiteData = async () =>
      (await fetch(`${base}/document`)).headers.get('clear-site-data')
    expect(await clearSiteData()).toBe('"storage"')
    expect(await clearSiteData()).toBeNull()
    subject.clearStorage(['openwaggle-visualization://frame-a'])
    expect(await clearSiteData()).toBe('"storage"')
    subject.clearStorage([new URL(base).origin])
    expect(await clearSiteData()).toBe('"storage"')
  })

  it('streams a response body as the handler produces it', async () => {
    const { subject, originOf } = origins()
    let release: () => void = () => undefined
    const second = new Promise<void>((resolve) => {
      release = resolve
    })
    subject.serve('session-resource', () => {
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode('first'))
            await second
            controller.enqueue(encoder.encode('second'))
            controller.close()
          },
        }),
      )
    })
    const response = await fetch(`${originOf('session-resource', 'content')}/file`)
    const reader = response.body?.getReader()
    const firstChunk = await reader?.read()
    expect(new TextDecoder().decode(firstChunk?.value)).toBe('first')
    release()
    const rest = await reader?.read()
    expect(new TextDecoder().decode(rest?.value)).toBe('second')
  })

  it('locates its own URLs in handler form and nothing else', () => {
    const { subject, originOf } = origins()
    const base = originOf('inline-visualization', 'frame-a')
    expect(subject.locate(`${base}/document?x=1#top`)).toEqual({
      domain: 'inline-visualization',
      host: 'frame-a',
      logicalUrl: 'openwaggle-visualization://frame-a/document?x=1#top',
    })
    expect(subject.locate(`${new URL(base).origin}/document`)).toBeNull()
    expect(subject.locate('https://example.com/')).toBeNull()
    expect(subject.locate('not a url')).toBeNull()
  })

  it('stops answering a released host', async () => {
    const { subject, originOf } = origins()
    subject.serve('inline-visualization', () => html('<p>frame</p>'))
    const base = originOf('inline-visualization', 'frame-a')
    subject.release('inline-visualization', 'frame-a')
    await expect(fetch(`${base}/document`)).rejects.toThrow()
    expect(subject.locate(`${base}/document`)).toBeNull()
  })
})
