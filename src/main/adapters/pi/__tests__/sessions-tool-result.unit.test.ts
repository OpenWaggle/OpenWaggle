import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compactHiveResult,
  HIVE_RESULT_TEXT_LIMIT_BYTES,
  hiveResultText,
} from '../sessions-tool-result'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function itemsResult(count: number, contentBytes: number | ((index: number) => number) = 1_000) {
  const bytesOf = typeof contentBytes === 'number' ? () => contentBytes : contentBytes
  return {
    contract: 'session-query-v2',
    response: {
      contractVersion: 2,
      requestId: 'request-1',
      outcome: {
        operation: 'items',
        sessionId: 'session-a',
        items: Array.from({ length: count }, (_, index) => ({
          nodeId: `node-${index}`,
          parentNodeId: `node-${index - 1}`,
          branchHintId: 'branch',
          role: 'assistant',
          kind: 'message',
          createdOrder: index + 1,
          content: 'x'.repeat(bytesOf(index)),
          metadata: { usage: { input: 1 }, cost: { total: 1 }, model: 'opus' },
        })),
      },
    },
  }
}

function parsed(text: string) {
  const value: unknown = JSON.parse(text)
  return value
}

describe('hive results the model reads', () => {
  it('drops the envelope, tree links, and usage metadata', () => {
    expect(compactHiveResult(itemsResult(1))).toEqual({
      outcome: {
        operation: 'items',
        sessionId: 'session-a',
        items: [
          {
            nodeId: 'node-0',
            role: 'assistant',
            kind: 'message',
            createdOrder: 1,
            content: 'x'.repeat(1_000),
            metadata: { model: 'opus' },
          },
        ],
      },
    })
  })

  it('keeps a replayed command visible and drops replayed: false', () => {
    const lifecycle = (replayed: boolean) => ({
      contract: 'session-lifecycle-v2',
      response: { idempotencyKey: 'k', replayed, outcome: { operation: 'spawn' } },
    })
    expect(compactHiveResult(lifecycle(false))).toEqual({ outcome: { operation: 'spawn' } })
    expect(compactHiveResult(lifecycle(true))).toEqual({
      replayed: true,
      outcome: { operation: 'spawn' },
    })
  })

  it('sends the whole result with verbose', async () => {
    const result = itemsResult(2)
    expect(parsed(await hiveResultText({ result, verbose: true, toolCallId: 'call-1' }))).toEqual(
      result,
    )
  })

  it('ends an oversized items page early with nextCreatedOrder and saves the whole result', async () => {
    const scratchDirectory = await mkdtemp(path.join(tmpdir(), 'openwaggle-hive-result-'))
    roots.push(scratchDirectory)
    const result = itemsResult(600)

    const text = await hiveResultText({
      result,
      verbose: false,
      toolCallId: 'call/1',
      scratchDirectory,
    })
    const page = parsed(text)

    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(HIVE_RESULT_TEXT_LIMIT_BYTES)
    expect(page).toMatchObject({
      outcome: { nextCreatedOrder: expect.any(Number) },
      truncated: { omittedItems: expect.any(Number), fullResult: expect.any(String) },
    })
    const fullResult = path.join(scratchDirectory, 'hive-results', 'call_1.json')
    expect(parsed(await readFile(fullResult, 'utf8'))).toEqual(result)
  })

  it('an oversized first item still advances the cursor', async () => {
    const result = itemsResult(2, (index) => (index === 0 ? 40 * 1024 : 5))

    const text = await hiveResultText({ result, verbose: false, toolCallId: 'call-3' })
    const page = parsed(text)

    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(HIVE_RESULT_TEXT_LIMIT_BYTES)
    expect(page).toMatchObject({
      outcome: {
        nextCreatedOrder: 1,
        items: [
          { nodeId: 'node-0', createdOrder: 1, truncated: true, preview: expect.any(String) },
        ],
      },
      truncated: { omittedItems: 1 },
    })
  })

  it('pages an oversized verbose items result under its response', async () => {
    const text = await hiveResultText({ result: itemsResult(600), verbose: true, toolCallId: 'c' })
    const page = parsed(text)

    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(HIVE_RESULT_TEXT_LIMIT_BYTES)
    expect(page).toMatchObject({
      contract: 'session-query-v2',
      response: {
        requestId: 'request-1',
        outcome: { items: expect.any(Array), nextCreatedOrder: expect.any(Number) },
      },
      truncated: { omittedItems: expect.any(Number) },
    })
  })

  it('previews an oversized result that has no items to page', async () => {
    const result = { response: { outcome: { operation: 'read', text: 'y'.repeat(100_000) } } }
    const text = await hiveResultText({ result, verbose: false, toolCallId: 'call-2' })

    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(HIVE_RESULT_TEXT_LIMIT_BYTES)
    expect(parsed(text)).toMatchObject({ truncated: { bytes: expect.any(Number) } })
  })
})
