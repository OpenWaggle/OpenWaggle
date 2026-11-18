import { describe, expect, it } from 'vitest'
import { buildClassicRunMessages } from '../pi-run-result'

function makePayload(overrides: { readonly text?: string } = {}) {
  return { text: 'Build a coding game in this repo', attachments: [], ...overrides }
}

describe('buildClassicRunMessages', () => {
  const appended = [
    { role: 'custom', customType: 'openwaggle-hive-wake', content: 'Act on the updates.' },
    { role: 'assistant', model: 'gpt-5.4', content: [{ type: 'text', text: 'All done.' }] },
  ]

  it('records no user message for a Hive wake, whose prompt is the Host’s', () => {
    const payload = makePayload({ text: 'Worker updates arrived while this Session was idle.' })

    const result = buildClassicRunMessages({ hiveWake: true, payload }, appended)

    expect(result.map((message) => message.role)).toEqual(['assistant'])
  })

  it('records the user’s message for any other Run', () => {
    const payload = makePayload()

    const result = buildClassicRunMessages({ payload }, appended)

    expect(result.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(result[0]?.parts).toMatchObject([{ type: 'text', text: payload.text }])
  })
})
