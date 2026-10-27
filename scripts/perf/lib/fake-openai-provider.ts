import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * A local OpenAI-compatible chat-completions endpoint for measurements: no network, no cost, and
 * every request body is kept. A responder decides what each request streams back.
 */
export interface FakeProviderRequest {
  readonly body: Record<string, unknown>
  readonly rawLength: number
  readonly receivedAt: number
}

export interface StreamWriter {
  readonly text: (chunk: string) => void
  readonly toolCalls: (calls: readonly { readonly name: string; readonly arguments: object }[]) => void
  readonly end: () => void
}

export type FakeResponder = (request: FakeProviderRequest, stream: StreamWriter) => Promise<void>

export const FAKE_PROVIDER_ID = 'perf-local'
export const FAKE_MODEL_ID = 'perf-model'
export const FAKE_MODEL_REFERENCE = `${FAKE_PROVIDER_ID}/${FAKE_MODEL_ID}`
const FAKE_CONTEXT_WINDOW = 200_000
const FAKE_MAX_TOKENS = 32_000
const EPHEMERAL_PORT = 0
const LOCALHOST = '127.0.0.1'
const HTTP_OK = 200
const JSON_INDENT = 2

function chunk(delta: object, finishReason: string | null) {
  const payload = {
    id: 'perf',
    object: 'chat.completion.chunk',
    created: 1,
    model: FAKE_MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(finishReason ? { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } } : {}),
  }
  return `data: ${JSON.stringify(payload)}\n\n`
}

function writer(response: ServerResponse): StreamWriter {
  let finish = 'stop'
  response.writeHead(HTTP_OK, { 'content-type': 'text/event-stream' })
  response.write(chunk({ role: 'assistant', content: '' }, null))
  return {
    text: (text) => response.write(chunk({ content: text }, null)),
    toolCalls: (calls) => {
      finish = 'tool_calls'
      calls.forEach((call, index) => {
        const toolCall = { index, id: `call_${String(Date.now())}_${String(index)}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }
        response.write(chunk({ tool_calls: [toolCall] }, null))
      })
    },
    end: () => {
      response.write(chunk({}, finish))
      response.end('data: [DONE]\n\n')
    },
  }
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve) => {
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => parts.push(part))
    request.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
  })
}

function parsedBody(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {}
  } catch {
    return {}
  }
}

export async function startFakeProvider(responder: FakeResponder) {
  const requests: FakeProviderRequest[] = []
  const server = createServer((request, response) => {
    void readBody(request).then(async (raw) => {
      const received = { body: parsedBody(raw), rawLength: raw.length, receivedAt: Date.now() }
      requests.push(received)
      const stream = writer(response)
      await responder(received, stream).catch(() => undefined)
      stream.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(EPHEMERAL_PORT, LOCALHOST, () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : EPHEMERAL_PORT
  return {
    baseUrl: `http://${LOCALHOST}:${String(port)}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** Registers the endpoint as a Pi provider and makes it the default model of the profile. */
export async function configureFakeProvider(agentDir: string, baseUrl: string) {
  await mkdir(agentDir, { recursive: true })
  const models = {
    providers: {
      [FAKE_PROVIDER_ID]: {
        baseUrl,
        api: 'openai-completions',
        apiKey: 'perf-key',
        models: [{ id: FAKE_MODEL_ID, contextWindow: FAKE_CONTEXT_WINDOW, maxTokens: FAKE_MAX_TOKENS }],
      },
    },
  }
  await writeFile(path.join(agentDir, 'models.json'), `${JSON.stringify(models, null, JSON_INDENT)}\n`)
  const settings = { defaultProvider: FAKE_PROVIDER_ID, defaultModel: FAKE_MODEL_ID }
  await writeFile(path.join(agentDir, 'settings.json'), `${JSON.stringify(settings, null, JSON_INDENT)}\n`)
}

/** Whether a request is OpenWaggle's Session title generation rather than an agent turn. */
export function isTitleRequest(request: FakeProviderRequest) {
  const tools = request.body.tools
  return !Array.isArray(tools) || tools.length === 0
}
