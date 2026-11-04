import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * A loopback stand-in for the Anthropic Messages API, so captures can run real agent turns with
 * no network, no account and no cost. The scratch Pi agent directory routes the built-in
 * `anthropic` provider here (`models.json` `baseUrl` + a placeholder key), which keeps the real
 * model names and context windows in the UI.
 */
export interface FakeModelRequest {
  readonly model: string
  /** The system prompt and every message text of the request, joined. */
  readonly text: string
  /** The text of the request's last user message. */
  readonly lastUserText: string
  readonly hasTools: boolean
}

export interface FakeModelReply {
  readonly text: string
  /** Input tokens the reply reports, which the context meter and session cost read. */
  readonly inputTokens?: number
  /** Leave the stream open after the text, so the Run stays in progress until `release()`. */
  readonly hold?: boolean
}

export type FakeModelResponder = (request: FakeModelRequest) => FakeModelReply

const LOCALHOST = '127.0.0.1'
const EPHEMERAL_PORT = 0
const HTTP_OK = 200
const HTTP_NOT_FOUND = 404
const DEFAULT_INPUT_TOKENS = 1_200
const CHARACTERS_PER_TOKEN = 4
const STREAM_CHUNK_CHARACTERS = 48
const JSON_INDENT = 2
/** Any non-empty key makes Pi treat the provider as connected; this one is never sent anywhere else. */
const PLACEHOLDER_API_KEY = 'sk-ant-screenshot-fixture'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
}

function parseRequest(raw: string): FakeModelRequest {
  let body: unknown = {}
  try {
    body = JSON.parse(raw)
  } catch {
    body = {}
  }
  const record = isRecord(body) ? body : {}
  const messages = Array.isArray(record.messages) ? record.messages : []
  const texts = messages.map((message) => (isRecord(message) ? textOf(message.content) : ''))
  const userMessages = messages.filter((message) => isRecord(message) && message.role === 'user')
  const lastUser = userMessages.at(-1)
  return {
    model: typeof record.model === 'string' ? record.model : '',
    text: [textOf(record.system), ...texts].join('\n'),
    lastUserText: isRecord(lastUser) ? textOf(lastUser.content) : '',
    hasTools: Array.isArray(record.tools) && record.tools.length > 0,
  }
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve) => {
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => parts.push(part))
    request.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
  })
}

function send(response: ServerResponse, event: string, data: object) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function outputTokensOf(reply: FakeModelReply) {
  return Math.max(1, Math.ceil(reply.text.length / CHARACTERS_PER_TOKEN))
}

function streamReply(response: ServerResponse, model: string, reply: FakeModelReply) {
  const inputTokens = reply.inputTokens ?? DEFAULT_INPUT_TOKENS
  const outputTokens = outputTokensOf(reply)
  response.writeHead(HTTP_OK, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  send(response, 'message_start', {
    type: 'message_start',
    message: {
      id: `msg_fixture_${String(Date.now())}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 1 },
    },
  })
  send(response, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })
  for (let start = 0; start < reply.text.length; start += STREAM_CHUNK_CHARACTERS) {
    send(response, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: reply.text.slice(start, start + STREAM_CHUNK_CHARACTERS) },
    })
  }
  if (reply.hold) return
  finishReply(response, outputTokens)
}

function finishReply(response: ServerResponse, outputTokens: number) {
  send(response, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  send(response, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: outputTokens },
  })
  send(response, 'message_stop', { type: 'message_stop' })
  response.end()
}

export async function startFakeAnthropic(responder: FakeModelResponder) {
  const requests: FakeModelRequest[] = []
  const held = new Map<ServerResponse, FakeModelReply>()
  const server = createServer((request, response) => {
    void readBody(request).then((raw) => {
      if (request.method !== 'POST' || !request.url?.includes('/messages')) {
        response.writeHead(HTTP_NOT_FOUND).end()
        return
      }
      const parsed = parseRequest(raw)
      requests.push(parsed)
      const reply = responder(parsed)
      if (reply.hold) held.set(response, reply)
      streamReply(response, parsed.model, reply)
    })
  })
  await new Promise<void>((resolve) => server.listen(EPHEMERAL_PORT, LOCALHOST, () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : EPHEMERAL_PORT
  return {
    baseUrl: `http://${LOCALHOST}:${String(port)}`,
    requests,
    /** Finishes every held reply as an ordinary end of turn. */
    release: () => {
      for (const [response, reply] of held) finishReply(response, outputTokensOf(reply))
      held.clear()
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const response of held.keys()) response.destroy()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** Routes Pi's built-in Anthropic provider to the fake endpoint with a placeholder key. */
export async function configureFakeAnthropic(piAgentDir: string, baseUrl: string) {
  await fs.mkdir(piAgentDir, { recursive: true })
  const models = { providers: { anthropic: { baseUrl, apiKey: PLACEHOLDER_API_KEY } } }
  await fs.writeFile(
    path.join(piAgentDir, 'models.json'),
    `${JSON.stringify(models, null, JSON_INDENT)}\n`,
    'utf8',
  )
}
