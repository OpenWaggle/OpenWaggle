import { SessionId } from '@shared/types/brand'
import type { InlineVisualizationReadResult } from '@shared/types/inline-visualization'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }))
const CODEX_VISUALIZATION_CDN_ORIGINS = [
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://esm.sh',
  'https://fonts.bunny.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://unpkg.com',
] as const

vi.mock('electron', () => ({ protocol: { handle: handleMock } }))

import {
  inlineVisualizationUrl,
  registerInlineVisualizationFrame,
  registerInlineVisualizationProtocolOnce,
  unregisterInlineVisualizationFrame,
  unregisterInlineVisualizationFramesForOwner,
  VISUALIZATION_CONTENT_SECURITY_POLICY,
} from '../inline-visualization-protocol'

function registeredProtocolHandler() {
  const handler = handleMock.mock.calls[0]?.[1]
  if (typeof handler !== 'function') throw new Error('Expected the visualization protocol handler.')
  return handler
}

describe('inline visualization protocol', () => {
  const frameId = '12345678-1234-4123-8123-123456789abc'
  const frameOrigin = `openwaggle-visualization://frame-${frameId}`
  beforeEach(() => {
    handleMock.mockReset()
  })

  it('serves an authorized source as an isolated document with the host runtime and CSP', async () => {
    const sessionId = SessionId('session-visualization-1')
    const sourcePath = '/repo/.openwaggle/visualizations/latency-map.html'
    const readSource = vi.fn<() => Promise<InlineVisualizationReadResult>>(async () => ({
      status: 'loaded' as const,
      contents: '<main data-lucide="chart-line">Latency</main>',
      sizeBytes: 46,
    }))
    registerInlineVisualizationProtocolOnce({ readSource })
    const handler = registeredProtocolHandler()
    const unregisteredResponse = await handler({
      url: inlineVisualizationUrl(frameId),
    })
    expect(unregisteredResponse.status).toBe(404)
    expect(readSource).not.toHaveBeenCalled()
    const initialRegistration = registerInlineVisualizationFrame(
      { frameId, reducedMotion: true, sessionId, sourcePath },
      11,
    )
    expect(() =>
      registerInlineVisualizationFrame({ frameId, reducedMotion: true, sessionId, sourcePath }, 12),
    ).toThrow('already registered')

    const response = await handler({
      url: inlineVisualizationUrl(frameId),
    })

    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('content-security-policy')).toBe(
      VISUALIZATION_CONTENT_SECURITY_POLICY,
    )
    expect(VISUALIZATION_CONTENT_SECURITY_POLICY).toContain(
      "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
    )
    for (const directive of ['script-src', 'script-src-elem', 'style-src', 'font-src']) {
      expect(VISUALIZATION_CONTENT_SECURITY_POLICY).toMatch(
        new RegExp(`${directive}[^;]*blob:[^;]*data:`),
      )
    }
    for (const origin of CODEX_VISUALIZATION_CDN_ORIGINS) {
      expect(VISUALIZATION_CONTENT_SECURITY_POLICY).toContain(origin)
    }
    expect(VISUALIZATION_CONTENT_SECURITY_POLICY).not.toContain('https: *')
    expect(VISUALIZATION_CONTENT_SECURITY_POLICY).toContain("worker-src 'none'")
    expect(VISUALIZATION_CONTENT_SECURITY_POLICY).not.toContain('worker-src blob:')
    expect(response.headers.get('origin-agent-cluster')).toBeNull()
    expect(response.headers.get('x-dns-prefetch-control')).toBe('off')
    const document = await response.text()
    expect(document).toContain('<html data-motion="reduced">')
    expect(document).toContain('prefers-reduced-motion')
    expect(document).toContain('<main data-lucide="chart-line">Latency</main>')
    expect(document).toContain('openwaggle:inline-visualization:resize')
    expect(document).toContain('data-tooltip-placement')
    expect(document).toContain('navigator.userActivation')
    expect(document).toContain('pendingFollowUps')
    expect(document).toContain(':root[data-motion="reduced"]')
    expect(document).toContain('unhandledrejection')
    expect(document).toContain('window.lucide')
    expect(document).toContain('createIcons')
    expect(document).toContain('lucideScript.async = true')
    const lucideAssetUrl = document.match(
      /openwaggle-visualization:\/\/assets\/lucide-[a-f0-9]{16}\.js/u,
    )?.[0]
    expect(lucideAssetUrl).toBeDefined()
    if (!lucideAssetUrl) throw new Error('Expected a content-addressed Lucide asset URL.')
    expect(document).not.toContain(`<script src="${frameOrigin}/lucide.js"></script>`)
    expect(document).toContain('/base.css')
    const iconRuntimeResponse = await handler({
      url: lucideAssetUrl,
    })
    await expect(iconRuntimeResponse.text()).resolves.toContain('createIcons')
    await expect(handler({ url: `${frameOrigin}/lucide.js` })).resolves.toHaveProperty(
      'status',
      404,
    )
    const baseStylesResponse = await handler({
      url: `${frameOrigin}/base.css`,
    })
    const baseStyles = await baseStylesResponse.text()
    expect(baseStyles).toContain('--viz-series-1')
    expect(baseStyles).toContain('.btn')
    expect(baseStyles).toContain('.btn-primary {')
    expect(baseStyles).toContain('background: var(--foreground);')
    expect(baseStyles).toContain('.nav-pills .nav-link.active')
    expect(baseStyles).toContain('.btn-primary:not(:disabled):hover')
    expect(readSource).toHaveBeenCalledWith({ sessionId, sourcePath })

    const forgedPathResponse = await handler({
      url: `${inlineVisualizationUrl(frameId)}?path=%2Frepo%2Fforged-map.html`,
    })
    expect(forgedPathResponse.status).toBe(404)

    const relativeResourceResponse = await handler({
      url: `${frameOrigin}/relative-image.png`,
    })
    expect(relativeResourceResponse.status).toBe(404)
    const sharedOriginResponse = await handler({
      url: 'openwaggle-visualization://sandbox/document?sessionId=session-visualization-1&path=%2Frepo%2Fmap.html',
    })
    expect(sharedOriginResponse.status).toBe(404)

    readSource.mockResolvedValue({ status: 'unavailable', reason: 'missing' })
    unregisterInlineVisualizationFrame(
      { frameId, registrationId: initialRegistration.registrationId },
      11,
    )
    const missingRegistration = registerInlineVisualizationFrame(
      {
        frameId,
        reducedMotion: false,
        sessionId,
        sourcePath: '/repo/missing-map.html',
      },
      11,
    )
    const unavailableResponse = await handler({
      url: inlineVisualizationUrl(frameId),
    })
    expect(unavailableResponse.status).toBe(200)
    expect(unavailableResponse.headers.get('content-security-policy')).toBe(
      VISUALIZATION_CONTENT_SECURITY_POLICY,
    )
    const unavailableDocument = await unavailableResponse.text()
    expect(unavailableDocument).toContain('openwaggle:inline-visualization:error')
    expect(unavailableDocument).toContain('missing')
    unregisterInlineVisualizationFrame(
      { frameId, registrationId: missingRegistration.registrationId },
      11,
    )
    const ownerRegistration = registerInlineVisualizationFrame(
      { frameId, reducedMotion: false, sessionId, sourcePath },
      41,
    )

    unregisterInlineVisualizationFrame(
      { frameId, registrationId: ownerRegistration.registrationId },
      42,
    )
    unregisterInlineVisualizationFramesForOwner(42)
    await expect(handler({ url: inlineVisualizationUrl(frameId) })).resolves.not.toHaveProperty(
      'status',
      404,
    )

    unregisterInlineVisualizationFramesForOwner(41)
    await expect(handler({ url: inlineVisualizationUrl(frameId) })).resolves.toHaveProperty(
      'status',
      404,
    )
  })
})
