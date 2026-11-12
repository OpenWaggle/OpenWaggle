import http from 'node:http'
import type { Socket } from 'node:net'
import { LOOPBACK_HOST, listenOnLoopback } from './website-screenshot-loopback'
import {
  type FinishHeldReply,
  type ScriptedReply,
  sendErrorReply,
  streamAnthropicReply,
  streamOpenAiReply,
} from './website-screenshot-model-wire'

export type { ScriptedReply } from './website-screenshot-model-wire'

/**
 * The one scripted model behind every real Run in the website screenshots, so they can show
 * states only a Run produces (an approval request, a busy Session with queued follow-ups, a failed
 * Run, a live Waggle) with no provider account, network or cost. One loopback server speaks both
 * OpenAI Chat Completions and Anthropic Messages; the scratch Pi agent directory sends the
 * `openai` and `anthropic` providers to it (`website-screenshot-pi-agent.ts`), and the app, Pi and
 * the Session Host run unchanged.
 */

/** A request in either wire format, reduced to what the scripts choose replies by. */
export interface ModelMessage {
  readonly role: 'user' | 'assistant' | 'tool'
  readonly text: string
}

export interface ModelRequest {
  readonly model: string
  readonly system: string
  readonly messages: readonly ModelMessage[]
}

export interface ModelScenario {
  /** Text in one of the conversation's user messages that selects this scenario. */
  readonly match: string
  /** The title the Title model gives a Session that opens with this scenario. */
  readonly title: string
  /**
   * One reply per assistant turn after the matching user message (the last one repeats), or a
   * function of the request and that turn number.
   */
  readonly replies:
    | readonly ScriptedReply[]
    | ((request: ModelRequest, turn: number) => ScriptedReply)
}

export interface FixtureModelServer {
  /** The OpenAI-compatible base URL, ending in `/v1`. */
  readonly openAiBaseUrl: string
  /** The Anthropic base URL; the SDK adds `/v1/messages`. */
  readonly anthropicBaseUrl: string
  /**
   * Finishes the held replies of the scenario with this `match` as ordinary ends of turn, now
   * and from then on: a later held reply of that scenario finishes as soon as it is streamed.
   */
  release(match: string): void
  /** Stops the server; replies still held open are cut off. */
  close(): Promise<void>
}

const HTTP_NOT_FOUND = 404
const HTTP_BAD_REQUEST = 400
/** Any free port: nothing in the images shows the model server's address. */
const ANY_FREE_PORT = 0
/** The Host's title prompts (`session-title-prompts.ts`) open with one of these. */
const TITLE_PROMPT_PREFIXES = ['Generate a title', 'Regenerate the title'] as const
const FALLBACK_TITLE = 'Review the project'
const FALLBACK_REPLY: ScriptedReply = {
  kind: 'text',
  text: 'I can help with that. What would you like me to look at first?',
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function partsOf(content: unknown): readonly unknown[] {
  return Array.isArray(content) ? content : []
}

function textOf(content: unknown) {
  if (typeof content === 'string') return content
  return partsOf(content)
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .join('\n')
}

function modelOf(body: unknown) {
  return isRecord(body) && typeof body.model === 'string' ? body.model : ''
}

function bodyMessages(body: unknown) {
  return isRecord(body) ? partsOf(body.messages).filter(isRecord) : []
}

/** A Chat Completions body: system and developer messages make up the system text. */
export function parseOpenAiRequest(body: unknown): ModelRequest {
  const messages = bodyMessages(body)
  const isSystem = (role: unknown) => role === 'system' || role === 'developer'
  return {
    model: modelOf(body),
    system: messages
      .filter((message) => isSystem(message.role))
      .map((message) => textOf(message.content))
      .join('\n'),
    messages: messages.flatMap((message) =>
      message.role === 'user' || message.role === 'assistant' || message.role === 'tool'
        ? [{ role: message.role, text: textOf(message.content) }]
        : [],
    ),
  }
}

/** An Anthropic Messages body: a user message made only of tool results counts as a tool turn. */
export function parseAnthropicRequest(body: unknown): ModelRequest {
  const isToolResult = (part: unknown) => isRecord(part) && part.type === 'tool_result'
  return {
    model: modelOf(body),
    system: isRecord(body) ? textOf(body.system) : '',
    messages: bodyMessages(body).flatMap((message): ModelMessage[] => {
      if (message.role === 'assistant') {
        return [{ role: 'assistant', text: textOf(message.content) }]
      }
      if (message.role !== 'user') return []
      const parts = partsOf(message.content)
      const toolTurn = parts.length > 0 && parts.every(isToolResult)
      return [{ role: toolTurn ? 'tool' : 'user', text: textOf(message.content) }]
    }),
  }
}

function findScenario(scenarios: readonly ModelScenario[], text: string) {
  return scenarios.find((scenario) => text.includes(scenario.match)) ?? null
}

/** The scenario a request belongs to: the latest user message that names one. */
function scenarioTurn(scenarios: readonly ModelScenario[], request: ModelRequest) {
  const { messages } = request
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    const scenario = findScenario(scenarios, message.text)
    if (!scenario) continue
    const turn = messages.slice(index + 1).filter((later) => later.role === 'assistant').length
    return { scenario, turn }
  }
  return null
}

function isTitleRequest(request: ModelRequest) {
  return TITLE_PROMPT_PREFIXES.some((prefix) => request.system.startsWith(prefix))
}

/** The reply a request gets: a title, the scenario's reply for its turn, or a fallback. */
export function scriptedReply(
  scenarios: readonly ModelScenario[],
  request: ModelRequest,
): ScriptedReply {
  if (isTitleRequest(request)) {
    const title =
      request.messages
        .filter((message) => message.role === 'user')
        .map((message) => findScenario(scenarios, message.text))
        .find((scenario) => scenario !== null)?.title ?? FALLBACK_TITLE
    return { kind: 'text', text: JSON.stringify({ title, needsRefinement: false }) }
  }
  const found = scenarioTurn(scenarios, request)
  if (!found) return FALLBACK_REPLY
  const { replies } = found.scenario
  if (typeof replies === 'function') return replies(request, found.turn)
  return replies[found.turn] ?? replies.at(-1) ?? FALLBACK_REPLY
}

/** The text of the request's last user message, such as a Waggle turn's instructions. */
export function lastUserText(request: ModelRequest) {
  return request.messages.findLast((message) => message.role === 'user')?.text ?? ''
}

type WireFormat = 'openai' | 'anthropic'

function wireFormatOf(request: http.IncomingMessage): WireFormat | null {
  if (request.method !== 'POST') return null
  // The Anthropic SDK may add a query, such as `?beta=true`.
  const { pathname } = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`)
  if (pathname === '/v1/chat/completions') return 'openai'
  if (pathname === '/v1/messages') return 'anthropic'
  return null
}

async function readBody(request: http.IncomingMessage) {
  const parts: Buffer[] = []
  for await (const part of request) {
    parts.push(Buffer.isBuffer(part) ? part : Buffer.from(String(part)))
  }
  return Buffer.concat(parts).toString('utf8')
}

interface HeldReply {
  readonly match: string | null
  readonly finish: FinishHeldReply
}

/** Starts the endpoint on a loopback port. Any other path, such as `/v1/responses`, is a 404. */
export async function startFixtureModelServer(
  scenarios: readonly ModelScenario[],
  /** Sees each request and the reply chosen for it, for diagnosing a capture. */
  onRequest?: (request: ModelRequest, reply: ScriptedReply) => void,
): Promise<FixtureModelServer> {
  const sockets = new Set<Socket>()
  const held = new Set<HeldReply>()
  const released = new Set<string>()
  const answer = async (format: WireFormat, raw: string, response: http.ServerResponse) => {
    const body: unknown = JSON.parse(raw)
    const request = format === 'openai' ? parseOpenAiRequest(body) : parseAnthropicRequest(body)
    const reply = scriptedReply(scenarios, request)
    onRequest?.(request, reply)
    if (reply.kind === 'error') return sendErrorReply(response, format, reply)
    const finish =
      format === 'openai'
        ? await streamOpenAiReply(response, reply)
        : await streamAnthropicReply(response, request.model, reply)
    if (!finish) return
    const entry = { match: scenarioTurn(scenarios, request)?.scenario.match ?? null, finish }
    if (entry.match !== null && released.has(entry.match)) {
      finish()
      return
    }
    held.add(entry)
    response.on('close', () => held.delete(entry))
  }
  const server = http.createServer((request, response) => {
    const format = wireFormatOf(request)
    if (!format) {
      response.writeHead(HTTP_NOT_FOUND).end()
      return
    }
    void readBody(request)
      .then((raw) => answer(format, raw, response))
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
  const port = await listenOnLoopback(server, ANY_FREE_PORT)
  const origin = `http://${LOOPBACK_HOST}:${String(port)}`
  return {
    openAiBaseUrl: `${origin}/v1`,
    anthropicBaseUrl: origin,
    release: (match) => {
      released.add(match)
      for (const entry of held) {
        if (entry.match !== match) continue
        held.delete(entry)
        entry.finish()
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}
