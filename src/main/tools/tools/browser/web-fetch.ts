import { z } from 'zod'
import { readBodyWithLimit, stripHtml } from '../../../utils/http'
import { defineOpenHiveTool } from '../../define-tool'

const DEFAULT_MAX_LENGTH = 50_000
const MAX_BODY_BYTES = 5 * 1024 * 1024 // 5 MB hard cap on response body

export const webFetchTool = defineOpenHiveTool({
  name: 'webFetch',
  description:
    'Fetch the content of a URL and return it as text. HTML is stripped to plain text. Useful for quick web lookups without starting a full browser.',
  needsApproval: true,
  inputSchema: z.object({
    url: z.string().describe('The URL to fetch (must be a valid http/https URL)'),
    maxLength: z
      .number()
      .optional()
      .describe('Maximum character length of the returned text (default 50000)'),
  }),
  async execute(args, context) {
    const maxLength = args.maxLength ?? DEFAULT_MAX_LENGTH
    const response = await fetch(args.url, {
      headers: { 'User-Agent': 'OpenHive/1.0' },
      signal: context.signal
        ? AbortSignal.any([context.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${args.url}`)
    }

    const contentType = response.headers.get('content-type') ?? ''
    const raw = await readBodyWithLimit(response, MAX_BODY_BYTES)

    let text: string
    if (contentType.includes('text/html')) {
      text = stripHtml(raw)
    } else {
      text = raw
    }

    if (text.length > maxLength) {
      text = `${text.slice(0, maxLength)}\n\n... [truncated — ${text.length} chars total, showing first ${maxLength}]`
    }

    return text
  },
})
