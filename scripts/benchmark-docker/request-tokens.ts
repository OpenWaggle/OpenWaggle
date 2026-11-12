import { Schema } from '@shared/schema'
import { countO200kTokens } from '../perf/first-turn-prefix/prefix-tokens'
import { objectFields, unknownField } from '../support/object-fields'

/** The prefix fields of a model request in any wire format; each is checked where it is read. */
const modelRequestSchema = Schema.Struct({
  messages: unknownField,
  input: unknownField,
  system: unknownField,
  instructions: unknownField,
  tools: unknownField,
})
export type ModelRequestPrefix = Schema.Schema.Type<typeof modelRequestSchema>

const textPartSchema = Schema.Struct({ text: Schema.String })
const systemMessageSchema = Schema.Struct({
  role: Schema.Literal('system', 'developer'),
  content: unknownField,
})
/** One proxy log record: the POSTed request and its arrival order. */
const proxyRecordSchema = Schema.Struct({
  command: Schema.Literal('POST'),
  request: Schema.Unknown,
  seq: unknownField,
})

function textOf(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part: unknown) => (Schema.is(textPartSchema)(part) ? part.text : ''))
    .join('\n')
}

/** System text of every wire format: `system`, `instructions`, or system/developer messages. */
function systemText(request: ModelRequestPrefix) {
  const messages: readonly unknown[] = Array.isArray(request.messages)
    ? request.messages
    : Array.isArray(request.input)
      ? request.input
      : []
  const fromMessages = messages.flatMap((message) =>
    Schema.is(systemMessageSchema)(message) ? [textOf(message.content)] : [],
  )
  return [
    textOf(request.system),
    typeof request.instructions === 'string' ? request.instructions : '',
    ...fromMessages,
  ]
    .filter((text) => text.length > 0)
    .join('\n')
}

/** o200k tokens of one model request's prefix: its system text and its tool declarations. */
export function requestTokens(request: ModelRequestPrefix) {
  const system = systemText(request)
  const tools: readonly unknown[] = Array.isArray(request.tools) ? request.tools : []
  const systemO200k = countO200kTokens(system)
  const toolsO200k = tools.reduce(
    (total: number, tool: unknown) => total + countO200kTokens(JSON.stringify(tool)),
    0,
  )
  return { systemO200k, toolsO200k, toolCount: tools.length, prefixO200k: systemO200k + toolsO200k }
}

/**
 * The first model request of a proxy log slice, by arrival: the proxy writes each record when its
 * response ends, so a short title call can precede the first model call in the file. Records
 * carry `seq`, the arrival order; records without one (older logs) keep their file order.
 */
export function firstRequestOf(lines: readonly string[]) {
  const posts: {
    readonly request: ModelRequestPrefix
    readonly seq: number
    readonly index: number
  }[] = []
  for (const [index, line] of lines.filter((candidate) => candidate.trim() !== '').entries()) {
    const record = objectFields(proxyRecordSchema, JSON.parse(line))
    const request = objectFields(modelRequestSchema, record?.request)
    if (record === undefined || request === undefined) continue
    posts.push({
      request,
      seq: typeof record.seq === 'number' ? record.seq : Number.POSITIVE_INFINITY,
      index,
    })
  }
  posts.sort((left, right) => left.seq - right.seq || left.index - right.index)
  return posts[0]?.request ?? null
}
