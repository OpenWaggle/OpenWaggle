import { execFileSync } from 'node:child_process'
import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { respondCommandHint } from '../run-cli-interactions'
import { sanitizeTerminalText } from '../terminal-text'

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
    const hint = respondCommandHint(selectWithChoice("x'; touch /tmp/owned; echo '"), 'darwin')
    expect(hint).toBeDefined()
    const responseJson = hint?.split('--response-json ')[1] ?? ''

    // The shell must hand the whole JSON back as one argument, unchanged.
    const parsed = execFileSync('sh', ['-c', `printf %s ${responseJson}`], { encoding: 'utf8' })
    expect(JSON.parse(parsed)).toEqual({
      kind: 'select',
      selected: "x'; touch /tmp/owned; echo '",
    })
  })

  it('shows the response on its own line on Windows', () => {
    const hint = respondCommandHint(selectWithChoice('a & b'), 'win32')

    expect(hint).toContain('--response-json <response>')
    expect(hint).toContain('where <response> is {"kind":"select","selected":"a & b"}')
  })

  it('keeps the example valid JSON when a choice holds control characters', () => {
    const hint = respondCommandHint(selectWithChoice('a\u0085b\u007f\u202e'), 'darwin') ?? ''
    const quoted = hint.split('--response-json ')[1] ?? ''

    expect(sanitizeTerminalText(hint)).toBe(hint)
    const parsed = execFileSync('sh', ['-c', `printf %s ${quoted}`], { encoding: 'utf8' })
    expect(JSON.parse(parsed)).toEqual({ kind: 'select', selected: 'a\u0085b\u007f\u202e' })
  })
})
