import type { TranscriptContext } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { conversation, createHarness, systemPrompt } from './waggle-turn-system-prompt.test-support'

const READ_NOTES = { tool: 'read', input: { path: 'notes.txt' } } as const

function expectFullSystemPrompt(context: TranscriptContext) {
  const prompt = systemPrompt(context)
  expect(prompt).toContain('<tools>')
  expect(prompt).toContain('OpenWaggle Session identity (Host-authored)')
  expect(prompt).toContain('Review the implementation.')
}

describe('a Waggle Run started with custom messages', () => {
  it("sends Pi's and OpenWaggle's prompt sections from the first request of a Waggle-first Session, through a tool call", async () => {
    const harness = await createHarness()

    await harness.run('run-waggle', 'waggle', 'Debate it', READ_NOTES)

    const [beforeTool, afterTool] = harness.requests
    if (!beforeTool || !afterTool)
      throw new Error('Expected a request before and after the tool call')
    expectFullSystemPrompt(beforeTool)
    expectFullSystemPrompt(afterTool)
    expect(systemPrompt(afterTool)).toBe(systemPrompt(beforeTool))
    expect(conversation(afterTool).startsWith(conversation(beforeTool))).toBe(true)
    expect(conversation(beforeTool)).toContain('"runId": "run-waggle"')
  })

  it('keeps every Run its own identity and the earlier request as a prefix in a classic-then-Waggle Session', async () => {
    const harness = await createHarness()

    await harness.run('run-classic', 'classic', 'Audit it', 'answer')
    await harness.run('run-waggle', 'waggle', 'Debate it', READ_NOTES)
    await harness.run('run-next', 'classic', 'Summarize', 'answer')

    const texts = harness.requests.map(conversation)
    harness.requests.forEach((request, index) => {
      expectFullSystemPrompt(request)
      if (index > 0) expect(texts[index]?.startsWith(texts[index - 1] ?? '')).toBe(true)
    })
    expect(texts.at(-1)).toContain('"runId": "run-classic"')
    expect(texts.at(-1)).toContain('"runId": "run-waggle"')
    expect(texts.at(-1)).toContain('"runId": "run-next"')
    expect(texts.at(-1)?.split('"runId": "run-waggle"')).toHaveLength(2)
  })
})

describe("an Agent definition's tool allowlist on a Waggle turn", () => {
  function toolResults(request: TranscriptContext) {
    return request.messages.filter((message) => message.role === 'toolResult')
  }

  it('lists only the allowed tools and blocks a refused one', async () => {
    const harness = await createHarness()

    await harness.run(
      'run-narrow',
      'waggle',
      'List the files',
      { tool: 'ls', input: { path: '.' } },
      { toolAllowlist: ['read'] },
    )

    const [beforeCall, afterCall] = harness.requests
    if (!beforeCall || !afterCall) throw new Error('Expected a request before and after the call')
    const tools = /<tools>[\s\S]*?<\/tools>/.exec(systemPrompt(beforeCall))?.[0] ?? ''
    expect(tools).toContain('read')
    expect(tools).not.toMatch(/\bls\b/)
    expect(toolResults(afterCall)).toMatchObject([{ toolName: 'ls', isError: true }])
  })
})
