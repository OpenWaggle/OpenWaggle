import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { crc32 } from 'node:zlib'
import { stream as streamBedrock } from '@earendil-works/pi-ai/api/bedrock-converse-stream'
import { AMAZON_BEDROCK_MODELS } from '@earendil-works/pi-ai/providers/amazon-bedrock.models'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Pi's patched Bedrock Converse stream must not re-parse the whole partial tool-call JSON
 * on every delta (quadratic CPU, a source of multi-second event-loop stalls), yet must
 * still emit one `toolcall_delta` per Bedrock delta and finish with exact arguments.
 * The stream runs against a loopback server that speaks the AWS event-stream framing, so
 * the real AWS SDK decoder and Pi's provider loop are exercised end to end.
 */

const BEDROCK_MODEL = AMAZON_BEDROCK_MODELS['eu.anthropic.claude-haiku-4-5-20251001-v1:0']
const EVENT_STREAM_STRING_HEADER = 7
const DELTA_BYTES = 20

let server: Server | undefined

afterEach(async () => {
  const current = server
  server = undefined
  if (current) {
    await new Promise<void>((resolve) => current.close(() => resolve()))
  }
})

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
function eventFrame(eventType: string, payload: unknown) {
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

function writeFileArguments(contentBytes: number) {
  const line = '  const value = "quoted\\tstring" + `template`; // a \\ backslash\n'
  return JSON.stringify({
    path: '/project/src/generated.ts',
    content: line.repeat(Math.ceil(contentBytes / line.length)),
  })
}

function splitIntoDeltas(json: string) {
  const deltas: string[] = []
  for (let offset = 0; offset < json.length; offset += DELTA_BYTES) {
    deltas.push(json.slice(offset, offset + DELTA_BYTES))
  }
  return deltas
}

function toolCallFrames(deltas: readonly string[], options: { readonly stopBlock: boolean }) {
  return [
    eventFrame('messageStart', { role: 'assistant' }),
    eventFrame('contentBlockStart', {
      contentBlockIndex: 0,
      start: { toolUse: { toolUseId: 'tool-1', name: 'write' } },
    }),
    ...deltas.map((input) =>
      eventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { toolUse: { input } } }),
    ),
    ...(options.stopBlock ? [eventFrame('contentBlockStop', { contentBlockIndex: 0 })] : []),
    eventFrame('messageStop', { stopReason: 'tool_use' }),
    eventFrame('metadata', {
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      metrics: { latencyMs: 1 },
    }),
  ]
}

async function serveBedrockStream(frames: readonly Buffer[]) {
  const body = Buffer.concat(frames)
  const listening = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, {
        'content-type': 'application/vnd.amazon.eventstream',
        'x-amzn-requestid': 'request-1',
      })
      response.end(body)
    })
  })
  server = listening
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve))
  const address: AddressInfo | string | null = listening.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Loopback Bedrock server has no TCP address')
  }
  return `http://127.0.0.1:${address.port}`
}

async function streamToolCall(frames: readonly Buffer[]) {
  const baseUrl = await serveBedrockStream(frames)
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

  const deltaTexts: string[] = []
  const argumentObjects = new Set<unknown>()
  let endArguments: unknown
  for await (const event of events) {
    if (event.type === 'toolcall_end') {
      endArguments = event.toolCall.arguments
    }
    if (event.type !== 'toolcall_delta') {
      continue
    }
    deltaTexts.push(event.delta)
    const block = event.partial.content[event.contentIndex]
    if (block?.type === 'toolCall') {
      argumentObjects.add(block.arguments)
    }
  }
  const message = await events.result()
  const toolCall = message.content.find((block) => block.type === 'toolCall')
  return { deltaTexts, argumentObjects, endArguments, message, toolCall }
}

describe('Pi Bedrock streaming tool-call arguments', () => {
  it('emits every delta but parses a large argument a bounded number of times, ending exact', async () => {
    const json = writeFileArguments(200 * 1024)
    const deltas = splitIntoDeltas(json)

    const result = await streamToolCall(toolCallFrames(deltas, { stopBlock: true }))

    expect(result.message.stopReason).toBe('toolUse')
    expect(result.deltaTexts).toHaveLength(deltas.length)
    expect(result.deltaTexts.join('')).toBe(json)
    // One new arguments object per full parse. Unpatched Pi parsed on every delta.
    expect(result.argumentObjects.size).toBeLessThan(deltas.length / 10)
    expect(result.endArguments).toEqual(JSON.parse(json))
    expect(result.toolCall).toEqual({
      type: 'toolCall',
      id: 'tool-1',
      name: 'write',
      arguments: JSON.parse(json),
    })
  })

  it('still parses a small argument on every delta', async () => {
    const json = writeFileArguments(2 * 1024)
    const deltas = splitIntoDeltas(json)

    const result = await streamToolCall(toolCallFrames(deltas, { stopBlock: true }))

    expect(result.argumentObjects.size).toBe(deltas.length)
    expect(result.endArguments).toEqual(JSON.parse(json))
  })

  it('brings arguments up to date when the stream ends without stopping the block', async () => {
    const json = writeFileArguments(64 * 1024)
    const deltas = splitIntoDeltas(json)

    const result = await streamToolCall(toolCallFrames(deltas, { stopBlock: false }))

    expect(result.endArguments).toBeUndefined()
    expect(result.message.stopReason).toBe('toolUse')
    expect(result.toolCall).toEqual({
      type: 'toolCall',
      id: 'tool-1',
      name: 'write',
      arguments: JSON.parse(json),
    })
  })
})
