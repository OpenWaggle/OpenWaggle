import type http from 'node:http'

/**
 * The two wire formats the screenshot model speaks: OpenAI Chat Completions and Anthropic
 * Messages, both as server-sent events. Each encoder streams one scripted reply; a held reply
 * stops before its end and returns the function that finishes it as an ordinary end of turn.
 */

interface ScriptedToolCall {
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
}

interface ReplyUsage {
  /** Input tokens the reply reports, which the context meter and the session cost read. */
  readonly inputTokens?: number
}

export type ScriptedReply =
  | (ReplyUsage & { readonly kind: 'text'; readonly text: string; readonly reasoning?: string })
  | (ReplyUsage & {
      readonly kind: 'tools'
      readonly calls: readonly ScriptedToolCall[]
      readonly text?: string
    })
  /**
   * Streams `reasoning` and `text`, then keeps the response open, so the Run stays busy until
   * the capture releases it (an ordinary end of turn) or the server closes.
   */
  | (ReplyUsage & { readonly kind: 'hold'; readonly reasoning?: string; readonly text?: string })
  | {
      readonly kind: 'error'
      readonly status: number
      readonly message: string
      /** Answers this late, so the capture can leave the Session first. */
      readonly delayMs?: number
    }

type StreamedReply = Exclude<ScriptedReply, { readonly kind: 'error' }>

const HTTP_OK = 200
/** Text arrives in a few pieces, as from a real provider. */
const STREAM_PIECE_CHARS = 48
const STREAM_PIECE_DELAY_MS = 15
/** A held stream sends something this often, so Pi never sees it as stalled and retries. */
const HOLD_KEEPALIVE_MS = 2_000
const MS_PER_SECOND = 1000
const DEFAULT_INPUT_TOKENS = 18_400
const CHARACTERS_PER_TOKEN = 4

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

function inputTokensOf(reply: StreamedReply) {
  return reply.inputTokens ?? DEFAULT_INPUT_TOKENS
}

function outputTokensOf(reply: StreamedReply) {
  const reasoning = reply.kind === 'tools' ? '' : (reply.reasoning ?? '')
  const text = reasoning + (reply.text ?? '')
  return Math.max(1, Math.ceil(text.length / CHARACTERS_PER_TOKEN))
}

function toolCallId(index: number) {
  return `call_website_${String(Date.now())}_${String(index)}`
}

function openEventStream(response: http.ServerResponse) {
  response.writeHead(HTTP_OK, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
}

/** Keeps a held stream alive and returns the function that stops doing so. */
function keepAlive(response: http.ServerResponse, ping: () => void) {
  const timer = setInterval(ping, HOLD_KEEPALIVE_MS)
  response.on('close', () => clearInterval(timer))
  return () => clearInterval(timer)
}

export type FinishHeldReply = () => void

/** Streams a reply as Chat Completions chunks; a held reply returns its finish. */
export async function streamOpenAiReply(response: http.ServerResponse, reply: StreamedReply) {
  const chunk = (delta: Readonly<Record<string, unknown>>, finishReason: string | null = null) => ({
    id: 'chatcmpl-website-fixture',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / MS_PER_SECOND),
    model: 'fixture',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })
  const send = (payload: unknown) => response.write(`data: ${JSON.stringify(payload)}\n\n`)
  openEventStream(response)
  send(chunk({ role: 'assistant', content: '' }))
  for (const piece of pieces(reply.kind === 'tools' ? '' : (reply.reasoning ?? ''))) {
    send(chunk({ reasoning_content: piece }))
    await delay(STREAM_PIECE_DELAY_MS)
  }
  for (const piece of pieces(reply.text ?? '')) {
    send(chunk({ content: piece }))
    await delay(STREAM_PIECE_DELAY_MS)
  }
  if (reply.kind === 'tools') {
    reply.calls.forEach((call, index) => {
      const fn = { name: call.name, arguments: JSON.stringify(call.arguments) }
      send(
        chunk({ tool_calls: [{ index, id: toolCallId(index), type: 'function', function: fn }] }),
      )
    })
  }
  const finish = () => {
    send(chunk({}, reply.kind === 'tools' ? 'tool_calls' : 'stop'))
    const prompt = inputTokensOf(reply)
    const completion = outputTokensOf(reply)
    send({
      ...chunk({}),
      choices: [],
      usage: {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
      },
    })
    response.end('data: [DONE]\n\n')
  }
  if (reply.kind !== 'hold') {
    finish()
    return null
  }
  // Empty chunks: a stream that looks stalled makes Pi retry, and the sidebar says Connecting.
  const stop = keepAlive(response, () => send(chunk({})))
  return () => {
    stop()
    finish()
  }
}

/** Streams a reply as Anthropic Messages events; a held reply returns its finish. */
export async function streamAnthropicReply(
  response: http.ServerResponse,
  model: string,
  reply: StreamedReply,
) {
  const send = (event: string, data: Readonly<Record<string, unknown>>) =>
    response.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`)
  let index = -1
  const startBlock = (block: Readonly<Record<string, unknown>>) => {
    index += 1
    send('content_block_start', { index, content_block: block })
  }
  const delta = (value: Readonly<Record<string, unknown>>) =>
    send('content_block_delta', { index, delta: value })
  const stopBlock = () => send('content_block_stop', { index })
  openEventStream(response)
  send('message_start', {
    message: {
      id: `msg_website_${String(Date.now())}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokensOf(reply), output_tokens: 1 },
    },
  })
  const reasoning = reply.kind === 'tools' ? '' : (reply.reasoning ?? '')
  if (reasoning) {
    startBlock({ type: 'thinking', thinking: '' })
    for (const piece of pieces(reasoning)) {
      delta({ type: 'thinking_delta', thinking: piece })
      await delay(STREAM_PIECE_DELAY_MS)
    }
    delta({ type: 'signature_delta', signature: 'website-fixture' })
    stopBlock()
  }
  if (reply.text) {
    startBlock({ type: 'text', text: '' })
    for (const piece of pieces(reply.text)) {
      delta({ type: 'text_delta', text: piece })
      await delay(STREAM_PIECE_DELAY_MS)
    }
  }
  const finish = () => {
    if (reply.text) stopBlock()
    if (reply.kind === 'tools') {
      reply.calls.forEach((call, callIndex) => {
        startBlock({ type: 'tool_use', id: toolCallId(callIndex), name: call.name, input: {} })
        delta({ type: 'input_json_delta', partial_json: JSON.stringify(call.arguments) })
        stopBlock()
      })
    }
    send('message_delta', {
      delta: { stop_reason: reply.kind === 'tools' ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: outputTokensOf(reply) },
    })
    send('message_stop', {})
    response.end()
  }
  if (reply.kind !== 'hold') {
    finish()
    return null
  }
  const stop = keepAlive(response, () => send('ping', {}))
  return () => {
    stop()
    finish()
  }
}

/** A provider refusal in the format the request came in. */
export async function sendErrorReply(
  response: http.ServerResponse,
  format: 'openai' | 'anthropic',
  reply: Extract<ScriptedReply, { readonly kind: 'error' }>,
) {
  await delay(reply.delayMs ?? 0)
  response.writeHead(reply.status, { 'content-type': 'application/json' })
  const error = { type: 'invalid_request_error', message: reply.message }
  response.end(JSON.stringify(format === 'openai' ? { error } : { type: 'error', error }))
}
