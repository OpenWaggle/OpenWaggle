import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalPortPreview } from '@shared/types/terminal'

export const COMMON_DEV_PORTS: readonly number[] = Object.freeze([
  3000, 3001, 3333, 4173, 4200, 4321, 5000, 5173, 5174, 5175, 5500, 8000, 8080, 8081, 8888, 9000,
])

const NAVIGATION_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const NO_CONTENT_STATUS = new Set([204, 205])
const WILDCARD_HOSTS = new Set(['*', '0.0.0.0', '::'])
const TCP_PORT_UPPER_BOUND = 65_536
const HTTP_SUCCESS_STATUS_MIN = 200
const HTTP_SUCCESS_STATUS_UPPER_BOUND = 300

export interface TerminalPortCandidate {
  readonly host: string
  readonly port: number
  /** Null only for common-port fallback probes without listener metadata. */
  readonly pid: number | null
}

export interface VerifiedTerminalPortPreview extends TerminalPortPreview {
  readonly pid: number | null
}

export type TerminalPortPreviewFetch = (url: string, init: RequestInit) => Promise<Response>

interface ProbeCacheEntry {
  readonly expiresAt: number
  readonly preview: TerminalPortPreview | null
}

function unbracketHost(host: string) {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/** Turns a socket-table host into a safe browser authority without losing concrete binds. */
export function normalizeTerminalListenerHost(rawHost: string): string | null {
  const host = unbracketHost(rawHost.trim())
  if (WILDCARD_HOSTS.has(host)) return 'localhost'
  if (host.length === 0 || !/^[a-zA-Z0-9._:%-]+$/.test(host)) return null
  const authority = host.includes(':') ? `[${host}]` : host
  try {
    new URL(`http://${authority}:80/`)
    return host
  } catch {
    return null
  }
}

export function terminalPortPreviewUrl(
  protocol: 'http' | 'https',
  host: string,
  port: number,
): string | null {
  const normalizedHost = normalizeTerminalListenerHost(host)
  if (
    normalizedHost === null ||
    !Number.isInteger(port) ||
    port <= 0 ||
    port >= TCP_PORT_UPPER_BOUND
  ) {
    return null
  }
  const authority = normalizedHost.includes(':') ? `[${normalizedHost}]` : normalizedHost
  return new URL(`${protocol}://${authority}:${String(port)}/`).href
}

function isBrowserDocument(response: Response) {
  const location = response.headers.get('location')?.trim()
  if (NAVIGATION_REDIRECT_STATUSES.has(response.status) && location) return true
  if (
    response.status < HTTP_SUCCESS_STATUS_MIN ||
    response.status >= HTTP_SUCCESS_STATUS_UPPER_BOUND ||
    NO_CONTENT_STATUS.has(response.status)
  ) {
    return false
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  return contentType === 'text/html' || contentType === 'application/xhtml+xml'
}

async function cancelResponseBody(response: Response) {
  await response.body?.cancel().catch(() => undefined)
}

function cacheIdentity(url: string, pid: number | null) {
  return `${url}\u0000${pid === null ? '' : String(pid)}`
}

function uniqueCandidates(candidates: readonly TerminalPortCandidate[]) {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.host}\u0000${String(candidate.port)}\u0000${String(candidate.pid)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  task: (value: Input) => Promise<Output>,
) {
  const output: Output[] = []
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      const value = values[index]
      if (value !== undefined) output[index] = await task(value)
    }
  }
  const workerCount = Math.min(concurrency, values.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return output
}

/** Cached, bounded HTTP(S) classifier shared by every terminal in one process scan. */
export class TerminalPortPreviewProber {
  private readonly cache = new Map<string, ProbeCacheEntry>()

  constructor(
    private readonly fetchPreview: TerminalPortPreviewFetch = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {}

  async probe(candidates: readonly TerminalPortCandidate[]) {
    this.pruneCache()
    const probed = await mapWithConcurrency(
      uniqueCandidates(candidates),
      TERMINAL.PORT_PREVIEW_PROBE_CONCURRENCY,
      (candidate) => this.probeCandidate(candidate),
    )
    return probed
      .filter((preview): preview is VerifiedTerminalPortPreview => preview !== null)
      .sort((left, right) => left.port - right.port || left.host.localeCompare(right.host))
  }

  private async probeCandidate(
    candidate: TerminalPortCandidate,
  ): Promise<VerifiedTerminalPortPreview | null> {
    for (const protocol of ['http', 'https'] as const) {
      const url = terminalPortPreviewUrl(protocol, candidate.host, candidate.port)
      if (url === null) continue
      const preview = await this.probeUrl(url, candidate)
      if (preview !== null) return { ...preview, pid: candidate.pid }
    }
    return null
  }

  private async probeUrl(url: string, candidate: TerminalPortCandidate) {
    const identity = cacheIdentity(url, candidate.pid)
    const cached = this.cache.get(identity)
    if (cached !== undefined && cached.expiresAt > this.now()) return cached.preview

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TERMINAL.PORT_PREVIEW_PROBE_TIMEOUT_MS)
    timeout.unref?.()
    let preview: TerminalPortPreview | null = null
    try {
      const response = await this.fetchPreview(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      })
      if (isBrowserDocument(response)) {
        preview = { host: candidate.host, port: candidate.port, url }
      }
      await cancelResponseBody(response)
    } catch {
      preview = null
    } finally {
      clearTimeout(timeout)
    }
    this.cache.set(identity, {
      expiresAt: this.now() + TERMINAL.PORT_PREVIEW_PROBE_CACHE_MS,
      preview,
    })
    this.pruneCache()
    return preview
  }

  private pruneCache() {
    const now = this.now()
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key)
    }
    while (this.cache.size > TERMINAL.PORT_PREVIEW_PROBE_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) return
      this.cache.delete(oldest)
    }
  }
}

export function commonDevPortCandidates(): readonly TerminalPortCandidate[] {
  return COMMON_DEV_PORTS.map((port) => ({ host: 'localhost', port, pid: null }))
}
