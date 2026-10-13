import { describe, expect, it } from 'vitest'
import { conversation, createHarness } from './waggle-turn-system-prompt.test-support'

const IDENTITY = 'OpenWaggle Host-authored Run identity'

function identityAfter(text: string, runId: string) {
  return new RegExp(`${text}\n\n${IDENTITY}[^"]*"runId": "${runId}"`)
}

describe('a Run an extension command starts with a custom message', () => {
  it('sends its identity after the command message in a Session it starts', async () => {
    const harness = await createHarness()

    await harness.run('run-command', 'command', 'go', 'answer')

    const [request] = harness.requests
    if (!request) throw new Error('Expected the command turn to reach the model')
    expect(conversation(request)).toMatch(identityAfter('Command: go', 'run-command'))
  })

  it("keeps the earlier Run's request as a prefix and each Run its own identity", async () => {
    const harness = await createHarness()

    await harness.run('run-first', 'classic', 'Audit it', 'answer')
    await harness.run('run-command', 'command', 'go', 'answer')
    await harness.run('run-last', 'classic', 'Summarize', 'answer')

    const texts = harness.requests.map(conversation)
    texts.forEach((text, index) => {
      if (index > 0) expect(text.startsWith(texts[index - 1] ?? '')).toBe(true)
    })
    const last = texts.at(-1) ?? ''
    expect(last).toMatch(identityAfter('Audit it', 'run-first'))
    expect(last).toMatch(identityAfter('Command: go', 'run-command'))
    expect(last).toMatch(identityAfter('Summarize', 'run-last'))
    expect(last.split(IDENTITY)).toHaveLength(4)
  })
})
