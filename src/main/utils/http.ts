/**
 * Shared HTTP utilities for fetching and processing web content.
 * Used by both the classic agent webFetch tool and orchestration executor webFetch.
 */

export async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let totalBytes = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      reader.cancel()
      chunks.push(decoder.decode(value, { stream: false }))
      break
    }
    chunks.push(decoder.decode(value, { stream: true }))
  }

  return chunks.join('')
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
