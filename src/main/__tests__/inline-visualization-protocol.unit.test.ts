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
  VISUALIZATION_CONTENT_SECURITY_POLICY,
} from '../inline-visualization-protocol'

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
    const handler = handleMock.mock.calls[0]?.[1]
    const unregisteredResponse = await handler?.({
      url: inlineVisualizationUrl(frameId),
    })
    expect(unregisteredResponse.status).toBe(404)
    expect(readSource).not.toHaveBeenCalled()
    registerInlineVisualizationFrame({ frameId, sessionId, sourcePath })

    const response = await handler?.({
      url: inlineVisualizationUrl(frameId),
    })

    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('content-security-policy')).toBe(
      VISUALIZATION_CONTENT_SECURITY_POLICY,
    )
    expect(VISUALIZATION_CONTENT_SECURITY_POLICY).toContain(
      "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
    )
    for (const origin of CODEX_VISUALIZATION_CDN_ORIGINS) {
      expect(VISUALIZATION_CONTENT_SECURITY_POLICY).toContain(origin)
    }
    expect(VISUALIZATION_CONTENT_SECURITY_POLICY).not.toContain('https: *')
    expect(VISUALIZATION_CONTENT_SECURITY_POLICY).toContain("worker-src 'none'")
    expect(VISUALIZATION_CONTENT_SECURITY_POLICY).not.toContain('worker-src blob:')
    expect(response.headers.get('origin-agent-cluster')).toBeNull()
    expect(response.headers.get('x-dns-prefetch-control')).toBe('off')
    const document = await response.text()
    expect(document).toContain('<main data-lucide="chart-line">Latency</main>')
    expect(document).toContain('openwaggle:inline-visualization:resize')
    expect(document).toContain('data-tooltip-placement')
    expect(document).toContain('navigator.userActivation')
    expect(document).toContain('pendingFollowUps')
    expect(document).toContain('unhandledrejection')
    expect(document).toContain('window.lucide')
    expect(document).toContain('createIcons')
    expect(document).toContain('/lucide.js')
    expect(document).toContain('/base.css')
    const iconRuntimeResponse = await handler?.({
      url: `${frameOrigin}/lucide.js`,
    })
    await expect(iconRuntimeResponse.text()).resolves.toContain('createIcons')
    const baseStylesResponse = await handler?.({
      url: `${frameOrigin}/base.css`,
    })
    const baseStyles = await baseStylesResponse.text()
    expect(baseStyles).toContain('--viz-series-1')
    expect(baseStyles).toContain('.btn')
    expect(baseStyles).toContain(
      '.btn-primary { border-color: transparent; color: var(--primary-foreground); background: var(--primary); }',
    )
    expect(baseStyles).toContain('.btn-primary:not(:disabled):hover')
    expect(readSource).toHaveBeenCalledWith({ sessionId, sourcePath })

    const forgedPathResponse = await handler?.({
      url: `${inlineVisualizationUrl(frameId)}?path=%2Frepo%2Fforged-map.html`,
    })
    expect(forgedPathResponse.status).toBe(404)

    const relativeResourceResponse = await handler?.({
      url: `${frameOrigin}/relative-image.png`,
    })
    expect(relativeResourceResponse.status).toBe(404)
    const sharedOriginResponse = await handler?.({
      url: 'openwaggle-visualization://sandbox/document?sessionId=session-visualization-1&path=%2Frepo%2Fmap.html',
    })
    expect(sharedOriginResponse.status).toBe(404)

    readSource.mockResolvedValue({ status: 'unavailable', reason: 'missing' })
    registerInlineVisualizationFrame({
      frameId,
      sessionId,
      sourcePath: '/repo/missing-map.html',
    })
    const unavailableResponse = await handler?.({
      url: inlineVisualizationUrl(frameId),
    })
    expect(unavailableResponse.status).toBe(200)
    expect(unavailableResponse.headers.get('content-security-policy')).toBe(
      VISUALIZATION_CONTENT_SECURITY_POLICY,
    )
    const unavailableDocument = await unavailableResponse.text()
    expect(unavailableDocument).toContain('openwaggle:inline-visualization:error')
    expect(unavailableDocument).toContain('missing')
  })
})
