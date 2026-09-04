import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import { syntaxSourceFingerprint } from '@shared/syntax-highlighting-performance'
import type { SyntaxHighlightRequest, SyntaxHighlightResult, SyntaxPriority } from './protocol'

const HASH_SEPARATOR = '\u0000'
const UTF16_CODE_UNIT_BYTES = 2
const PRIORITY_RANK: Record<SyntaxPriority, number> = {
  visible: 0,
  'near-viewport': 1,
  background: 2,
}

export interface SyntaxQueuedRequest {
  readonly requestId: number
  readonly input: SyntaxHighlightRequest
  readonly cacheKey: string
  readonly sourceKey: string
  readonly resolve: (result: SyntaxHighlightResult) => void
  readonly enqueuedAt: number
  abortListener: (() => void) | null
}

export function resolveSyntaxQueuedRequest(
  request: SyntaxQueuedRequest,
  result: SyntaxHighlightResult,
) {
  if (request.abortListener && request.input.signal) {
    request.input.signal.removeEventListener('abort', request.abortListener)
    request.abortListener = null
  }
  request.resolve(result)
}

interface CacheEntry {
  readonly result: SyntaxHighlightResult
  readonly sourceBytes: number
  readonly source: string
}

export function syntaxSourceCacheKey(input: SyntaxHighlightRequest, languageRevision: string) {
  return [
    'shiki-4.3.1',
    input.language,
    languageRevision,
    input.theme,
    String(input.source.length),
    input.sourceFingerprint ?? syntaxSourceFingerprint(input.source),
  ].join(HASH_SEPARATOR)
}

export function syntaxRequestCacheKey(
  sourceKey: string,
  lineRange: SyntaxHighlightRequest['lineRange'],
) {
  return lineRange
    ? [sourceKey, String(lineRange.start), String(lineRange.end)].join(HASH_SEPARATOR)
    : sourceKey
}

export function syntaxWorkerCount() {
  return WORKSPACE_EDITOR_PERFORMANCE.SYNTAX_MAX_WORKERS
}

export function compareSyntaxQueuedRequests(left: SyntaxQueuedRequest, right: SyntaxQueuedRequest) {
  const priorityDifference =
    PRIORITY_RANK[left.input.priority ?? 'visible'] -
    PRIORITY_RANK[right.input.priority ?? 'visible']
  return priorityDifference === 0 ? left.enqueuedAt - right.enqueuedAt : priorityDifference
}

export class SyntaxResultCache {
  private readonly entries = new Map<string, CacheEntry>()
  private totalSourceBytes = 0

  get(key: string, source: string) {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.source !== source) {
      this.entries.delete(key)
      this.totalSourceBytes -= entry.sourceBytes
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.result
  }

  set(key: string, source: string, result: SyntaxHighlightResult) {
    const existing = this.entries.get(key)
    if (existing) {
      this.totalSourceBytes -= existing.sourceBytes
      this.entries.delete(key)
    }
    // Renderer strings are UTF-16. A conservative code-unit estimate keeps the
    // cache byte-bounded without re-encoding a full document on every viewport.
    const sourceBytes = source.length * UTF16_CODE_UNIT_BYTES
    this.entries.set(key, { result, sourceBytes, source })
    this.totalSourceBytes += sourceBytes
    while (
      this.entries.size > WORKSPACE_EDITOR_PERFORMANCE.SYNTAX_CACHE_MAX_ENTRIES ||
      this.totalSourceBytes > WORKSPACE_EDITOR_PERFORMANCE.SYNTAX_CACHE_MAX_SOURCE_BYTES
    ) {
      const oldest = this.entries.entries().next()
      if (oldest.done) break
      this.entries.delete(oldest.value[0])
      this.totalSourceBytes -= oldest.value[1].sourceBytes
    }
  }

  clear() {
    this.entries.clear()
    this.totalSourceBytes = 0
  }
}
