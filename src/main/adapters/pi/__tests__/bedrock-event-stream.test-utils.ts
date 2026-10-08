import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { crc32 } from 'node:zlib'
import type { AssistantMessageEvent } from '@earendil-works/pi-ai'
import { stream as streamBedrock } from '@earendil-works/pi-ai/api/bedrock-converse-stream'
import { AMAZON_BEDROCK_MODELS } from '@earendil-works/pi-ai/providers/amazon-bedrock.models'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'

/**
 * Drives Pi's real Bedrock Converse `stream()` against a loopback server that speaks the
 * AWS event-stream framing, so the real AWS SDK decoder and Pi's provider loop both run.
 */

const BEDROCK_MODEL = AMAZON_BEDROCK_MODELS['eu.anthropic.claude-haiku-4-5-20251001-v1:0']
const EVENT_STREAM_STRING_HEADER = 7
const DELTA_BYTES = 20

function eventStreamHeader(name: string, value: string) {
  const nameBytes = Buffer.from(name)
  const valueBytes = Buffer.from(value)
  const header = Buffer.alloc(1 + nameBytes.length + 1 + 2 + valueBytes.length)
  header.writeUInt8(nameBytes.length, 0)
  nameBytes.copy(header, 1)
  header.writeUInt8(EVENT_STREAM_STRING_HEADER, 1 + nameBytes.length)
  header.writeUInt16BE(valueBytes.length, 2 + nameBytes.length)
  valueBytes.copy(header, 4 + nameBytes.length)
  return header
}

/** One `application/vnd.amazon.eventstream` message, as Bedrock sends it. */
export function bedrockEventFrame(eventType: string, payload: unknown) {
  const headers = Buffer.concat([
    eventStreamHeader(':event-type', eventType),
    eventStreamHeader(':content-type', 'application/json'),
    eventStreamHeader(':message-type', 'event'),
  ])
  const body = Buffer.from(JSON.stringify(payload))
  const prelude = Buffer.alloc(8)
  prelude.writeUInt32BE(12 + headers.length + body.length + 4, 0)
  prelude.writeUInt32BE(headers.length, 4)
  const preludeCrc = Buffer.alloc(4)
  preludeCrc.writeUInt32BE(crc32(prelude), 0)
  const message = Buffer.concat([prelude, preludeCrc, headers, body])
  const messageCrc = Buffer.alloc(4)
  messageCrc.writeUInt32BE(crc32(message), 0)
  return Buffer.concat([message, messageCrc])
}

/** JSON arguments for a `write` tool call whose content is about `contentBytes` long. */
export function writeFileArguments(contentBytes: number) {
  const line = '  const value = "quoted\\tstring" + `template`; // a \\ backslash\n'
  return JSON.stringify({
    path: '/project/src/generated.ts',
    content: line.repeat(Math.ceil(contentBytes / line.length)),
  })
}

/** Splits JSON into the small deltas Bedrock streams tool input in. */
export function splitIntoDeltas(json: string) {
  const deltas: string[] = []
  for (let offset = 0; offset < json.length; offset += DELTA_BYTES) {
    deltas.push(json.slice(offset, offset + DELTA_BYTES))
  }
  return deltas
}

/** The Bedrock events of one assistant message holding a single `write` tool call. */
export function toolCallFrames(
  deltas: readonly string[],
  options: { readonly stopBlock: boolean },
) {
  return [
    bedrockEventFrame('messageStart', { role: 'assistant' }),
    bedrockEventFrame('contentBlockStart', {
      contentBlockIndex: 0,
      start: { toolUse: { toolUseId: 'tool-1', name: 'write' } },
    }),
    ...deltas.map((input) =>
      bedrockEventFrame('contentBlockDelta', {
        contentBlockIndex: 0,
        delta: { toolUse: { input } },
      }),
    ),
    ...(options.stopBlock ? [bedrockEventFrame('contentBlockStop', { contentBlockIndex: 0 })] : []),
    bedrockEventFrame('messageStop', { stopReason: 'tool_use' }),
    bedrockEventFrame('metadata', {
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      metrics: { latencyMs: 1 },
    }),
  ]
}

/**
 * Serves `body` with `contentType` to every request on a loopback port, runs `run` against
 * that base URL, and closes the server afterwards.
 */
export async function withLoopbackServer<T>(
  body: Buffer | string,
  contentType: string,
  run: (baseUrl: string) => Promise<T>,
) {
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'content-type': contentType, 'x-amzn-requestid': 'request-1' })
      response.end(body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address: AddressInfo | string | null = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Loopback provider server has no TCP address')
    }
    return await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/**
 * Streams `frames` through Pi's Bedrock provider and hands every Pi assistant event to
 * `onEvent`. Resolves with Pi's final assistant message.
 */
export async function streamBedrockFrames(
  frames: readonly Buffer[],
  onEvent: (event: AssistantMessageEvent) => void,
) {
  return withLoopbackServer(
    Buffer.concat(frames),
    'application/vnd.amazon.eventstream',
    async (baseUrl) => {
      const events = streamBedrock(
        { ...BEDROCK_MODEL, baseUrl },
        normalizeContext({ messages: [{ role: 'user', content: 'write the file', timestamp: 0 }] }),
        {
          region: 'eu-west-1',
          maxRetries: 0,
          env: {
            AWS_BEDROCK_SKIP_AUTH: '1',
            AWS_BEDROCK_FORCE_HTTP1: '1',
            no_proxy: '127.0.0.1',
            NO_PROXY: '127.0.0.1',
          },
        },
      )
      for await (const event of events) {
        onEvent(event)
      }
      return await events.result()
    },
  )
}
