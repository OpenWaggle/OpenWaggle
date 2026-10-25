import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
} from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'
import { withExpiredCredentialRetry } from '../pi-bedrock-credential-retry'

const EXPIRED =
  "Token is expired. To refresh this SSO session run 'aws sso login' with the corresponding profile."

function message(overrides: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'bedrock-converse-stream',
    provider: 'amazon-bedrock',
    model: 'eu.anthropic.claude-opus',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
    ...overrides,
  }
}

function failed(errorMessage: string): AssistantMessageEvent {
  return {
    type: 'error',
    reason: 'error',
    error: message({ stopReason: 'error', errorMessage }),
  }
}

function answered(text: string): AssistantMessageEvent[] {
  const done = message({ content: [{ type: 'text', text }] })
  return [
    { type: 'start', partial: message({}) },
    { type: 'text_start', contentIndex: 0, partial: done },
    { type: 'text_delta', contentIndex: 0, delta: text, partial: done },
    { type: 'text_end', contentIndex: 0, content: text, partial: done },
    { type: 'done', reason: 'stop', message: done },
  ]
}

/** A provider stream function that answers each call with the next script. */
function scriptedProvider(scripts: readonly (readonly AssistantMessageEvent[])[]) {
  let call = 0
  const stream = vi.fn((_model: string, _context: string, _options?: { signal?: AbortSignal }) => {
    const events = scripts[call] ?? []
    call += 1
    const result = createAssistantMessageEventStream()
    setTimeout(() => {
      for (const event of events) result.push(event)
      result.end()
    }, 0)
    return result
  })
  return stream
}

async function collect(stream: AssistantMessageEventStream) {
  const events: AssistantMessageEvent[] = []
  for await (const event of stream) events.push(event)
  return { events, result: await stream.result() }
}

const noWait = () => Promise.resolve(true)

describe('Amazon Bedrock expired credential retry', () => {
  it('resolves credentials once more when the first request failed on them', async () => {
    const provider = scriptedProvider([[failed(EXPIRED)], answered('Hello')])
    const stream = withExpiredCredentialRetry(provider, { wait: noWait })

    const { events, result } = await collect(stream('model', 'context', {}))

    expect(provider).toHaveBeenCalledTimes(2)
    expect(events.map((event) => event.type)).toEqual([
      'start',
      'text_start',
      'text_delta',
      'text_end',
      'done',
    ])
    expect(result.stopReason).toBe('stop')
  })

  it('fails with the second error when the credentials are still expired', async () => {
    const provider = scriptedProvider([[failed(EXPIRED)], [failed(`${EXPIRED} again`)]])
    const stream = withExpiredCredentialRetry(provider, { wait: noWait })

    const { events, result } = await collect(stream('model', 'context', {}))

    expect(provider).toHaveBeenCalledTimes(2)
    expect(events).toHaveLength(1)
    expect(result).toMatchObject({ stopReason: 'error', errorMessage: `${EXPIRED} again` })
  })

  it('does not retry other failures', async () => {
    const provider = scriptedProvider([[failed('ValidationException: bad request')]])
    const stream = withExpiredCredentialRetry(provider, { wait: noWait })

    const { result } = await collect(stream('model', 'context', {}))

    expect(provider).toHaveBeenCalledTimes(1)
    expect(result.errorMessage).toBe('ValidationException: bad request')
  })

  it('does not retry once the response started streaming', async () => {
    const partial = answered('Hel').slice(0, 3)
    const provider = scriptedProvider([[...partial, failed(EXPIRED)]])
    const stream = withExpiredCredentialRetry(provider, { wait: noWait })

    const { events, result } = await collect(stream('model', 'context', {}))

    expect(provider).toHaveBeenCalledTimes(1)
    expect(events.map((event) => event.type)).toEqual([
      'start',
      'text_start',
      'text_delta',
      'error',
    ])
    expect(result.errorMessage).toBe(EXPIRED)
  })

  it('ends as aborted without a second request when the Run is stopped during the wait', async () => {
    const provider = scriptedProvider([[failed(EXPIRED)], answered('Hello')])
    const stream = withExpiredCredentialRetry(provider, { wait: () => Promise.resolve(false) })

    const { result } = await collect(stream('model', 'context', {}))

    expect(provider).toHaveBeenCalledTimes(1)
    expect(result.stopReason).toBe('aborted')
  })
})
