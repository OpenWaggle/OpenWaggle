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

