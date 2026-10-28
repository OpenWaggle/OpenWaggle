import { countO200kTokens } from '../perf/first-turn-prefix/prefix-tokens'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function textOf(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('\n')
}

/** System text of every wire format: `system`, `instructions`, or system/developer messages. */
function systemText(request: Record<string, unknown>) {
  const messages = Array.isArray(request.messages) ? request.messages : Array.isArray(request.input) ? request.input : []
  const fromMessages = messages
    .filter((message): message is Record<string, unknown> => isRecord(message) && (message.role === 'system' || message.role === 'developer'))
    .map((message) => textOf(message.content))
  return [textOf(request.system), typeof request.instructions === 'string' ? request.instructions : '', ...fromMessages]
    .filter((text) => text.length > 0)
    .join('\n')
}

/** o200k tokens of one model request's prefix: its system text and its tool declarations. */
export function requestTokens(request: Record<string, unknown>) {
  const system = systemText(request)
  const tools = Array.isArray(request.tools) ? request.tools : []
  const systemO200k = countO200kTokens(system)
  const toolsO200k = tools.reduce((total: number, tool: unknown) => total + countO200kTokens(JSON.stringify(tool)), 0)
  return { systemO200k, toolsO200k, toolCount: tools.length, prefixO200k: systemO200k + toolsO200k }
}


/**
 * The first model request of a proxy log slice, by arrival: the proxy writes each record when its
 * response ends, so a short title call can precede the first model call in the file. Records
 * carry `seq`, the arrival order; records without one (older logs) keep their file order.
 */
export function firstRequestOf(lines: readonly string[]) {
  const posts: { readonly request: Record<string, unknown>; readonly seq: number; readonly index: number }[] = []
  for (const [index, line] of lines.filter((candidate) => candidate.trim() !== '').entries()) {
    const record: unknown = JSON.parse(line)
    if (!isRecord(record) || record.command !== 'POST' || !isRecord(record.request)) continue
    posts.push({ request: record.request, seq: typeof record.seq === 'number' ? record.seq : Number.POSITIVE_INFINITY, index })
  }
  posts.sort((left, right) => left.seq - right.seq || left.index - right.index)
  return posts[0]?.request ?? null
}
