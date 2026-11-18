import { describe, expect, it } from 'vitest'
import {
  splitIntoDeltas,
  streamBedrockFrames,
  toolCallFrames,
  writeFileArguments,
} from './bedrock-event-stream.test-utils'

/**
 * Pi's patched Bedrock Converse stream must not re-parse the whole partial tool-call JSON
 * on every delta (quadratic CPU, a source of multi-second event-loop stalls), yet must
 * still emit one `toolcall_delta` per Bedrock delta and finish with exact arguments.
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
