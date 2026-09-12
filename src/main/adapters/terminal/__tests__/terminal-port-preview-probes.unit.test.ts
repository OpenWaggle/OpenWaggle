import { describe, expect, it, vi } from 'vitest'
import {
  COMMON_DEV_PORTS,
  commonDevPortCandidates,
  normalizeTerminalListenerHost,
  TerminalPortPreviewProber,
  terminalPortPreviewUrl,
} from '../terminal-port-preview-probes'

describe('terminal port preview probes', () => {
  it('preserves concrete hosts and normalizes only wildcard listeners', () => {
    expect(normalizeTerminalListenerHost('127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeTerminalListenerHost('[::1]')).toBe('::1')
    expect(normalizeTerminalListenerHost('*')).toBe('localhost')
    expect(normalizeTerminalListenerHost('0.0.0.0')).toBe('localhost')
    expect(terminalPortPreviewUrl('http', '::1', 5173)).toBe('http://[::1]:5173/')
    expect(normalizeTerminalListenerHost('localhost/path')).toBeNull()
  })

  it('publishes only successful browser documents and prefers HTTP', async () => {
    const fetchPreview = vi.fn(async (url: string) => {
      if (url.startsWith('http:')) {
        return new Response('<html />', { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    })
    const prober = new TerminalPortPreviewProber(fetchPreview)

    await expect(prober.probe([{ host: '192.168.1.8', port: 5173, pid: 42 }])).resolves.toEqual([
      { host: '192.168.1.8', port: 5173, url: 'http://192.168.1.8:5173/', pid: 42 },
    ])
    expect(fetchPreview).toHaveBeenCalledOnce()
  })

  it('falls through to HTTPS after a non-document HTTP response', async () => {
    const fetchPreview = vi.fn(async (url: string) =>
      url.startsWith('https:')
        ? new Response('<html />', { headers: { 'content-type': 'application/xhtml+xml' } })
        : new Response('{}', { headers: { 'content-type': 'application/json' } }),
    )
    const prober = new TerminalPortPreviewProber(fetchPreview)

    await expect(prober.probe([{ host: '127.0.0.1', port: 8443, pid: 7 }])).resolves.toEqual([
      { host: '127.0.0.1', port: 8443, url: 'https://127.0.0.1:8443/', pid: 7 },
    ])
    expect(fetchPreview).toHaveBeenCalledTimes(2)
  })

  it('accepts navigation redirects and caches classifications by listener identity', async () => {
    const fetchPreview = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: '/login' } }),
    )
    const prober = new TerminalPortPreviewProber(fetchPreview)
    const candidate = { host: 'localhost', port: 3000, pid: 11 }

    await prober.probe([candidate])
    await prober.probe([candidate])
    await prober.probe([{ ...candidate, pid: 12 }])

    expect(fetchPreview).toHaveBeenCalledTimes(2)
  })

  it('keeps the listener-unavailable fallback fixed and bounded', () => {
    const candidates = commonDevPortCandidates()

    expect(candidates.map((candidate) => candidate.port)).toEqual(COMMON_DEV_PORTS)
    expect(candidates).toHaveLength(16)
    expect(candidates.every((candidate) => candidate.host === 'localhost')).toBe(true)
    expect(candidates.every((candidate) => candidate.pid === null)).toBe(true)
  })
})
