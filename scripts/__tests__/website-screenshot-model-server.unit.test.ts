import { describe, expect, it } from 'vitest'
import { type ModelScenario, scriptedReply } from '../website-screenshot-model-server'

const SCENARIOS: readonly ModelScenario[] = [
  {
    match: 'Open the notes page',
    title: 'Check the notes page',
    replies: [
      { kind: 'tools', calls: [{ name: 'tool_search', arguments: { query: 'browser' } }] },
      { kind: 'text', text: 'The preview is open.' },
    ],
  },
]

function user(content: string) {
  return { role: 'user', content }
}

describe('scriptedReply', () => {
  it('answers a title request with the matching scenario title', () => {
    const reply = scriptedReply(SCENARIOS, {
      messages: [
        { role: 'system', content: 'Generate a title for this conversation.' },
        user('Please Open the notes page and look.'),
      ],
    })
    expect(reply).toEqual({
      kind: 'text',
      text: JSON.stringify({ title: 'Check the notes page', needsRefinement: false }),
    })
  })

  it('plays one reply per assistant turn after the matching message', () => {
    const opening = user('Open the notes page in the preview.')
    expect(scriptedReply(SCENARIOS, { messages: [opening] })).toMatchObject({ kind: 'tools' })
    const second = scriptedReply(SCENARIOS, {
      messages: [opening, { role: 'assistant', content: null }, { role: 'tool', content: 'ok' }],
    })
    expect(second).toEqual({ kind: 'text', text: 'The preview is open.' })
  })

  it('repeats the last reply once the script runs out', () => {
    const assistant = { role: 'assistant', content: 'x' }
    const reply = scriptedReply(SCENARIOS, {
      messages: [user('Open the notes page'), assistant, assistant, assistant],
    })
    expect(reply).toEqual({ kind: 'text', text: 'The preview is open.' })
  })

  it('reads text parts and falls back for an unknown conversation', () => {
    const parts = { role: 'user', content: [{ type: 'text', text: 'Something else' }] }
    expect(scriptedReply(SCENARIOS, { messages: [parts] })).toMatchObject({ kind: 'text' })
    expect(scriptedReply(SCENARIOS, null)).toMatchObject({ kind: 'text' })
  })
})
