import { createSecureMcpFetch } from './runtime/secure-fetch'

export type RegistryResourceFetcher = (url: URL, init: RequestInit) => Promise<Response>

function declaredContentLength(response: Response) {
  const raw = response.headers.get('content-length')
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

async function readBoundedBody(response: Response, limitBytes: number) {
  const declared = declaredContentLength(response)
  if (declared !== undefined && declared > limitBytes) {
    throw new Error('MCP Registry download exceeded the safety limit.')
  }
  if (!response.body) return Buffer.alloc(0)

  const chunks: Uint8Array[] = []
  const reader = response.body.getReader()
  let totalBytes = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      totalBytes += result.value.byteLength
      if (totalBytes > limitBytes) {
        throw new Error('MCP Registry download exceeded the safety limit.')
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, totalBytes)
}

export async function fetchBoundedRegistryResource(input: {
  readonly url: URL
  readonly limitBytes: number
  readonly timeoutMs: number
  readonly accept: string
  readonly allowedDomains?: readonly string[]
  readonly fetchResource?: RegistryResourceFetcher
}) {
  const secureFetch = input.fetchResource
    ? undefined
    : createSecureMcpFetch({
        baseUrl: input.url,
        ...(input.allowedDomains ? { allowedDomains: input.allowedDomains } : {}),
      })
  const fetchResource = input.fetchResource ?? secureFetch
  if (!fetchResource) throw new Error('MCP Registry download transport is unavailable.')
  try {
    const response = await fetchResource(input.url, {
      method: 'GET',
      headers: { Accept: input.accept },
      signal: AbortSignal.timeout(input.timeoutMs),
    })
    if (!response.ok) {
      throw new Error(`MCP Registry download failed with HTTP ${String(response.status)}.`)
    }
    return readBoundedBody(response, input.limitBytes)
  } finally {
    await secureFetch?.close()
  }
}
