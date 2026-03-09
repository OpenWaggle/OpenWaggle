import { BYTES_PER_KIBIBYTE } from '@shared/constants/constants'
import { Schema } from '@shared/schema'
import { readBodyWithLimit, stripHtml } from '../../utils/http'
import { defineOpenWaggleTool } from '../define-tool'

const MODULE_VALUE_5 = 5
const TIMEOUT_ARG_1 = 30_000

const DEFAULT_MAX_LENGTH = 50_000
const MAX_BODY_BYTES = MODULE_VALUE_5 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE // 5 MB hard cap on response body

export const webFetchTool = defineOpenWaggleTool({
  name: 'webFetch',
  description:
    'Fetch the content of a URL and return it as text. HTML is stripped to plain text. Useful for quick web lookups without starting a full browser.',
  needsApproval: true,
  inputSchema: Schema.Struct({
    url: Schema.String.annotations({
      description: 'The URL to fetch (must be a valid http/https URL)',
    }),
    maxLength: Schema.optional(
      Schema.Number.annotations({
        description: 'Maximum character length of the returned text (default 50000)',
      }),
    ),
  }),
  async execute(args, context) {
    const maxLength = args.maxLength ?? DEFAULT_MAX_LENGTH
    const response = await fetch(args.url, {
      headers: { 'User-Agent': 'OpenWaggle/1.0' },
      signal: context.signal
        ? AbortSignal.any([context.signal, AbortSignal.timeout(TIMEOUT_ARG_1)])
        : AbortSignal.timeout(TIMEOUT_ARG_1),
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
