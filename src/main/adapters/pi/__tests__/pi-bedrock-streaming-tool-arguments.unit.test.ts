import { describe, expect, it } from 'vitest'
import {
  splitIntoDeltas,
  streamBedrockFrames,
  toolCallFrames,
  writeFileArguments,
} from './bedrock-event-stream.test-utils'

/**
 * Pi 1.6.0 parses streamed tool-call arguments with `StreamingJsonParser`, which reads each delta
 * once and copies only the containers still open, so a large argument costs linear time instead of
 * the quadratic whole-text re-parse the earlier per-delta `parseStreamingJson` did. The Bedrock
 * Converse stream must still emit one `toolcall_delta` per Bedrock delta, keep a live preview, and
 * finish with exact arguments.
 */

async function streamToolCall(frames: readonly Buffer[]) {
  const deltaTexts: string[] = []
  const argumentObjects = new Set<unknown>()
  let endArguments: unknown
  const message = await streamBedrockFrames(frames, (event) => {
    if (event.type === 'toolcall_end') {
      endArguments = event.toolCall.arguments
    }
    if (event.type !== 'toolcall_delta') {
      return
    }
    deltaTexts.push(event.delta)
    const block = event.partial.content[event.contentIndex]
    if (block?.type === 'toolCall') {
      argumentObjects.add(block.arguments)
    }
  })
  const toolCall = message.content.find((block) => block.type === 'toolCall')
  return { deltaTexts, argumentObjects, endArguments, message, toolCall }
}

describe('Pi Bedrock streaming tool-call arguments', () => {
  it('emits every delta for a large argument, ending exact and quickly', async () => {
    const json = writeFileArguments(200 * 1024)
    const deltas = splitIntoDeltas(json)

    const startedAt = performance.now()
    const result = await streamToolCall(toolCallFrames(deltas, { stopBlock: true }))
    const elapsedMs = performance.now() - startedAt

    expect(result.message.stopReason).toBe('toolUse')
    expect(result.deltaTexts).toHaveLength(deltas.length)
    expect(result.deltaTexts.join('')).toBe(json)
    // A coarse guard on the parser's linearity, with room for a loaded runner: this input
    // re-parsed per delta took about 15 s (the quadratic cost the old patch removed) and streams
    // in a few milliseconds on Pi 1.6.0.
    expect(elapsedMs).toBeLessThan(5_000)
    expect(result.endArguments).toEqual(JSON.parse(json))
    expect(result.toolCall).toEqual({
      type: 'toolCall',
      id: 'tool-1',
      name: 'write',
      arguments: JSON.parse(json),
    })
  })

  it('keeps the preview of a small argument fresh on every delta', async () => {
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
