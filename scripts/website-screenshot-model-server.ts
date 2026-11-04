import http from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

/**
 * A scripted stand-in for an OpenAI-compatible Chat Completions endpoint, so the website
 * screenshots can show states only a real Run produces (an approval request, a busy Session with
 * queued follow-ups, a failed Run) without a provider account or network access. The scratch Pi
 * agent directory points one model at it (`website-screenshot-pi-agent.ts`); the app, Pi and the
 * Session Host run unchanged.
 */

interface ScriptedToolCall {
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
}

export type ScriptedReply =
  | { readonly kind: 'text'; readonly text: string; readonly reasoning?: string }
  | { readonly kind: 'tools'; readonly calls: readonly ScriptedToolCall[]; readonly text?: string }
  /** Streams `reasoning`, then keeps the response open until the server closes. */
  | { readonly kind: 'hold'; readonly reasoning: string }
  | {
      readonly kind: 'error'
      readonly status: number
      readonly message: string
      /** Answers this late, so the capture can leave the Session first. */
      readonly delayMs?: number
    }

export interface ModelScenario {
  /** Text in one of the conversation's user messages that selects this scenario. */
  readonly match: string
  /** The title the Title model gives a Session that opens with this scenario. */
  readonly title: string
  /** One reply per assistant turn after the matching user message. */
  readonly replies: readonly ScriptedReply[]
}

interface FixtureModelServer {
  /** The OpenAI-compatible base URL, ending in `/v1`. */
  readonly baseUrl: string
  close(): Promise<void>
}

const COMPLETIONS_PATH = '/v1/chat/completions'
const HTTP_OK = 200
const HTTP_NOT_FOUND = 404
const HTTP_BAD_REQUEST = 400
const TITLE_PROMPT_PREFIX = 'Generate a title'
const FALLBACK_TITLE = 'Review the project'
/** Text arrives in a few pieces, as from a real provider. */
const STREAM_PIECE_CHARS = 48
const STREAM_PIECE_DELAY_MS = 15
const HOLD_KEEPALIVE_MS = 2_000
const MS_PER_SECOND = 1000
const FIXTURE_PROMPT_TOKENS = 18_400
const FIXTURE_COMPLETION_TOKENS = 220

interface ChatMessage {
  readonly role: string
  readonly content: unknown
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageText(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .join('\n')
}

function chatMessages(body: unknown): readonly ChatMessage[] {
  if (!isRecord(body) || !Array.isArray(body.messages)) return []
  return body.messages.flatMap((message) =>
    isRecord(message) && typeof message.role === 'string'
      ? [{ role: message.role, content: message.content }]
      : [],
  )
}

function findScenario(scenarios: readonly ModelScenario[], text: string) {
  return scenarios.find((scenario) => text.includes(scenario.match)) ?? null
}

/** The scenario a request belongs to and how many assistant turns it has had since. */
export function scriptedReply(scenarios: readonly ModelScenario[], body: unknown): ScriptedReply {
  const messages = chatMessages(body)
  const system = messages.find(
    (message) => message.role === 'system' || message.role === 'developer',
  )
  const userTexts = messages
    .filter((message) => message.role === 'user')
    .map((message) => messageText(message.content))
  if (system && messageText(system.content).startsWith(TITLE_PROMPT_PREFIX)) {
    const scenario = userTexts
      .map((text) => findScenario(scenarios, text))
      .find((found) => found !== null)
    return {
      kind: 'text',
      text: JSON.stringify({ title: scenario?.title ?? FALLBACK_TITLE, needsRefinement: false }),
    }
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    const scenario = findScenario(scenarios, messageText(message.content))
    if (!scenario) continue
    const turn = messages.slice(index + 1).filter((later) => later.role === 'assistant').length
    return (
      scenario.replies[turn] ??
      scenario.replies[scenario.replies.length - 1] ?? { kind: 'text', text: 'Done.' }
    )
  }
  return { kind: 'text', text: 'I can help with that. What would you like me to look at first?' }
}

function chunk(delta: Readonly<Record<string, unknown>>, finishReason: string | null = null) {
  return {
    id: 'chatcmpl-website-fixture',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / MS_PER_SECOND),
    model: 'fixture',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

function pieces(text: string) {
  const parts: string[] = []
  for (let start = 0; start < text.length; start += STREAM_PIECE_CHARS) {
    parts.push(text.slice(start, start + STREAM_PIECE_CHARS))
  }
  return parts
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function streamReply(response: http.ServerResponse, reply: ScriptedReply) {
  if (reply.kind === 'error') {
    await delay(reply.delayMs ?? 0)
    response.writeHead(reply.status, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({ error: { message: reply.message, type: 'invalid_request_error' } }),
    )
    return
  }
  response.writeHead(HTTP_OK, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  const send = (payload: unknown) => response.write(`data: ${JSON.stringify(payload)}\n\n`)
  send(chunk({ role: 'assistant', content: '' }))
  const reasoning = reply.kind === 'text' || reply.kind === 'hold' ? reply.reasoning : undefined
  for (const piece of pieces(reasoning ?? '')) {
    send(chunk({ reasoning_content: piece }))
    await delay(STREAM_PIECE_DELAY_MS)
  }
  // Held open: the Run stays busy until the capture is done with it. Empty chunks keep the
  // stream from looking stalled, which would make Pi retry (the sidebar then says Connecting).
  if (reply.kind === 'hold') {
    const keepAlive = setInterval(() => send(chunk({})), HOLD_KEEPALIVE_MS)
    response.on('close', () => clearInterval(keepAlive))
    return
  }
  const text = reply.text ?? ''
  for (const piece of pieces(text)) {
    send(chunk({ content: piece }))
    await delay(STREAM_PIECE_DELAY_MS)
  }
  if (reply.kind === 'tools') {
    reply.calls.forEach((call, index) => {
      send(
        chunk({
          tool_calls: [
            {
              index,
              id: `call_website_${String(Date.now())}_${String(index)}`,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            },
          ],
        }),
      )
    })
  }
  send(chunk({}, reply.kind === 'tools' ? 'tool_calls' : 'stop'))
  send({
    ...chunk({}),
    choices: [],
    usage: {
      prompt_tokens: FIXTURE_PROMPT_TOKENS,
      completion_tokens: FIXTURE_COMPLETION_TOKENS,
      total_tokens: FIXTURE_PROMPT_TOKENS + FIXTURE_COMPLETION_TOKENS,
    },
  })
  response.end('data: [DONE]\n\n')
}

async function readBody(request: http.IncomingMessage) {
  const parts: Buffer[] = []
  for await (const part of request)
    parts.push(Buffer.isBuffer(part) ? part : Buffer.from(String(part)))
  return Buffer.concat(parts).toString('utf8')
}

/** Starts the endpoint on a loopback port; `close()` also ends responses still held open. */
export async function startFixtureModelServer(
  scenarios: readonly ModelScenario[],
  /** Sees each request body and the reply chosen for it, for diagnosing a capture. */
  onRequest?: (body: unknown, reply: ScriptedReply) => void,
): Promise<FixtureModelServer> {
  const sockets = new Set<Socket>()
  const server = http.createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== COMPLETIONS_PATH) {
      response.writeHead(HTTP_NOT_FOUND).end()
      return
    }
    void readBody(request)
      .then(async (raw) => {
        let body: unknown
        try {
          body = JSON.parse(raw)
        } catch {
          response.writeHead(HTTP_BAD_REQUEST).end()
          return
        }
        const reply = scriptedReply(scenarios, body)
        onRequest?.(body, reply)
        await streamReply(response, reply)
      })
      .catch((error: unknown) => {
        console.error('[website-shots] fixture model request failed', error)
        if (!response.headersSent) response.writeHead(HTTP_BAD_REQUEST)
        response.end()
      })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address: AddressInfo | string | null = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('Fixture model server has no port.')
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}
