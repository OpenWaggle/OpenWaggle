import { afterEach, describe, expect, it } from 'vitest'
import {
  type FixtureModelServer,
  type ModelScenario,
  parseAnthropicRequest,
  parseOpenAiRequest,
  scriptedReply,
  startFixtureModelServer,
} from '../website-screenshot-model-server'

const SCENARIOS: readonly ModelScenario[] = [
  {
    match: 'Open the notes page',
    title: 'Check the notes page',
    replies: [
      { kind: 'tools', calls: [{ name: 'tool_search', arguments: { query: 'browser' } }] },
      { kind: 'text', text: 'The preview is open.' },
    ],
  },
  {
    match: 'Review the client',
    title: 'Review client errors',
    replies: (request, turn) => ({
      kind: turn === 1 ? 'hold' : 'text',
      text: `Turn ${String(turn)} of ${request.model}`,
    }),
  },
]

function user(content: unknown) {
  return { role: 'user', content }
}

describe('scriptedReply over Chat Completions', () => {
  it('answers a title request with the matching scenario title', () => {
    const reply = scriptedReply(
      SCENARIOS,
      parseOpenAiRequest({
        messages: [
          { role: 'system', content: 'Generate a title for this conversation.' },
          user('Please Open the notes page and look.'),
        ],
      }),
    )
    expect(reply).toEqual({
      kind: 'text',
      text: JSON.stringify({ title: 'Check the notes page', needsRefinement: false }),
    })
  })

  it('plays one reply per assistant turn after the matching message', () => {
    const opening = user('Open the notes page in the preview.')
    const first = scriptedReply(SCENARIOS, parseOpenAiRequest({ messages: [opening] }))
    expect(first).toMatchObject({ kind: 'tools' })
    const second = scriptedReply(
      SCENARIOS,
      parseOpenAiRequest({
        messages: [opening, { role: 'assistant', content: null }, { role: 'tool', content: 'ok' }],
      }),
    )
    expect(second).toEqual({ kind: 'text', text: 'The preview is open.' })
  })

  it('repeats the last reply once the script runs out', () => {
    const assistant = { role: 'assistant', content: 'x' }
    const reply = scriptedReply(
      SCENARIOS,
      parseOpenAiRequest({
        messages: [user('Open the notes page'), assistant, assistant, assistant],
      }),
    )
    expect(reply).toEqual({ kind: 'text', text: 'The preview is open.' })
  })

  it('reads text parts and falls back for an unknown conversation', () => {
    const parts = user([{ type: 'text', text: 'Something else' }])
    expect(scriptedReply(SCENARIOS, parseOpenAiRequest({ messages: [parts] }))).toMatchObject({
      kind: 'text',
    })
    expect(scriptedReply(SCENARIOS, parseOpenAiRequest(null))).toMatchObject({ kind: 'text' })
  })
})

describe('scriptedReply over Anthropic Messages', () => {
  it('reads the title prompt from the system blocks', () => {
    const reply = scriptedReply(
      SCENARIOS,
      parseAnthropicRequest({
        system: [{ type: 'text', text: 'Generate a title that will help the user.' }],
        messages: [user([{ type: 'text', text: 'Review the client please' }])],
      }),
    )
    expect(reply).toMatchObject({
      text: JSON.stringify({ title: 'Review client errors', needsRefinement: false }),
    })
  })

  it('counts a tool-result message as a tool turn, not as the user', () => {
    const request = parseAnthropicRequest({
      model: 'claude-opus-4-6',
      messages: [
        user('Review the client'),
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read', input: {} }] },
        user([{ type: 'tool_result', tool_use_id: 't1', content: 'file' }]),
      ],
    })
    expect(request.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool'])
    expect(scriptedReply(SCENARIOS, request)).toEqual({
      kind: 'hold',
      text: 'Turn 1 of claude-opus-4-6',
    })
  })
})

const DONE_LINE = 'data: [DONE]'

describe('startFixtureModelServer', () => {
  let server: FixtureModelServer | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('streams Chat Completions with the scripted tool call', async () => {
    server = await startFixtureModelServer(SCENARIOS)
    const response = await fetch(`${server.openAiBaseUrl}/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ messages: [user('Open the notes page')] }),
    })
    const body = await response.text()
    expect(body).toContain('"name":"tool_search"')
    expect(body).toContain('"finish_reason":"tool_calls"')
    expect(body.trim().endsWith(DONE_LINE)).toBe(true)
  })

  it('holds an Anthropic reply open until its scenario is released', async () => {
    server = await startFixtureModelServer(SCENARIOS)
    const response = await fetch(`${server.anthropicBaseUrl}/v1/messages?beta=true`, {
      method: 'POST',
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        messages: [user('Review the client'), { role: 'assistant', content: 'one' }],
      }),
    })
    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body.')
    const decoder = new TextDecoder()
    let received = ''
    while (!received.includes('Turn 1 of claude-opus-4-6')) {
      const { value } = await reader.read()
      received += decoder.decode(value)
    }
    expect(received).not.toContain('message_stop')
    server.release('Review the client')
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      received += decoder.decode(value)
    }
    expect(received).toContain('"stop_reason":"end_turn"')
    expect(received).toContain('event: message_stop')
  })

  it('refuses paths it does not serve, such as the Responses API', async () => {
    server = await startFixtureModelServer(SCENARIOS)
    const response = await fetch(`${server.openAiBaseUrl}/responses`, {
      method: 'POST',
      body: '{}',
    })
    expect(response.status).toBe(404)
  })
})
