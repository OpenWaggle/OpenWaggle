import { execFileSync } from 'node:child_process'
import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { respondCommandHint } from '../run-cli-interactions'

function selectWithChoice(choice: string) {
  return fromPartial<AgentLoopInteraction>({
    kind: 'select',
    title: 'Pick one',
    choices: [choice],
    sessionId: 'session-1',
    runId: 'run-1',
    interactionId: 'interaction-1',
  })
}

describe('respondCommandHint', () => {
  it('quotes an agent-chosen choice so pasting the command cannot run anything else', () => {
    const hint = respondCommandHint(selectWithChoice("x'; touch /tmp/owned; echo '"))
    expect(hint).toBeDefined()
    const responseJson = hint?.split('--response-json ')[1] ?? ''

    // The shell must hand the whole JSON back as one argument, unchanged.
    const parsed = execFileSync('sh', ['-c', `printf %s ${responseJson}`], { encoding: 'utf8' })
    expect(JSON.parse(parsed)).toEqual({
      kind: 'select',
      selected: "x'; touch /tmp/owned; echo '",
    })
  })
})
