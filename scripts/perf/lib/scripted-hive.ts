import type { FakeProviderRequest, StreamWriter } from './fake-openai-provider'

/**
 * A scripted Hive for the fake provider: the Queen spawns Workers (at most four, the Host's
 * per-parent limit; Worker 1 spawns the rest), then every Session runs one long `bash sleep`, so
 * `workers + 1` Runs are active at once, and then answers.
 */
// v1 prints the Session identity as compact JSON and the Run identity indented; match both.
const SESSION_ID_PATTERN = /"sessionId":\s*"([^"]+)"/
const PARENT_SESSION_PATTERN = /"parentSessionId":\s*"/
const FIRST_WORKER_PATTERN = /"sessionTitle":\s*"Memory Worker 1"/
/** The Host refuses a fifth concurrently running child of one parent (`parent_capacity_reached`). */
const PARENT_CONCURRENCY_LIMIT = 4

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function messagesOf(request: FakeProviderRequest) {
  const messages = request.body.messages
  return Array.isArray(messages) ? messages.filter(isRecord) : []
}

function textOf(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('\n')
}

export function systemPromptOf(request: FakeProviderRequest) {
  return messagesOf(request)
    .filter((message) => message.role === 'system' || message.role === 'developer')
    .map((message) => textOf(message.content))
    .join('\n')
}

function spawnCalls(first: number, count: number, model: string) {
  return Array.from({ length: count }, (_, index) => ({
    name: 'hive',
    arguments: {
      action: 'spawn',
      objective: `Hold a Run open for the memory measurement (${String(first + index)}).`,
      title: `Memory Worker ${String(first + index)}`,
      workspace: 'share-parent',
      authorization: 'yolo',
      model,
    },
  }))
}

export function createScriptedHive(input: {
  readonly workers: number
  readonly sleepSeconds: number
  /** The Workers' model; the fake provider's, so no Worker reaches a real one. */
  readonly model: string
}) {
  const direct = Math.min(input.workers, PARENT_CONCURRENCY_LIMIT)
  const nested = input.workers - direct
  const sleeping = new Set<string>()
  let allSleeping: () => void = () => {}
  const allActive = new Promise<void>((resolve) => {
    allSleeping = resolve
  })
  const sleep = (stream: StreamWriter, sessionId: string) => {
    sleeping.add(sessionId)
    if (sleeping.size >= input.workers + 1) allSleeping()
    stream.toolCalls([{ name: 'bash', arguments: { command: `sleep ${String(input.sleepSeconds)}` } }])
  }
  /** Spawns `count` children first when it has to, then sleeps once, then answers. */
  const script = (stream: StreamWriter, sessionId: string, answered: number, children: readonly ReturnType<typeof spawnCalls>[number][]) => {
    const spawns = children.length > 0 ? 1 : 0
    if (answered < spawns) return stream.toolCalls(children)
    if (answered === spawns) return sleep(stream, sessionId)
    return stream.text('Done.')
  }
  const respond = async (request: FakeProviderRequest, stream: StreamWriter) => {
    const system = systemPromptOf(request)
    const sessionId = SESSION_ID_PATTERN.exec(system)?.[1] ?? 'unknown'
    const messages = messagesOf(request)
    const answered = messages.filter((message) => message.role === 'assistant').length
    if (!PARENT_SESSION_PATTERN.test(system)) {
      return script(stream, sessionId, answered, spawnCalls(1, direct, input.model))
    }
    const isFirstWorker = messages.some((message) => FIRST_WORKER_PATTERN.test(textOf(message.content)))
    return script(stream, sessionId, answered, isFirstWorker ? spawnCalls(direct + 1, nested, input.model) : [])
  }
  return { respond, allActive, sleeping }
}
