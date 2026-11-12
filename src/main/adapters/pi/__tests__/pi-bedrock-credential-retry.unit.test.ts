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

const MODEL = {
  api: 'bedrock-converse-stream',
  provider: 'amazon-bedrock',
  id: 'eu.anthropic.claude-opus',
} as const

function message(overrides: Partial<AssistantMessage>) {
  const result: AssistantMessage = {
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
  return result
}

function failed(errorMessage: string) {
  return {
    type: 'error',
    reason: 'error',
    error: message({ stopReason: 'error', errorMessage }),
  } satisfies AssistantMessageEvent
}

function answered(text: string) {
  const done = message({ content: [{ type: 'text', text }] })
  return [
    { type: 'start', partial: message({}) },
    { type: 'text_start', contentIndex: 0, partial: done },
    { type: 'text_delta', contentIndex: 0, delta: text, partial: done },
    { type: 'text_end', contentIndex: 0, content: text, partial: done },
    { type: 'done', reason: 'stop', message: done },
  ] satisfies AssistantMessageEvent[]
}

/** One call's events, and the result it ends with when no event carried one. */
type Script =
  | readonly AssistantMessageEvent[]
  | { readonly events: readonly AssistantMessageEvent[]; readonly end: AssistantMessage }

/** A provider stream function that answers each call with the next script. */
function scriptedProvider(scripts: readonly Script[]) {
  let call = 0
  const stream = vi.fn(
    (_model: typeof MODEL, _context: string, _options?: { signal?: AbortSignal }) => {
      const script = scripts[call] ?? []
      const events = 'events' in script ? script.events : script
      const end = 'events' in script ? script.end : undefined
      call += 1
      const result = createAssistantMessageEventStream()
      setTimeout(() => {
        for (const event of events) result.push(event)
        result.end(end)
      }, 0)
      return result
    },
  )
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

    const { events, result } = await collect(stream(MODEL, 'context', {}))

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

    const { events, result } = await collect(stream(MODEL, 'context', {}))

    expect(provider).toHaveBeenCalledTimes(2)
    expect(events).toHaveLength(1)
    expect(result).toMatchObject({ stopReason: 'error', errorMessage: `${EXPIRED} again` })
  })

  it('drops the clients again when the retry also failed on expired credentials', async () => {
    const provider = scriptedProvider([[failed(EXPIRED)], [failed(`${EXPIRED} again`)]])
    const invalidateClients = vi.fn()
    const stream = withExpiredCredentialRetry(provider, { wait: noWait, invalidateClients })

    await collect(stream(MODEL, 'context', {}))

    // Once before the retry, and once after it: the retry's client holds the same credentials.
    expect(invalidateClients).toHaveBeenCalledTimes(2)
  })

  it('drops the clients again when AWS refused the keys the retry resolved', async () => {
    const refused =
      'UnrecognizedClientException: The security token included in the request is invalid.'
    const provider = scriptedProvider([[failed(EXPIRED)], [failed(refused)]])
    const invalidateClients = vi.fn()
    const stream = withExpiredCredentialRetry(provider, { wait: noWait, invalidateClients })

    const { result } = await collect(stream(MODEL, 'context', {}))

    expect(result.errorMessage).toBe(refused)
    expect(invalidateClients).toHaveBeenCalledTimes(2)
  })

  it('drops the clients before the Run sees the failed retry end', async () => {
    const provider = scriptedProvider([[failed(EXPIRED)], [failed(`${EXPIRED} again`)]])
    const order: string[] = []
    const stream = withExpiredCredentialRetry(provider, {
      wait: noWait,
      invalidateClients: () => order.push('invalidate'),
    })

    const attempt = stream(MODEL, 'context', {})
    await attempt.result().then(() => order.push('result'))

    expect(order).toEqual(['invalidate', 'invalidate', 'result'])
  })

  it('drops the clients when the retry ended with an expired result but no error event', async () => {
    const stillExpired = message({ stopReason: 'error', errorMessage: EXPIRED })
    const provider = scriptedProvider([[failed(EXPIRED)], { events: [], end: stillExpired }])
    const order: string[] = []
    const stream = withExpiredCredentialRetry(provider, {
      wait: noWait,
      invalidateClients: () => order.push('invalidate'),
    })

    const result = await stream(MODEL, 'context', {}).result()
    order.push('result')

    expect(result.errorMessage).toBe(EXPIRED)
    expect(order).toEqual(['invalidate', 'invalidate', 'result'])
  })

  it('keeps the retry client when the Run stopped the retry', async () => {
    const aborted: AssistantMessageEvent = {
      type: 'error',
      reason: 'aborted',
      error: message({ stopReason: 'aborted' }),
    }
    const provider = scriptedProvider([[failed(EXPIRED)], [aborted]])
    const invalidateClients = vi.fn()
    const stream = withExpiredCredentialRetry(provider, { wait: noWait, invalidateClients })

    const { result } = await collect(stream(MODEL, 'context', {}))

    expect(result.stopReason).toBe('aborted')
    expect(invalidateClients).toHaveBeenCalledTimes(1)
  })

  it('ends with an error instead of hanging when the retry ended without a result', async () => {
    const provider = scriptedProvider([[failed(EXPIRED)], []])
    const stream = withExpiredCredentialRetry(provider, { wait: noWait })

    const { result } = await collect(stream(MODEL, 'context', {}))

    expect(result).toMatchObject({
      stopReason: 'error',
      errorMessage: 'The Amazon Bedrock stream ended without a result',
    })
  })

  it('keeps the provider error when dropping the clients throws', async () => {
    const provider = scriptedProvider([[failed(EXPIRED)], [failed(`${EXPIRED} again`)]])
    const stream = withExpiredCredentialRetry(provider, {
      wait: noWait,
      invalidateClients: () => {
        throw new Error('destroy failed')
      },
    })

    const { result } = await collect(stream(MODEL, 'context', {}))

    expect(result.errorMessage).toBe(`${EXPIRED} again`)
  })

  it('ends with an error instead of hanging when the first attempt ended without a result', async () => {
    const provider = scriptedProvider([[]])
    const stream = withExpiredCredentialRetry(provider, { wait: noWait })

    const { result } = await collect(stream(MODEL, 'context', {}))

    expect(provider).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      stopReason: 'error',
      errorMessage: 'The Amazon Bedrock stream ended without a result',
    })
  })

  it('relays a first attempt that ended with a result but no terminal event', async () => {
    const answer = message({ content: [{ type: 'text', text: 'Hello' }] })
    const provider = scriptedProvider([
      { events: [{ type: 'start', partial: message({}) }], end: answer },
    ])
    const stream = withExpiredCredentialRetry(provider, { wait: noWait })

    const { events, result } = await collect(stream(MODEL, 'context', {}))

    expect(provider).toHaveBeenCalledTimes(1)
    expect(events.map((event) => event.type)).toEqual(['start'])
    expect(result).toMatchObject({ stopReason: 'stop', content: [{ type: 'text', text: 'Hello' }] })
  })

  it('keeps the retry client when the retry answered', async () => {
    const provider = scriptedProvider([[failed(EXPIRED)], answered('Hello')])
    const invalidateClients = vi.fn()
    const stream = withExpiredCredentialRetry(provider, { wait: noWait, invalidateClients })

    await collect(stream(MODEL, 'context', {}))

    expect(invalidateClients).toHaveBeenCalledTimes(1)
  })

  it('does not retry other failures', async () => {
    const provider = scriptedProvider([[failed('ValidationException: bad request')]])
    const stream = withExpiredCredentialRetry(provider, { wait: noWait })

    const { result } = await collect(stream(MODEL, 'context', {}))

    expect(provider).toHaveBeenCalledTimes(1)
    expect(result.errorMessage).toBe('ValidationException: bad request')
  })

  it('does not retry once the response started streaming', async () => {
    const partial = answered('Hel').slice(0, 3)
    const provider = scriptedProvider([[...partial, failed(EXPIRED)]])
    const stream = withExpiredCredentialRetry(provider, { wait: noWait })

    const { events, result } = await collect(stream(MODEL, 'context', {}))

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

    const { result } = await collect(stream(MODEL, 'context', {}))

    expect(provider).toHaveBeenCalledTimes(1)
    expect(result.stopReason).toBe('aborted')
  })

  it('ends with an error instead of hanging when the provider stream throws', async () => {
    const stream = withExpiredCredentialRetry(
      (_model: typeof MODEL, _context: string, _options?: { signal?: AbortSignal }) => {
        throw new Error('Cannot read the AWS config')
      },
      { wait: noWait },
    )

    const { result } = await collect(stream(MODEL, 'context', {}))

    expect(result).toMatchObject({
      stopReason: 'error',
      errorMessage: 'Cannot read the AWS config',
      provider: 'amazon-bedrock',
    })
  })
})
